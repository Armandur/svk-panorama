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
from app.services.bundle import _media_refs, _prune_ghost_languages, _relativize, missing_translations  # noqa: E402
from app.services.i18n import hotspot_in_lang, og_description, tour_default_lang  # noqa: E402
from app.services.presets import (  # noqa: E402
    i18n_text_values,
    sanitize_hotspot_langs,
    sanitize_i18n_text,
    sanitize_languages,
    set_i18n_lang,
)
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
    check("media-refs hittade", refs == {("7", "ab12-karta.jpg"), ("7", "foo.png")})
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


def test_relativize_i18n():
    """Flerspråkigt textfält ({kod: text}) - referensen i EN icke-default-språk-
    variant måste hittas av _media_refs och relativiseras av _relativize, med
    dict-strukturen bevarad (inte bara den svenska strängen)."""
    tour = {
        "default": {"editorMode": True, "languages": ["sv", "en"]},
        "scenes": {
            "1": {
                "type": "equirectangular",
                "panorama": "/projects/s/images/1.jpg",
                "hotSpots": [
                    {
                        "type": "info",
                        "text": {"sv": "Ingen bild här", "en": "See ![](/media/7/bild.jpg) here"},
                    },
                ],
            },
        },
    }
    refs = _media_refs(tour)
    check("i18n media-refs hittar en-varianten", refs == {("7", "bild.jpg")})
    _relativize("nonexistent-slug", tour)
    hs = tour["scenes"]["1"]["hotSpots"][0]
    check("i18n text förblir dict", isinstance(hs["text"], dict))
    check("i18n sv-variant orörd", hs["text"]["sv"] == "Ingen bild här")
    check("i18n en-variant relativiserad", hs["text"]["en"] == "See ![](media/bild.jpg) here")


def test_i18n_helpers():
    from app import config

    # sanitize_languages: dedupe, okända koder bort, ordning bevaras, fallback.
    check("languages dedupe+ordning", sanitize_languages(["en", "sv", "en", "xx"]) == ["en", "sv"])
    check("languages okänt -> filtreras bort", sanitize_languages(["xx", "yy"]) == [config.DEFAULT_LANGUAGE])
    check("languages tom lista -> default", sanitize_languages([]) == [config.DEFAULT_LANGUAGE])
    check("languages ej lista -> default", sanitize_languages("sv") == [config.DEFAULT_LANGUAGE])
    check("languages None -> default", sanitize_languages(None) == [config.DEFAULT_LANGUAGE])

    # sanitize_i18n_text: sträng (bakåtkompat) och dict (flerspråkigt).
    check("i18n_text sträng trimmas", sanitize_i18n_text("  hej  ", 10) == "hej")
    check("i18n_text tom sträng -> None", sanitize_i18n_text("   ", 10) is None)
    check("i18n_text sträng klipps", sanitize_i18n_text("abcdefghij", 4) == "abcd")
    d = sanitize_i18n_text({"sv": " hej ", "en": "hi", "xx": "nope", "de": ""}, 10)
    check("i18n_text dict droppar okänd kod", "xx" not in d)
    check("i18n_text dict droppar tomt värde", "de" not in d)
    check("i18n_text dict trimmar", d["sv"] == "hej")
    check("i18n_text dict behåller giltiga", d["en"] == "hi")
    check("i18n_text tom dict -> None", sanitize_i18n_text({}, 10) is None)
    check("i18n_text annat -> None", sanitize_i18n_text(42, 10) is None)

    # sanitize_branding med dict-content (flerspråkig branding).
    from app.services.presets import sanitize_branding
    b = sanitize_branding({"sv": "**Församlingen**", "en": "**The Parish**"}, "large", "top-left")
    check("branding dict-content behålls som dict", isinstance(b["content"], dict))
    check("branding dict sv", b["content"]["sv"] == "**Församlingen**")
    check("branding dict en", b["content"]["en"] == "**The Parish**")
    check("branding dict size/position", b["size"] == "large" and b["position"] == "top-left")
    check("branding tom dict -> None", sanitize_branding({}, "medium", "bottom-left") is None)

    # i18n_text_values: str -> [str], dict -> värden, annat -> [].
    check("i18n_text_values sträng", i18n_text_values("hej") == ["hej"])
    check("i18n_text_values dict", sorted(i18n_text_values({"sv": "a", "en": "b"})) == ["a", "b"])
    check("i18n_text_values dict ignorerar icke-strängar", i18n_text_values({"sv": "a", "en": 5}) == ["a"])
    check("i18n_text_values None -> []", i18n_text_values(None) == [])
    check("i18n_text_values tal -> []", i18n_text_values(42) == [])

    # og_description: alla 6 språk, {name} bevaras, okänd kod -> default-språk.
    for lang, expected_start in {
        "sv": "Utforska", "en": "Explore", "de": "Entdecken",
        "fi": "Tutustu", "no": "Utforsk", "da": "Udforsk",
    }.items():
        d = og_description("Häggdånger", lang)
        check(f"og_description {lang} innehåller namnet", "Häggdånger" in d)
        check(f"og_description {lang} rätt inledning", d.startswith(expected_start))
    check("og_description okänd kod -> default-språk",
          og_description("X", "xx") == og_description("X", config.DEFAULT_LANGUAGE))

    # tour_default_lang: första i languages, saknad -> DEFAULT_LANGUAGE.
    check("tour_default_lang första i listan", tour_default_lang({"default": {"languages": ["en", "sv"]}}) == "en")
    check("tour_default_lang saknad languages -> default", tour_default_lang({"default": {}}) == config.DEFAULT_LANGUAGE)
    check("tour_default_lang saknad default -> default", tour_default_lang({}) == config.DEFAULT_LANGUAGE)

    # Additiv-först: flerspråkighet är ett rent nytt textformat (str|dict) ovanpå
    # samma tour.json-fält - äldre str-baserade turer läses precis som förut, så
    # SCHEMA_VERSION behöver INTE bumpas (jfr test_schema_version-mönstret).
    check("SCHEMA_VERSION obumpad (additiv i18n-union)", config.SCHEMA_VERSION == 1)


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
    check("nytt typsnitt dmsans behålls", sanitize_config({"theme": {"font": "dmsans"}})["theme"]["font"] == "dmsans")
    check("nytt typsnitt spectral behålls", sanitize_config({"theme": {"font": "spectral"}})["theme"]["font"] == "spectral")
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
    check("backup media_refs", _media_refs(tour) == {("7", "ab-x.jpg"), ("7", "y.png")})


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
        name = media.store("1", "min bild.jpg", buf.getvalue())
        # Oigissbart namn: hex-prefix + saniterat basnamn.
        check("store oigissbart namn", name.endswith("-min bild.jpg") is False and name.endswith(".jpg"))
        check("resolve egen fil", media.resolve("1", name) is not None)
        check("resolve fel ägare -> None", media.resolve("2", name) is None)
        check("resolve traversal -> None", media.resolve("1", "../../etc/passwd") is None)
        check("resolve okänt -> None", media.resolve("1", "saknas.jpg") is None)
        items = media.list_pool("1")
        check("list_pool en post", len(items) == 1)
        check("list_pool mått", items[0]["width"] == 40 and items[0]["height"] == 30)
        check("list_pool url", items[0]["url"] == f"/media/1/{name}")
        check("list_pool thumb-url", items[0]["thumb"] == f"/media/1/thumb/{name}")
        # Visningsnamn = originalnamnet (saniterat) utan hex-prefix.
        check("display_name strippar hex-prefix", media.display_name(name) == "min-bild.jpg")
        check("list_pool orig", items[0]["orig"] == "min-bild.jpg")
        # Tumnagel genereras + cachas, och ligger i dold .thumbs (ej listad).
        th = media.ensure_thumb("1", name)
        check("ensure_thumb skapar fil", th is not None and th.is_file())
        check("thumb ligger i .thumbs", th.parent.name == ".thumbs")
        check("list_pool listar ej thumben", len(media.list_pool("1")) == 1)

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
        usage = media.scan_usage("1", [("kyrka", "Kyrkan")])
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
        check("usage annan ägare tom", media.scan_usage("2", [("kyrka", "Kyrkan")]) == {})

        check("delete fel ägare -> False", media.delete("2", name) is False)
        check("delete egen -> True", media.delete("1", name) is True)
        check("delete igen -> False", media.delete("1", name) is False)

        # Team-nyckel: egen namnrymd (team-<id>) skild från solo (<user_id>).
        tname = media.store("team-1", "logga.png", buf.getvalue())
        check("team-pool resolve", media.resolve("team-1", tname) is not None)
        check("team-pool url-prefix", media.media_url("team-1", tname) == f"/media/team-1/{tname}")
        check("solo ser inte team-poolen", media.resolve("1", tname) is None)
        # Ägar-nyckel-validering (serve-routen litar på denna mot traversal).
        check("valid key: siffror", media.valid_owner_key("42"))
        check("valid key: team-", media.valid_owner_key("team-42"))
        check("invalid key: traversal", not media.valid_owner_key("../etc"))
        check("invalid key: godtycklig", not media.valid_owner_key("team-x"))
        check("resolve ogiltig nyckel -> None", media.resolve("../../etc", "passwd") is None)
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
    # Fallback = /editor (/ är publik landningssida, inte inloggningsmål).
    check("safe_next extern -> /editor", _safe_next("//evil.com") == "/editor")
    check("safe_next absolut-url -> /editor", _safe_next("http://evil.com") == "/editor")
    check("safe_next None -> /editor", _safe_next(None) == "/editor")
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


def test_translate_helpers():
    # set_i18n_lang: sträng -> {default_lang: sträng}, sätt nytt målspråk -> dict.
    check("set_i18n_lang sträng+nytt mål -> dict", set_i18n_lang("Hej", "en", "Hi", "sv") == {"sv": "Hej", "en": "Hi"})
    # None-nuvarande + nytt mål -> dict utan default_lang-nyckel (källan var tom).
    check("set_i18n_lang None+nytt mål -> dict utan källa", set_i18n_lang(None, "en", "Hi", "sv") == {"en": "Hi"})
    # dict, sätt/överskriv ett målspråk - övriga nycklar orörda.
    d = set_i18n_lang({"sv": "Hej", "en": "Old"}, "en", " Hi ", "sv")
    check("set_i18n_lang dict trimmar + skriver över", d == {"sv": "Hej", "en": "Hi"})
    # Tom sträng -> tar bort språknyckeln i stället för att spara "". Bara
    # default_lang-nyckeln kvar efteråt -> kollapsas direkt till ren sträng.
    check("set_i18n_lang tom -> tar bort nyckel + kollapsar", set_i18n_lang({"sv": "Hej", "en": "Hi"}, "en", "   ", "sv") == "Hej")
    # Tom sträng men EN TREDJE språknyckel kvar -> dicten kollapsar inte.
    check("set_i18n_lang tom men fler språk kvar -> dict", set_i18n_lang({"sv": "Hej", "en": "Hi", "de": "Hallo"}, "en", "", "sv") == {"sv": "Hej", "de": "Hallo"})
    # Bara default_lang-nyckeln kvar -> kollapsa till ren sträng.
    check("set_i18n_lang kollaps till sträng", set_i18n_lang({"sv": "Hej", "en": "Hi"}, "en", "", "sv") == "Hej")
    # Allt borttaget -> None.
    check("set_i18n_lang tomt -> None", set_i18n_lang({"en": "Hi"}, "en", "", "sv") is None)
    check("set_i18n_lang None+tom -> None", set_i18n_lang(None, "en", "", "sv") is None)
    # Okänt/annat värde (t.ex. int) -> behandlas som tomt, bygger ändå upp dict.
    check("set_i18n_lang annat värde -> ignoreras som bas", set_i18n_lang(42, "en", "Hi", "sv") == {"en": "Hi"})

    # Redigera KÄLLSPRÅKET (lang == default_lang) via /translate ("Alla texter"-
    # läget) - routes/translate.py tillåter numera payload.lang == vilket som
    # helst av tour.default.languages (inte bara målspråk), set_i18n_lang sköter
    # resten: uppdaterar källnyckeln, övriga målspråk orörda.
    d = set_i18n_lang({"sv": "Gammal", "en": "Hi", "de": "Hallo"}, "sv", " Ny källtext ", "sv")
    check("set_i18n_lang redigera källspråk -> källnyckel uppdateras, mål orörda", d == {"sv": "Ny källtext", "en": "Hi", "de": "Hallo"})
    check("set_i18n_lang töm källspråk -> källnyckel bort, mål kvar", set_i18n_lang({"sv": "Hej", "en": "Hi"}, "sv", "", "sv") == {"en": "Hi"})
    check("set_i18n_lang sätt källspråk på sträng-fält -> ren sträng", set_i18n_lang("Gammal", "sv", "Ny", "sv") == "Ny")

    # missing_translations: samma definition som static/translate.js gap-scan.
    check("missing_translations enspråkig -> 0", missing_translations({"default": {"languages": ["sv"]}, "scenes": {}}) == 0)
    check("missing_translations ingen languages -> 0", missing_translations({"scenes": {}}) == 0)

    tour = {
        "default": {"languages": ["sv", "en", "de"]},
        "scenes": {
            "1": {
                "title": "Kyrkan",  # ren sträng -> lucka för BÅDA målspråken
                "hotSpots": [
                    {"type": "info", "text": {"sv": "Info", "en": "Info EN"}},  # sv+en ifyllt -> lucka bara de
                    {"type": "info", "text": {"sv": "Klocka"}, "expandable": True, "body": {"sv": "Lång text"}},  # text: lucka en+de, body (expandable): lucka en+de
                    {"type": "info", "text": {"sv": "Ej expanderbar"}, "body": {"sv": "Ignoreras"}},  # body ska INTE räknas (ej expandable)
                    {"type": "info", "text": {"sv": ""}},  # tom källtext -> ingen lucka alls
                ],
            },
        },
    }
    n = missing_translations(tour)
    # title (2: en,de) + hotspot0.text (1: de) + hotspot1.text (2: en,de) +
    # hotspot1.body (2: en,de) + hotspot2.text (2: en,de; body ignoreras, ej
    # expandable) + hotspot3 (0: tom källtext) = 9
    check("missing_translations räknar rätt antal", n == 9)

    # branding.content räknas också, och kollapsar korrekt vid full täckning.
    tour2 = {
        "default": {"languages": ["sv", "en"], "branding": {"content": {"sv": "Logga", "en": "Logo"}}},
        "scenes": {"1": {"title": {"sv": "Kyrkan", "en": "Church"}}},
    }
    check("missing_translations allt översatt -> 0", missing_translations(tour2) == 0)

    # Språkbegränsad hotspot (hs.langs): ska INTE ge luckor för uteslutna mål.
    tour3 = {
        "default": {"languages": ["sv", "en", "de"]},
        "scenes": {
            "1": {
                "title": "Kyrkan",  # ren sträng -> lucka för BÅDA målspråken (2)
                "hotSpots": [
                    # Bara "en" -> ingen lucka alls (en är redan i langs, de är utesluten).
                    {"type": "info", "text": {"sv": "Info"}, "langs": ["en"]},
                    # Expanderbar, begränsad till en+de -> luckor för båda (text+body).
                    {"type": "info", "text": {"sv": "Klocka"}, "expandable": True, "body": {"sv": "Lång"}, "langs": ["en", "de"]},
                ],
            },
        },
    }
    n3 = missing_translations(tour3)
    # title (2: en,de) + hotspot0.text (bara "en" i langs -> 1 lucka, "de" är
    # exkluderad och räknas inte) + hotspot1.text (langs en+de -> 2 luckor) +
    # hotspot1.body (samma, expandable -> 2 luckor) = 2+1+2+2 = 7
    check("missing_translations hoppar över exkluderade mål", n3 == 7)

    # Föräldralöst fält (fynd 1): källtext (sv) TOM men målspråk har text ->
    # räknas som 1 lucka (källan måste fyllas, annars fel fallback + osynligt).
    tour4 = {
        "default": {"languages": ["sv", "en", "de"]},
        "scenes": {
            "1": {
                "title": {"en": "Church"},  # orphan: ingen sv, en finns -> 1
                "hotSpots": [
                    {"type": "info", "text": {"en": "Bell"}},  # orphan, källspråk gäller -> 1
                    # Källspråket (sv) exkluderat via langs -> källtext förväntas
                    # saknas, INGEN orphan-lucka (source_applies=False).
                    {"type": "info", "text": {"de": "Glocke"}, "langs": ["en", "de"]},
                    {"type": "info", "text": {"en": ""}},  # tomt mål också -> 0
                ],
            },
        },
    }
    check("missing_translations orphan-källspråk = 1 lucka per fält", missing_translations(tour4) == 2)


def test_sanitize_hotspot_langs():
    tl = ["sv", "en", "de"]
    check("hs_langs giltig delmängd behålls", sanitize_hotspot_langs(["en", "de"], tl) == ["en", "de"])
    check("hs_langs täcker alla -> None", sanitize_hotspot_langs(["sv", "en", "de"], tl) is None)
    check("hs_langs droppar okända koder", sanitize_hotspot_langs(["en", "xx"], tl) == ["en"])
    check("hs_langs dedupe + ordning", sanitize_hotspot_langs(["en", "en", "sv"], tl) == ["en", "sv"])
    check("hs_langs tom lista -> None", sanitize_hotspot_langs([], tl) is None)
    check("hs_langs bara ogiltiga -> None", sanitize_hotspot_langs(["xx", "zz"], tl) is None)
    check("hs_langs icke-lista -> None", sanitize_hotspot_langs("en", tl) is None)
    # Utan turspråk faller täcker-alla-guarden bort -> giltig kod behålls.
    check("hs_langs utan turspråk behåller giltig kod", sanitize_hotspot_langs(["en"], []) == ["en"])


def test_prune_ghost_languages():
    # Bundle-export ska bara skeppa aktiva språk (tour.default.languages). Spöktext
    # (kod ej i listan, kvar sedan språket togs bort) rensas ur KOPIAN, disk orörd.
    tour = {
        "default": {
            "languages": ["sv", "en"],
            "branding": {"content": {"sv": "![](/media/1/a.jpg)", "de": "![](/media/1/ghost.jpg)"}},
        },
        "scenes": {
            "1": {
                "title": {"sv": "Kyrkan", "en": "Church", "de": "Kirche"},
                "hotSpots": [
                    {"type": "info", "text": {"sv": "![](/media/1/used.jpg)", "de": "![](/media/1/onlyghost.jpg)"}},
                    {"type": "info", "text": {"de": "bara spöke"}},  # helt ghost -> fältet tas bort
                    {"type": "info", "text": "Ren sträng"},  # ren sträng orörd
                ],
            },
        },
    }
    _prune_ghost_languages(tour)
    check("prune: title tappar spök-de", tour["scenes"]["1"]["title"] == {"sv": "Kyrkan", "en": "Church"})
    check("prune: hotspot-text tappar spök-de", tour["scenes"]["1"]["hotSpots"][0]["text"] == {"sv": "![](/media/1/used.jpg)"})
    check("prune: helt spök-fält tas bort", "text" not in tour["scenes"]["1"]["hotSpots"][1])
    check("prune: ren sträng orörd", tour["scenes"]["1"]["hotSpots"][2]["text"] == "Ren sträng")
    check("prune: branding tappar spök-de", tour["default"]["branding"]["content"] == {"sv": "![](/media/1/a.jpg)"})
    # Efter prune: media-refs innehåller bara aktiva bilder, INTE ghost-only.
    refs = _media_refs(tour)
    check("prune: ghost-only-bilder bundlas inte", ("1", "onlyghost.jpg") not in refs and ("1", "ghost.jpg") not in refs)
    check("prune: aktiva bilder kvar i refs", ("1", "used.jpg") in refs and ("1", "a.jpg") in refs)
    # Utan languages (monospråkig/äldre tur) -> rör inget (kan inte avgöra aktiva).
    mono = {"default": {}, "scenes": {"1": {"title": {"sv": "X", "de": "Y"}}}}
    _prune_ghost_languages(mono)
    check("prune: utan languages -> orört", mono["scenes"]["1"]["title"] == {"sv": "X", "de": "Y"})


def test_hotspot_in_lang():
    check("hotspot_in_lang inget langs-fält -> alla språk", hotspot_in_lang({}, "en") is True)
    check("hotspot_in_lang tom langs-lista -> alla språk", hotspot_in_lang({"langs": []}, "de") is True)
    check("hotspot_in_lang matchande kod -> True", hotspot_in_lang({"langs": ["en", "de"]}, "en") is True)
    check("hotspot_in_lang icke-matchande kod -> False", hotspot_in_lang({"langs": ["en"]}, "sv") is False)
    check("hotspot_in_lang icke-lista langs -> alla språk", hotspot_in_lang({"langs": "en"}, "sv") is True)


def test_history():
    import json

    from app import config
    from app.services import history

    tmp = Path(tempfile.mkdtemp())
    tour = tmp / "tour.json"
    map_ = tmp / "map.json"
    hist = tmp / "_history"

    # Ny tur (inga filer) -> inget att arkivera.
    check("history: tom tur -> None", history.snapshot(tmp) is None)

    tour.write_text('{"scenes": {"a": {}}}', encoding="utf-8")
    map_.write_text('{"scenes": [], "edges": []}', encoding="utf-8")

    v1 = history.snapshot(tmp)
    check("history: första snapshot skapas", v1 is not None)
    check("history: unified (båda filer arkiverade)",
          (hist / str(v1) / "tour.json").exists() and (hist / str(v1) / "map.json").exists())

    # Coalesce: en ny snapshot direkt (inom fönstret) skapas inte.
    check("history: coalesce inom fönster -> None", history.snapshot(tmp) is None)
    # force kringgår coalesce.
    vf = history.snapshot(tmp, force=True)
    check("history: force kringgår coalesce", vf is not None and vf != v1)

    orig_coalesce = config.HISTORY_COALESCE_SEC
    config.HISTORY_COALESCE_SEC = 0  # stäng av coalesce -> testa dedup rent
    try:
        check("history: dedup oförändrat -> None", history.snapshot(tmp) is None)
        tour.write_text('{"scenes": {"a": {}, "b": {}}}', encoding="utf-8")
        v2 = history.snapshot(tmp)
        check("history: ändrat innehåll -> ny version", v2 is not None)
    finally:
        config.HISTORY_COALESCE_SEC = orig_coalesce

    versions = history.list_versions(tmp)
    ids = [v["id"] for v in versions]
    check("history: nyast först", ids == sorted(ids, reverse=True))
    check("history: metadata scenantal (nyaste=2)", versions[0]["scenes"] == 2)

    # Restore-kärnan: arkivera nuläget (a,b) force, läs v1, skriv tillbaka (bara a).
    history.snapshot(tmp, force=True)
    data = history.read_version(tmp, v1)
    check("history: read_version ger tour.json", "tour.json" in data)
    tour.write_text(json.dumps(data["tour.json"]), encoding="utf-8")
    check("history: restore ger v1-innehåll", set(json.loads(tour.read_text())["scenes"]) == {"a"})
    archived = [json.loads((hist / str(v["id"]) / "tour.json").read_text())
                for v in history.list_versions(tmp)]
    check("history: nuläget arkiverat före restore (reversibelt)",
          any(set(c.get("scenes", {})) == {"a", "b"} for c in archived))

    try:
        history.read_version(tmp, 1)
        check("history: okänd version kastar KeyError", False)
    except KeyError:
        check("history: okänd version kastar KeyError", True)

    # Retention: antalstak när golvet är av.
    orig_max, orig_floor = config.HISTORY_MAX, config.HISTORY_FLOOR_DAYS
    config.HISTORY_COALESCE_SEC = 0
    config.HISTORY_MAX = 3
    config.HISTORY_FLOOR_DAYS = 0
    try:
        for i in range(8):
            tour.write_text(json.dumps({"scenes": {str(k): {} for k in range(i + 3)}}), encoding="utf-8")
            history.snapshot(tmp)
        check("history: retention antalstak (MAX=3)", len(history.list_versions(tmp)) == 3)
        # Regression: restore-kärnans ordning måste vara läs-FÖRST. Att återställa
        # den ÄLDSTA synliga versionen när historiken är full -> force-snapshotten
        # prunar bort den. Läser vi den innan snapshot överlever den; annars KeyError.
        oldest = history.list_versions(tmp)[-1]["id"]
        data = history.read_version(tmp, oldest)   # läs FÖRST
        history.snapshot(tmp, force=True)          # prunar bort oldest
        check("history: äldsta versionen läst före prune (ingen KeyError)", "tour.json" in data)
        check("history: oldest verkligen prunad efter snapshot",
              not (tmp / "_history" / str(oldest)).exists())
    finally:
        config.HISTORY_COALESCE_SEC = orig_coalesce
        config.HISTORY_MAX = orig_max
        config.HISTORY_FLOOR_DAYS = orig_floor


def test_history_attribution():
    import json

    from app.services import history

    tmp = Path(tempfile.mkdtemp())
    tour = tmp / "tour.json"

    def save(state, editor):
        # Speglar write_tour-ordningen: snapshot (taggar med nuvarande _pending) ->
        # avancera _pending -> skriv nytt läge. force för distinkta arkiv i testet.
        history.snapshot(tmp, force=True)
        history.set_pending_editor(tmp, editor)
        tour.write_text(json.dumps(state), encoding="utf-8")

    A = {"by": 1, "name": "Alice"}
    B = {"by": 2, "name": "Bob"}
    D = {"by": 4, "name": "Dan"}
    save({"scenes": {"1": {}}}, A)               # L1 av Alice (inget arkiv än)
    save({"scenes": {"1": {}, "2": {}}}, B)      # arkiverar L1 -> meta Alice
    save({"scenes": {"1": {}, "2": {}, "3": {}}}, {"by": 3, "name": "Carol"})  # arkiverar L2 -> meta Bob

    names = [v["editor"]["name"] if v["editor"] else None for v in history.list_versions(tmp)]
    # Pre-overwrite: ett arkiverat läge attribueras till den som SKAPADE det (föregående spar).
    check("attrib: nyaste arkiv = Bob (skapade L2)", names[0] == "Bob")
    check("attrib: äldre arkiv = Alice (skapade L1)", names[1] == "Alice")

    # None-hålet (advisor): ett systemutlöst spar får INTE ärva föregående editor.
    save({"scenes": {"a": {}}}, None)            # arkiverar Carols läge; _pending -> okänd
    save({"scenes": {"a": {}, "b": {}}}, D)      # arkiverar det okända läget -> meta okänd, INTE Carol
    top = history.list_versions(tmp)[0]["editor"]
    check("attrib: systemspar -> okänd (inte föregående editor)",
          top is not None and top.get("by") is None and top.get("name") is None)


def test_history_diff():
    from app.services import historydiff as hd

    def group(groups, title):
        return next((g for g in groups if g["title"] == title), None)

    def kinds(items):
        return sorted((i["kind"], i["text"]) for i in items)

    old = {
        "tour.json": {
            "default": {
                "languages": ["sv"],
                "theme": {"font": "sans", "dotColor": "#111111"},
                "branding": {"content": "Gammal", "size": "medium", "position": "bottom-right"},
                "autoRotate": -2,
            },
            "scenes": {
                "1": {"title": "Koret", "panorama": "/i/1.jpg",
                      "hotSpots": [{"id": 0, "type": "info", "text": "A"},
                                   {"id": 1, "type": "scene", "sceneId": "2"}]},
                "2": {"title": "Långhuset", "panorama": "/i/2.jpg", "hotSpots": []},
            },
        },
        "map.json": {
            "scenes": [{"id": "1", "position": {"x": 10, "y": 10}},
                       {"id": "2", "position": {"x": 50, "y": 50}}],
            "edges": [{"from": "1", "to": "2", "twoway": True}],
        },
    }
    new = {
        "tour.json": {
            "default": {
                "languages": ["sv", "en"],
                "theme": {"font": "serif", "dotColor": "#111111"},
                "branding": {"content": "Ny text", "size": "large", "position": "bottom-right"},
                "autoRotate": -2,
            },
            "scenes": {
                "1": {"title": "Altaret", "panorama": "/i/1.jpg",
                      "hotSpots": [{"id": 0, "type": "info", "text": "A2"},
                                   {"id": 2, "type": "url", "text": "Länk"}]},
                "3": {"title": "Tornet", "panorama": "/i/3.jpg", "hotSpots": []},
            },
        },
        "map.json": {
            "scenes": [{"id": "1", "position": {"x": 10, "y": 10}},
                       {"id": "3", "position": {"x": 80, "y": 20}}],
            "edges": [{"from": "1", "to": "3", "twoway": False}],
        },
    }

    groups = hd.diff(old, new)
    titles = [g["title"] for g in groups]
    check("diff: grupper i ordning", titles == ["Scener", "Språk", "Tema", "Branding", "Karta"])

    scener = group(groups, "Scener")["items"]
    # Scen 3 tillagd, scen 2 borttagen, scen 1 ändrad.
    check("diff: scen tillagd", any(i["kind"] == "added" and "Tornet" in i["text"] for i in scener))
    check("diff: scen borttagen", any(i["kind"] == "removed" and "Långhuset" in i["text"] for i in scener))
    changed = next(i for i in scener if i["kind"] == "changed")
    check("diff: ändrad scen = Altaret", "Altaret" in changed["text"])
    check("diff: ändrad scen collapsible", changed.get("collapsible") is True)
    kids = changed["children"]
    check("diff: titeländring bland children", any("titel" in c["text"] for c in kids))
    # Hotspots ligger under en semantisk sektionsnod.
    hs_sec = next(c for c in kids if c.get("kind") == "section" and c["text"] == "Hotspots")
    hs = hs_sec["children"]
    check("diff: hotspot tillagd (url/länk)", any(s["kind"] == "added" and "länk" in s["text"] for s in hs))
    check("diff: hotspot borttagen (scen)", any(s["kind"] == "removed" and "scen 2" in s["text"] for s in hs))
    hs_changed = next(s for s in hs if s["kind"] == "changed")
    check("diff: ändrad hotspot har fält-children", bool(hs_changed.get("children")))
    check("diff: hotspot fältnivå text gammalt->nytt",
          any("text:" in f["text"] and "A" in f["text"] for f in hs_changed["children"]))

    check("diff: språk +en", kinds(group(groups, "Språk")["items"]) == [("added", "en")])
    check("diff: tema font ändrad", any("typsnitt" in i["text"] for i in group(groups, "Tema")["items"]))
    brand = group(groups, "Branding")["items"]
    check("diff: branding text + storlek", any("text" in i["text"] for i in brand) and any("storlek" in i["text"] for i in brand))

    karta = group(groups, "Karta")["items"]
    kt = " | ".join(i["kind"] + ":" + i["text"] for i in karta)
    check("diff: scen placerad/borttagen/länk", "placerad" in kt and "borttagen" in kt and "länk" in kt)

    # Riktning: base=current bygger diff(nuläge, version) så "+" = vad en restore
    # lägger tillbaka. Omvänd riktning byter added<->removed.
    fwd = group(hd.diff(old, new), "Scener")["items"]
    rev = group(hd.diff(new, old), "Scener")["items"]
    check("diff: riktning A->B Tornet added", any(i["kind"] == "added" and "Tornet" in i["text"] for i in fwd))
    check("diff: riktning B->A Tornet removed", any(i["kind"] == "removed" and "Tornet" in i["text"] for i in rev))

    # Identiska relevanta fält -> inga grupper.
    check("diff: identiskt -> tomt", hd.diff(old, old) == [])
    # Saknad map.json i en snapshot hanteras (bara tour jämförs).
    check("diff: saknad map ok", isinstance(hd.diff({"tour.json": old["tour.json"]}, {"tour.json": new["tour.json"]}), list))


def main() -> int:
    for fn in (
        test_expected_tile_count,
        test_apply_multires,
        test_relativize,
        test_relativize_i18n,
        test_i18n_helpers,
        test_translate_helpers,
        test_sanitize_hotspot_langs,
        test_prune_ghost_languages,
        test_hotspot_in_lang,
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
        test_history,
        test_history_attribution,
        test_history_diff,
    ):
        fn()
    print(f"\n{_passed} passed, {_failed} failed")
    return 1 if _failed else 0


if __name__ == "__main__":
    sys.exit(main())
