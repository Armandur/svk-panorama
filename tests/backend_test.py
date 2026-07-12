#!/usr/bin/env python3
"""Plain-assert-tester för ren backend-logik (ingen server, ingen pytest).

Kör: .venv/bin/python tests/backend_test.py
Fokus: sådant som är lätt att få subtilt fel - tiling-mattematik, multires-merge,
bundle-relativisering (inkl. path-säkerhet), färg-/slug-validering."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402
from PIL import Image  # noqa: E402

from app.auth import hash_password, make_invite_token, read_invite_token, verify_password  # noqa: E402
from app.routes.preview import FONT_KEYS, _hex  # noqa: E402
from app.routes.auth import _safe_next  # noqa: E402
from app.services.bundle import _media_refs, _relativize  # noqa: E402
from app.services.project_files import (  # noqa: E402
    _atomic_write_text,
    _natural_key,
    safe_upload_name,
    slugify,
)
from app.services.tiling import _expected_tile_count, apply_multires  # noqa: E402

_passed = 0
_failed = 0


def check(name: str, cond: bool) -> None:
    global _passed, _failed
    if cond:
        _passed += 1
    else:
        _failed += 1
        print(f"  FAIL: {name}")


def _img(w: int, h: int) -> Path:
    d = Path(tempfile.mkdtemp())
    p = d / "x.jpg"
    Image.new("RGB", (w, h), (1, 1, 1)).save(p, "JPEG")
    return p


def test_expected_tile_count():
    # 8000x4000 -> verifierat mot faktisk generate.py-körning (234 tiles).
    check("expected 8000x4000 == 234", _expected_tile_count(_img(8000, 4000)) == 234)
    check("expected 2048x1024 == 30", _expected_tile_count(_img(2048, 1024)) == 30)
    # Icke-2:1 (partiell pano) kan inte räknas exakt -> None.
    check("expected non-2:1 -> None", _expected_tile_count(_img(1000, 800)) is None)


def test_apply_multires():
    tour = {
        "scenes": {
            "1": {"type": "equirectangular", "panorama": "/p/1.jpg", "hotSpots": [{"id": 0}]},
            "2": {"type": "equirectangular", "panorama": "/p/2.jpg", "hotSpots": []},
        }
    }
    manifest = {"1": {"basePath": "/projects/s/tiles/1", "maxLevel": 4}}
    apply_multires(tour, manifest)
    s1, s2 = tour["scenes"]["1"], tour["scenes"]["2"]
    check("scen1 blev multires", s1["type"] == "multires")
    check("scen1 fick multiRes", s1.get("multiRes", {}).get("maxLevel") == 4)
    check("scen1 tappade panorama", "panorama" not in s1)
    check("scen1 behöll hotSpots", s1.get("hotSpots") == [{"id": 0}])
    check("scen2 orörd (ingen tile)", s2["type"] == "equirectangular" and s2["panorama"] == "/p/2.jpg")


def test_relativize():
    tour = {
        "default": {"editorMode": True},
        "scenes": {
            "1": {"type": "multires", "multiRes": {"basePath": "/projects/s/tiles/1"}},
            "2": {"type": "equirectangular", "panorama": "/projects/s/images/2.jpg"},
        },
    }
    tour["scenes"]["2"]["hotSpots"] = [
        {"type": "info", "text": "Se ![](/media/7/ab12-karta.jpg) här",
         "body": "Mer: /media/7/ab12-karta.jpg och /media/7/foo.png"},
    ]
    refs = _media_refs(tour)  # innan relativisering
    check("media-refs hittade", refs == {(7, "ab12-karta.jpg"), (7, "foo.png")})
    _relativize("nonexistent-slug", tour)  # tom manifest -> apply_multires no-op
    check("basePath relativ", tour["scenes"]["1"]["multiRes"]["basePath"] == "tiles/1")
    check("panorama relativ", tour["scenes"]["2"]["panorama"] == "images/2.jpg")
    check("editorMode av", tour["default"]["editorMode"] is False)
    # Poolbilds-URL:er relativiseras till media/<filnamn> (utan owner-segment).
    hs = tour["scenes"]["2"]["hotSpots"][0]
    check("media text relativ", hs["text"] == "Se ![](media/ab12-karta.jpg) här")
    check("media body relativ", hs["body"] == "Mer: media/ab12-karta.jpg och media/foo.png")
    # Sökvägar ska aldrig vara absoluta/utbrytande efter relativisering.
    bp = tour["scenes"]["1"]["multiRes"]["basePath"]
    check("basePath ej absolut", not bp.startswith("/") and ".." not in bp)


def test_export_readiness():
    from app import config
    from app.services import bundle, project_files

    tmp = Path(tempfile.mkdtemp())
    old = config.PROJECTS_DIR
    old_media = config.MEDIA_DIR
    config.PROJECTS_DIR = tmp / "projects"
    config.MEDIA_DIR = tmp / "media"  # tom -> refererade poolbilder "saknas"
    try:
        (config.PROJECTS_DIR / "t").mkdir(parents=True)
        # Tom tur -> "inga scener".
        project_files.write_tour("t", {"scenes": {}})
        r = bundle.readiness("t")
        check("readiness tom -> 1 issue", len(r) == 1 and "inga scener" in r[0]["msg"])

        # scen 3 oplacerad, scen 2 okalibrerad (i graf), scen 1 har dangling scen-hotspot.
        project_files.write_tour("t", {
            "default": {"firstScene": "1"},
            "scenes": {
                "1": {"northOffset": 10.0, "hotSpots": [{"type": "scene", "sceneId": "9"}]},
                "2": {},
                "3": {"northOffset": 5.0},
            },
        })
        project_files.write_map("t", {
            "scenes": [{"id": "1", "x": 1, "y": 1}, {"id": "2", "x": 2, "y": 2}],
            "edges": [{"from": "1", "to": "2", "twoway": True}],
        })
        msgs = " | ".join(i["msg"] for i in bundle.readiness("t"))
        check("readiness varnar oplacerad (3)", "oplacerade" in msgs and "3" in msgs)
        check("readiness varnar okalibrerad (2)", "Okalibrerade" in msgs and "scen 2" in msgs)
        check("readiness varnar dangling hotspot", "borttagen scen" in msgs)
        check("readiness ej falsk isolerad", "utan länk" not in msgs)  # 1 & 2 är länkade

        # Allt i sin ordning -> inga issues.
        project_files.write_tour("t", {
            "default": {"firstScene": "1"},
            "scenes": {"1": {"northOffset": 10.0}, "2": {"northOffset": 5.0}},
        })
        project_files.write_map("t", {
            "scenes": [{"id": "1", "x": 1, "y": 1}, {"id": "2", "x": 2, "y": 2}],
            "edges": [{"from": "1", "to": "2", "twoway": True}],
        })
        check("readiness allt ok -> inga issues", bundle.readiness("t") == [])

        # Refererad poolbild som saknas -> varning.
        project_files.write_tour("t", {
            "default": {"firstScene": "1"},
            "scenes": {"1": {"northOffset": 10.0, "hotSpots": [
                {"type": "info", "text": "![](/media/9/saknas.jpg)"},
            ]}},
        })
        project_files.write_map("t", {"scenes": [{"id": "1", "x": 1, "y": 1}], "edges": []})
        msgs = " | ".join(i["msg"] for i in bundle.readiness("t"))
        check("readiness varnar saknad poolbild", "saknas i mediebiblioteket" in msgs)
    finally:
        config.PROJECTS_DIR = old
        config.MEDIA_DIR = old_media


def test_preset_sanitize():
    from app.services.presets import sanitize_config
    c = sanitize_config({"autoRotate": 999, "mapSize": "huge", "sceneFadeDuration": -5,
                         "theme": {"font": "comic", "dotColor": "red;}x", "currentColor": "#Aabb00"}})
    check("preset autoRotate ogiltig -> False", c["autoRotate"] is False)
    check("preset mapSize ogiltig -> medium", c["mapSize"] == "medium")
    check("preset fade ogiltig -> default", c["sceneFadeDuration"] == 1500)
    check("preset font ogiltig -> sans", c["theme"]["font"] == "sans")
    check("preset färg-injektion -> fallback", c["theme"]["dotColor"] == "#666666")
    check("preset giltig hex behålls", c["theme"]["currentColor"] == "#Aabb00")
    ok = sanitize_config({"autoRotate": -3, "mapSize": "large", "theme": {"font": "serif"}})
    check("preset giltig autoRotate behålls", ok["autoRotate"] == -3)
    check("preset giltig mapSize behålls", ok["mapSize"] == "large")
    check("preset tom -> defaults", sanitize_config({})["theme"]["font"] == "sans")
    # Branding hör INTE hemma i tema-preset (egen mall) -> droppas även om det skickas.
    with_brand = sanitize_config({"branding": {"content": "**x**", "size": "large", "position": "top-left"}})
    check("tema-preset droppar branding", "branding" not in with_brand)


def test_branding_sanitize():
    from app.services.presets import sanitize_branding
    check("branding tom -> None", sanitize_branding("", "medium", "bottom-left") is None)
    check("branding whitespace -> None", sanitize_branding("   ", "medium", "bottom-left") is None)
    ok = sanitize_branding("**Församlingen**", "huge", "middle")
    check("branding giltig content behålls", ok["content"] == "**Församlingen**")
    check("branding ogiltig size -> medium", ok["size"] == "medium")
    check("branding ogiltig position -> bottom-right", ok["position"] == "bottom-right")
    val = sanitize_branding("logga", "small", "top-right")
    check("branding giltig size behålls", val["size"] == "small")
    check("branding giltig position behålls", val["position"] == "top-right")
    check("branding content kapas vid 2000", len(sanitize_branding("a" * 5000, "small", "top-right")["content"]) == 2000)


def test_backup_security():
    import io
    import zipfile as _zip

    from app.services.backup import _media_refs, _validate_members

    def zf_with(name):
        buf = io.BytesIO()
        with _zip.ZipFile(buf, "w") as z:
            z.writestr(name, "x")
        buf.seek(0)
        return _zip.ZipFile(buf)

    # Zip-slip + otillåtna filtyper + media-undermapp avvisas.
    for bad in ("../evil.txt", "/etc/passwd", "a/../b", "images/../../x", "..\\evil",
                "media/x.html", "logo.svg", "images/a.js", "media/sub/x.jpg", "x.php"):
        try:
            _validate_members(zf_with(bad))
            check(f"avvisar '{bad}'", False)
        except ValueError:
            check(f"avvisar '{bad}'", True)
    # Ofarliga vägar/filtyper tillåts.
    ok = True
    try:
        _validate_members(zf_with("tour.json"))
        _validate_members(zf_with("images/1.jpg"))
        _validate_members(zf_with("map.png"))
        _validate_members(zf_with("tiles/2/f0_0.jpg"))
        _validate_members(zf_with("tiles/manifest.json"))
        _validate_members(zf_with("media/abc-x.jpg"))
    except ValueError:
        ok = False
    check("tillåter normala vägar/filtyper", ok)

    tour = {"scenes": {"1": {"hotSpots": [
        {"text": "![](/media/7/ab-x.jpg)", "body": "igen /media/7/y.png"},
    ]}}}
    check("backup media_refs", _media_refs(tour) == {(7, "ab-x.jpg"), (7, "y.png")})


def test_media_pool():
    import io

    from app import config
    from app.services import media, project_files

    tmp = Path(tempfile.mkdtemp())
    old_media, old_projects = config.MEDIA_DIR, config.PROJECTS_DIR
    config.MEDIA_DIR = tmp / "media"
    config.PROJECTS_DIR = tmp / "projects"
    try:
        buf = io.BytesIO()
        Image.new("RGB", (40, 30), (2, 2, 2)).save(buf, "JPEG")
        name = media.store(1, "min bild.jpg", buf.getvalue())
        # Oigissbart namn: hex-prefix + saniterat basnamn.
        check("store oigissbart namn", name.endswith("-min bild.jpg") is False and name.endswith(".jpg"))
        check("resolve egen fil", media.resolve(1, name) is not None)
        check("resolve fel ägare -> None", media.resolve(2, name) is None)
        check("resolve traversal -> None", media.resolve(1, "../../etc/passwd") is None)
        check("resolve okänt -> None", media.resolve(1, "saknas.jpg") is None)
        items = media.list_pool(1)
        check("list_pool en post", len(items) == 1)
        check("list_pool mått", items[0]["width"] == 40 and items[0]["height"] == 30)
        check("list_pool url", items[0]["url"] == f"/media/1/{name}")
        check("list_pool thumb-url", items[0]["thumb"] == f"/media/1/thumb/{name}")
        # Visningsnamn = originalnamnet (saniterat) utan hex-prefix.
        check("display_name strippar hex-prefix", media.display_name(name) == "min-bild.jpg")
        check("list_pool orig", items[0]["orig"] == "min-bild.jpg")
        # Tumnagel genereras + cachas, och ligger i dold .thumbs (ej listad).
        th = media.ensure_thumb(1, name)
        check("ensure_thumb skapar fil", th is not None and th.is_file())
        check("thumb ligger i .thumbs", th.parent.name == ".thumbs")
        check("list_pool listar ej thumben", len(media.list_pool(1)) == 1)

        # Usage-scan mot en turs tour.json.
        pdir = config.PROJECTS_DIR / "kyrka"
        pdir.mkdir(parents=True)
        tour = {"scenes": {
            "1": {"title": "Koret", "hotSpots": [
                {"type": "info", "text": f"![](/media/1/{name})", "body": f"igen /media/1/{name}"},
            ]},
            "2": {"hotSpots": [{"type": "info", "text": f"![](/media/1/{name})"}]},
        }}
        project_files.write_tour("kyrka", tour)
        usage = media.scan_usage(1, [("kyrka", "Kyrkan")])
        check("usage hittad", name in usage)
        # Per scen: en post per (tur, scen) som refererar bilden.
        check("usage två scener", len(usage[name]) == 2)
        u1 = next(u for u in usage[name] if u["scene_id"] == "1")
        u2 = next(u for u in usage[name] if u["scene_id"] == "2")
        check("usage scen1 räknar 2", u1["count"] == 2)
        check("usage scen1 titel", u1["scene_title"] == "Koret")
        check("usage scen2 räknar 1", u2["count"] == 1)
        check("usage scen2 titel tom", u2["scene_title"] == "")
        check("usage projektnamn", u1["project"] == "Kyrkan")
        check("usage annan ägare tom", media.scan_usage(2, [("kyrka", "Kyrkan")]) == {})

        check("delete fel ägare -> False", media.delete(2, name) is False)
        check("delete egen -> True", media.delete(1, name) is True)
        check("delete igen -> False", media.delete(1, name) is False)
    finally:
        config.MEDIA_DIR, config.PROJECTS_DIR = old_media, old_projects


def test_hex():
    check("giltig hex", _hex("#a1b2c3", "#000000") == "#a1b2c3")
    check("versal hex ok", _hex("#ABCDEF", "#000000") == "#ABCDEF")
    check("för kort -> fallback", _hex("#abc", "#000000") == "#000000")
    check("ogiltig -> fallback", _hex("red", "#000000") == "#000000")
    check("injektion -> fallback", _hex("#fff;}body{x", "#000000") == "#000000")
    check("None -> fallback", _hex(None, "#123456") == "#123456")
    check("font-keys kompletta", FONT_KEYS == {"sans", "serif", "mono", "humanist"})


def test_slug_and_upload_safety():
    check("slugify åäö", slugify("Häggdångers kyrkogård") == "haggdangers-kyrkogard")
    check("slugify tom -> projekt", slugify("!!!") == "projekt")
    check("natural sort", sorted(["10", "2", "1"], key=_natural_key) == ["1", "2", "10"])
    # Path traversal neutraliseras till basnamn (ingen separator, inga ..).
    check("../evil.jpg -> evil.jpg", safe_upload_name("../evil.jpg") == "evil.jpg")
    check("a/b.jpg -> b.jpg", safe_upload_name("a/b.jpg") == "b.jpg")
    for tricky in ("../evil.jpg", "a/b/c.jpg"):
        name = safe_upload_name(tricky)
        check(f"'{tricky}' säkert basnamn", "/" not in name and ".." not in name)
    # Ogiltiga tecken / tomt ska avvisas hårt.
    for bad in ("..", "", "x;rm.jpg", "a b.jpg"):
        try:
            safe_upload_name(bad)
            check(f"avvisar '{bad}'", False)
        except HTTPException:
            check(f"avvisar '{bad}'", True)
    check("tillåter 1.jpg", safe_upload_name("1.jpg") == "1.jpg")


def test_atomic_write():
    d = Path(tempfile.mkdtemp())
    p = d / "sub" / "x.json"  # parent skapas
    _atomic_write_text(p, '{"a": 1}')
    check("atomic skrev innehåll", p.read_text(encoding="utf-8") == '{"a": 1}')
    _atomic_write_text(p, '{"a": 2}')  # skriver över
    check("atomic skrev över", p.read_text(encoding="utf-8") == '{"a": 2}')
    check("inga .tmp kvar", not list(p.parent.glob("*.tmp")))


def test_auth():
    h = hash_password("hemligt123")
    check("verify korrekt lösen", verify_password("hemligt123", h))
    check("verify fel lösen", not verify_password("fel", h))
    check("verify mot None-hash (ej satt)", not verify_password("x", None))
    check("hash != klartext", h != "hemligt123")
    # Open redirect-skydd i login-next.
    check("safe_next lokal", _safe_next("/projects/x") == "/projects/x")
    check("safe_next extern -> /", _safe_next("//evil.com") == "/")
    check("safe_next absolut-url -> /", _safe_next("http://evil.com") == "/")
    check("safe_next None -> /", _safe_next(None) == "/")
    # Inbjudnings-token (signerad, stateless).
    tok = make_invite_token(42)
    check("invite round-trip", read_invite_token(tok) == 42)
    check("invite skräp -> None", read_invite_token("nonsense") is None)
    check("invite manipulerad -> None", read_invite_token(tok[:-3] + "aaa") is None)


def test_schema_version():
    from app import config
    from app.services.backup import _check_archive_version
    from app.services.project_files import default_tour
    check("default_tour har schemaVersion", default_tour().get("schemaVersion") == config.SCHEMA_VERSION)
    # Version-gate (additiv-först): samma/äldre/saknad/ogiltig godtas, nyare avvisas.
    _check_archive_version({"version": config.SCHEMA_VERSION})
    _check_archive_version({})
    _check_archive_version({"version": "skräp"})
    _check_archive_version({"version": 0})

    def raises(m):
        try:
            _check_archive_version(m); return False
        except ValueError:
            return True
    check("nyare arkiv-version avvisas", raises({"version": config.SCHEMA_VERSION + 1}))
    check("samma version godtas (raises=False)", not raises({"version": config.SCHEMA_VERSION}))


def test_password_policy():
    from app.auth import password_error
    check("för kort avvisas", password_error("abc123") is not None)
    check("bara siffror avvisas", password_error("87654321") is not None)
    check("vanligt lösenord avvisas", password_error("password") is not None)
    check("rimligt lösenord godkänns", password_error("solros-42-blå") is None)


def test_image_dimension_guard():
    import io as _io

    from fastapi import HTTPException
    from PIL import Image as PImage

    from app import config
    from app.services.project_files import validate_image_dimensions
    buf = _io.BytesIO(); PImage.new("RGB", (12, 12)).save(buf, "PNG"); png = buf.getvalue()
    validate_image_dimensions(png, "ok.png")  # liten -> ok, ingen exception

    def raises(content, mp_cap=None):
        orig = config.MAX_IMAGE_MEGAPIXELS
        if mp_cap is not None:
            config.MAX_IMAGE_MEGAPIXELS = mp_cap
        try:
            validate_image_dimensions(content, "x.png"); return False
        except HTTPException:
            return True
        finally:
            config.MAX_IMAGE_MEGAPIXELS = orig
    check("bild över megapixel-tak avvisas", raises(png, mp_cap=0))
    check("icke-bild avvisas", raises(b"inte en bild"))


def main() -> int:
    for fn in (
        test_expected_tile_count,
        test_apply_multires,
        test_relativize,
        test_export_readiness,
        test_preset_sanitize,
        test_branding_sanitize,
        test_schema_version,
        test_password_policy,
        test_image_dimension_guard,
        test_backup_security,
        test_media_pool,
        test_hex,
        test_slug_and_upload_safety,
        test_atomic_write,
        test_auth,
    ):
        fn()
    print(f"\n{_passed} passed, {_failed} failed")
    return 1 if _failed else 0


if __name__ == "__main__":
    sys.exit(main())
