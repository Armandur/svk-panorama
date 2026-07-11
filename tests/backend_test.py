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

from app.routes.preview import FONT_KEYS, _hex  # noqa: E402
from app.services.bundle import _relativize  # noqa: E402
from app.services.project_files import _natural_key, safe_upload_name, slugify  # noqa: E402
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
    _relativize("nonexistent-slug", tour)  # tom manifest -> apply_multires no-op
    check("basePath relativ", tour["scenes"]["1"]["multiRes"]["basePath"] == "tiles/1")
    check("panorama relativ", tour["scenes"]["2"]["panorama"] == "images/2.jpg")
    check("editorMode av", tour["default"]["editorMode"] is False)
    # Sökvägar ska aldrig vara absoluta/utbrytande efter relativisering.
    bp = tour["scenes"]["1"]["multiRes"]["basePath"]
    check("basePath ej absolut", not bp.startswith("/") and ".." not in bp)


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


def main() -> int:
    for fn in (
        test_expected_tile_count,
        test_apply_multires,
        test_relativize,
        test_hex,
        test_slug_and_upload_safety,
    ):
        fn()
    print(f"\n{_passed} passed, {_failed} failed")
    return 1 if _failed else 0


if __name__ == "__main__":
    sys.exit(main())
