"""Engångskonvertering: legacy statiska Pannellum-turer -> editorns projektformat.

Legacy-turerna (js/app.js + `<xx>/*.html` + `images/<xx>/<namn>/`) publiceras via
`loadPanorama("/images/<xx>/<namn>/<namn>.json"[, ".../map.json"])`. Formatet är i
princip editorns redan: `default` + `scenes{ id: {type, panorama, hotSpots} }` och
`map.json` = `{scenes:[{id, position}]}`. Skillnaderna vi överbryggar:

  - panorama-sökväg `/images/<xx>/<namn>/<fil>.jpg` -> `/projects/<slug>/images/<fil>.jpg`
    (+ kopiera in jpg:erna) så `scene_source_image`/viewern hittar dem.
  - default-blocket kompletteras med editor-defaultar (languages, mapSize saknas -> ärvs).
  - map.json får `edges` härledda ur scen-hotspots (bygghjälp i plan-vyn; legacy saknar dem).
  - En DB-rad (Project, ägd av bootstrap-admin, personlig) skapas per tur.

Kör INTE tiling (tungt: 20-25 MB/bild x ~366 scener) - starta det per tur i editorn
efteråt. Idempotent på slug: en redan importerad slug hoppas (om inte --force).

Körning:  .venv/bin/python tools/import_legacy.py [--only <dir|slug>] [--list] [--force]
  --list          visa upptäckta legacy-turer, importera inget
  --only X        importera bara turen vars legacy-dir (t.ex. ho/hoga) eller slug matchar X
  --force         importera även om slugen redan finns (skriver om filerna, behåller DB-raden)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config
from app.database import Project, SessionLocal, User
from app.services.project_files import (
    ensure_project_structure,
    images_dir,
    map_image_path,
    map_json_path,
    project_dir,
    slugify,
    tour_json_path,
    write_map,
    write_tour,
)

REPO = config.REPO_ROOT
_LOADPANO = re.compile(r'loadPanorama\(\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?')
_TITLE = re.compile(r"<title>([^<]*)</title>", re.IGNORECASE)

# KOORDINATOMRÄKNING: legacy (css/map.css) visade kartbilden `#map2` med fast
# `width: 400px` (height auto) och lagrade prick-positioner som råa pixel-offset i
# DET visningsrummet (js/map.js: style.left = position.x + 'px'). Editorn använder
# kartans NATURLIGA pixlar (plan.js viewBox = 0..naturalWidth; viewer x/naturalWidth).
# -> skala med naturalWidth/400 (aspekt bevarad -> samma faktor i y). Legacy ankrade
# prickens övre vänstra hörn (`.map-button` 15px, position=left/top); editorn centrerar
# pricken -> lägg på en halv prick (7.5px i 400-rummet) före skalning.
LEGACY_MAP_DISPLAY_WIDTH = 400
LEGACY_DOT_HALF = 7.5


def discover() -> list[dict]:
    """Publicerade legacy-turer via loadPanorama-anrop i `<xx>/*.html`."""
    tours = []
    for html in sorted(REPO.glob("*/*.html")):
        # Hoppa app-/dev-/tmp-mappar - bara riktiga tur-HTML i roten.
        if html.parts[len(REPO.parts)] in {"app", "dev", "tmp", "tests", "tools", "node_modules"}:
            continue
        txt = html.read_text(encoding="utf-8", errors="ignore")
        m = _LOADPANO.search(txt)
        if not m or "jsonPath" in m.group(1):  # hoppa den generiska mallen
            continue
        tj = m.group(1).lstrip("/")            # images/xx/namn/namn.json
        tour_dir = str(Path(tj).parent)        # images/xx/namn
        title_m = _TITLE.search(txt)
        tours.append({
            "html": str(html.relative_to(REPO)),
            "dir": tour_dir[len("images/"):] if tour_dir.startswith("images/") else tour_dir,
            "tour_json": REPO / tj,
            "map_json": (REPO / m.group(2).lstrip("/")) if m.group(2) else None,
            "title": (title_m.group(1).strip() if title_m else Path(tj).stem),
        })
    return tours


def _unique_slug(db, base: str) -> str:
    slug = base or "importerad-tur"
    n = 2
    while db.query(Project).filter(Project.slug == slug).first() is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


def _build_tour(legacy: dict, slug: str) -> tuple[dict, list[tuple[Path, str]]]:
    """Bygg editor-tour.json + lista (källbild, målfilnamn) att kopiera in i images/."""
    data = json.loads(legacy["tour_json"].read_text(encoding="utf-8"))
    ld = data.get("default", {}) or {}
    scenes_in = data.get("scenes", {}) or {}

    copies: list[tuple[Path, str]] = []
    scenes_out: dict = {}
    src_dir = legacy["tour_json"].parent
    for sid, s in scenes_in.items():
        pano = s.get("panorama", "")
        fname = Path(pano).name
        scene = {
            "type": "equirectangular",
            "panorama": f"/projects/{slug}/images/{fname}",
            "hotSpots": s.get("hotSpots", []) or [],
        }
        # Bevara ev. startriktning om legacy hade den (annars ärvs editor-default).
        for k in ("yaw", "pitch", "title"):
            if k in s:
                scene[k] = s[k]
        scenes_out[sid] = scene
        if fname:
            copies.append((src_dir / fname, fname))

    tour = {
        "default": {
            "autoLoad": True,
            "autoRotate": ld.get("autoRotate", -2),
            "autoRotateInactivityDelay": ld.get("autoRotateInactivityDelay", 2000),
            "sceneFadeDuration": ld.get("sceneFadeDuration", 1500),
            "editorMode": False,
            "firstScene": str(ld.get("firstScene", "") or ""),
            "languages": [config.DEFAULT_LANGUAGE],
        },
        "scenes": scenes_out,
    }
    return tour, copies


def _build_map(legacy: dict, tour: dict) -> dict:
    """map.json: legacy-positioner (omskalade från 400px-visningsrum till kartans
    naturliga pixlar, se konstanterna ovan) + edges härledda ur scen-hotspots."""
    positions = []
    mj = legacy["map_json"]
    if mj and mj.exists():
        m = json.loads(mj.read_text(encoding="utf-8"))
        raw = m.get("scenes", []) if isinstance(m, dict) else []
        # Skalfaktor ur kartbildens naturliga bredd (legacy visade den i 400px).
        scale = None
        png = mj.parent / "map.png"
        if png.exists() and raw:
            from PIL import Image
            with Image.open(png) as im:
                scale = im.width / LEGACY_MAP_DISPLAY_WIDTH
        for s in raw:
            pos = s.get("position") or {}
            x, y = pos.get("x"), pos.get("y")
            if scale is not None and x is not None and y is not None:
                x = round((x + LEGACY_DOT_HALF) * scale, 1)
                y = round((y + LEGACY_DOT_HALF) * scale, 1)
            positions.append({"id": str(s.get("id")), "position": {"x": x, "y": y}})
    edges, seen = [], set()
    for sid, s in tour["scenes"].items():
        for h in s.get("hotSpots", []):
            if h.get("type") == "scene" and h.get("sceneId") is not None:
                a, b = str(sid), str(h["sceneId"])
                key = tuple(sorted((a, b)))
                if a == b or key in seen:
                    continue
                seen.add(key)
                edges.append({"from": a, "to": b, "twoway": True})
    return {"scenes": positions, "edges": edges}


def import_one(db, admin: User, legacy: dict, force: bool) -> str:
    base = slugify(legacy["title"]) or slugify(legacy["dir"].replace("/", "-"))
    existing = db.query(Project).filter(Project.slug == base).first()
    if existing is not None and not force:
        return f"HOPPAR {legacy['dir']} -> slug '{base}' finns redan (använd --force)"
    slug = base if (force and existing) else _unique_slug(db, base)

    tour, copies = _build_tour(legacy, slug)
    mp = _build_map(legacy, tour)

    if existing is None:
        db.add(Project(slug=slug, name=legacy["title"], owner_id=admin.id, team_id=None))
        db.commit()
    ensure_project_structure(slug)

    # Kopiera panoramabilder.
    missing = 0
    for src, fname in copies:
        if src.exists():
            shutil.copy2(src, images_dir(slug) / fname)
        else:
            missing += 1
    # Kartbild om den finns.
    map_note = "ingen karta"
    if legacy["map_json"] and legacy["map_json"].exists():
        src_png = legacy["map_json"].parent / "map.png"
        if src_png.exists():
            shutil.copy2(src_png, map_image_path(slug))
            map_note = f"karta ({len(mp['scenes'])} prickar, {len(mp['edges'])} länkar)"

    editor = {"by": admin.id, "name": admin.name or admin.email}
    write_tour(slug, tour, editor=editor)
    write_map(slug, mp, editor=editor)

    warn = f" [VARNING: {missing} saknade bilder]" if missing else ""
    return f"OK   {legacy['dir']:14} -> {slug:28} ({len(tour['scenes'])} scener, {map_note}){warn}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="legacy-dir (ho/hoga) eller slug-fragment")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    tours = discover()
    if args.only:
        tours = [t for t in tours if args.only in t["dir"] or args.only in slugify(t["title"])]
    if args.list:
        for t in tours:
            has_map = "karta" if (t["map_json"] and t["map_json"].exists()) else "-----"
            print(f"{t['dir']:14} {has_map}  {t['title']}")
        print(f"\n{len(tours)} turer")
        return 0

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == config.ADMIN_EMAIL).first()
        if admin is None:
            print("FEL: bootstrap-admin saknas (starta appen en gång först).")
            return 1
        for t in tours:
            print(import_one(db, admin, t, args.force))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
