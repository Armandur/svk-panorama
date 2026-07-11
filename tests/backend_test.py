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

        # Usage-scan mot en turs tour.json.
        pdir = config.PROJECTS_DIR / "kyrka"
        pdir.mkdir(parents=True)
        tour = {"scenes": {"1": {"hotSpots": [
            {"type": "info", "text": f"![](/media/1/{name})", "body": f"igen /media/1/{name}"},
        ]}}}
        project_files.write_tour("kyrka", tour)
        usage = media.scan_usage(1, [("kyrka", "Kyrkan")])
        check("usage hittad", name in usage)
        check("usage räknar 2", usage[name][0]["count"] == 2)
        check("usage projektnamn", usage[name][0]["name"] == "Kyrkan")
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


def main() -> int:
    for fn in (
        test_expected_tile_count,
        test_apply_multires,
        test_relativize,
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
