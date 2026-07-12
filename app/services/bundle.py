"""Bundle-export: bygg en självbärande zip (tiles + JSON + templatead viewer +
vendored pannellum + hosting-instruktioner) att lägga på valfri webbserver.

Alla sökvägar görs relativa så bundlen fungerar oavsett underkatalog och utan
server-kod. Bygget körs i en bakgrundstråd med progress, som tiling."""
from __future__ import annotations

import re
import threading
import zipfile
from pathlib import Path
from typing import Any

from app import config
from app.deps import templates
from app.services import media
from app.services.project_files import (
    _natural_key,
    images_dir,
    map_image_path,
    project_dir,
    read_map,
    read_tour,
)
from app.services.tiling import apply_multires, read_manifest, tileable_scenes, tiles_dir

_VENDOR = config.REPO_ROOT / "app" / "static" / "vendor"
_STATIC = config.REPO_ROOT / "app" / "static"

# Redan komprimerade filtyper lagras utan omkomprimering (snabbare, samma storlek).
_STORED_EXT = {".jpg", ".jpeg", ".png", ".tif"}

_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()

# Poolbilds-URL i hotspot-markdown: /media/<owner_id>/<filnamn>. Bundlen kopierar
# de refererade filerna till media/<filnamn> och skriver om URL:erna dit.
_MEDIA_REF_RE = re.compile(r"/media/(\d+)/([A-Za-z0-9._-]+)")


def export_dir(slug: str) -> Path:
    return project_dir(slug) / "_export"


def zip_path(slug: str) -> Path:
    return export_dir(slug) / f"{slug}.zip"


def job_status(slug: str) -> dict[str, Any] | None:
    return _jobs.get(slug)


def forget_job(slug: str) -> None:
    """Glöm in-memory-exportjobb för en slug (t.ex. när turen raderas)."""
    with _lock:
        _jobs.pop(slug, None)


def _media_refs(tour: dict) -> set[tuple[int, str]]:
    """(owner_id, filnamn) för alla poolbilder som refereras i hotspot-markdown."""
    refs: set[tuple[int, str]] = set()
    for scene in tour.get("scenes", {}).values():
        for hs in scene.get("hotSpots", []):
            for key in ("text", "body"):
                val = hs.get(key)
                if isinstance(val, str):
                    for m in _MEDIA_REF_RE.finditer(val):
                        refs.add((int(m.group(1)), m.group(2)))
    return refs


def _relativize(slug: str, tour: dict) -> dict:
    """Applicera multires och gör alla asset-sökvägar relativa till bundle-roten."""
    apply_multires(tour, read_manifest(slug))
    for scene_id, scene in tour.get("scenes", {}).items():
        if scene.get("type") == "multires" and scene.get("multiRes"):
            scene["multiRes"]["basePath"] = f"tiles/{scene_id}"
        elif scene.get("type") == "equirectangular" and scene.get("panorama"):
            scene["panorama"] = "images/" + Path(scene["panorama"]).name
        # Poolbilds-URL:er i info-hotspots markdown (teaser/body) -> relativa.
        for hs in scene.get("hotSpots", []):
            for key in ("text", "body"):
                if isinstance(hs.get(key), str):
                    hs[key] = _MEDIA_REF_RE.sub(r"media/\2", hs[key])
    tour.setdefault("default", {})["editorMode"] = False
    return tour


def _readme(project_name: str, slug: str) -> str:
    return (
        f"{project_name} - virtuell rundtur (self-host-bundle)\n"
        f"{'=' * 60}\n\n"
        "Innehall:\n"
        "  index.html    - oppna denna for att visa turen\n"
        "  pannellum.*   - panoramabiblioteket (vendored)\n"
        "  viewer.*      - visningslogik\n"
        "  tiles/        - multires-kakel per scen\n"
        "  images/       - kalla-panorama (otilade scener; ev. alla vid arkiv-export)\n"
        "  map.png       - oversiktskarta\n\n"
        "Hosting:\n"
        "  Lagg hela mappen pa valfri webbserver och peka besokaren pa index.html.\n"
        "  Alla sokvagar ar relativa, sa det fungerar oavsett underkatalog\n"
        f"  (t.ex. https://exempel.se/turer/{slug}/). Ingen server-kod kravs -\n"
        "  det ar rena statiska filer.\n\n"
        "  Lokalt test: kor en enkel statisk server i mappen, t.ex.\n"
        "    python3 -m http.server 8000\n"
        "  och oppna http://localhost:8000/\n\n"
        "Skapad med SVK Panorama.\n"
    )


def _collect(
    slug: str, tour: dict, media_refs: set[tuple[int, str]], include_originals: bool = False
) -> list[tuple[str, Path]]:
    """(arcname, källfil) för allt statiskt som ska med i zipen."""
    files: list[tuple[str, Path]] = []
    img_added: set[str] = set()

    td = tiles_dir(slug)
    if td.exists():
        for f in td.rglob("*"):
            if f.is_file() and f.name != "manifest.json":
                files.append(("tiles/" + f.relative_to(td).as_posix(), f))

    # Bara de poolbilder som faktiskt refereras i turen (inte hela poolen).
    for owner_id, name in media_refs:
        src = media.resolve(owner_id, name)
        if src is not None:
            files.append(("media/" + name, src))

    # Originalbilder krävs för scener som inte blev multires (saknar tiles) -
    # vieweren visar dem equirektangulärt.
    for scene in tour.get("scenes", {}).values():
        if scene.get("type") == "equirectangular" and scene.get("panorama"):
            fn = Path(scene["panorama"]).name
            src = images_dir(slug) / fn
            if src.exists():
                files.append(("images/" + fn, src))
                img_added.add(fn)

    # Opt-in: arkivera ALLA källoriginal (även tilade scener) så bundlen kan
    # åter-tilas/återredigeras senare. Utan detta är bundlen en ren visningskopia.
    if include_originals:
        idir = images_dir(slug)
        if idir.exists():
            for f in sorted(idir.iterdir()):
                if f.is_file() and f.name not in img_added:
                    files.append(("images/" + f.name, f))
                    img_added.add(f.name)

    for name in ("pannellum.js", "pannellum.css"):
        files.append((name, _VENDOR / name))
    for name in ("viewer.js", "viewer.css"):
        files.append((name, _STATIC / name))
    # Markdown-rendering av info-hotspots i den publicerade turen.
    files.append(("marked.min.js", _VENDOR / "marked" / "marked.min.js"))
    files.append(("purify.min.js", _VENDOR / "dompurify" / "purify.min.js"))
    files.append(("markdown.js", _STATIC / "markdown.js"))
    if map_image_path(slug).exists():
        files.append(("map.png", map_image_path(slug)))
    return files


def _build(slug: str, project_name: str, include_originals: bool = False) -> None:
    job = _jobs[slug]
    try:
        raw_tour = read_tour(slug)
        media_refs = _media_refs(raw_tour)  # innan URL:erna relativiseras bort
        tour = _relativize(slug, raw_tour)
        map_data = read_map(slug)
        has_map = map_image_path(slug).exists()
        index_html = templates.env.get_template("bundle_index.html").render(
            project_name=project_name, tour=tour, map_data=map_data, has_map_image=has_map
        )
        generated = [
            ("index.html", index_html.encode("utf-8")),
            ("README.txt", _readme(project_name, slug).encode("utf-8")),
        ]
        files = _collect(slug, tour, media_refs, include_originals)
        job["total"] = len(files) + len(generated)

        export_dir(slug).mkdir(parents=True, exist_ok=True)
        tmp = zip_path(slug).with_suffix(".tmp")
        root = slug  # allt hamnar under en <slug>/-mapp i zipen
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for arc, path in files:
                ctype = zipfile.ZIP_STORED if path.suffix.lower() in _STORED_EXT else zipfile.ZIP_DEFLATED
                z.write(path, f"{root}/{arc}", compress_type=ctype)
                job["done"] += 1
            for arc, data in generated:
                z.writestr(f"{root}/{arc}", data)
                job["done"] += 1
        tmp.replace(zip_path(slug))
        job["status"] = "done"
    except Exception as exc:  # noqa: BLE001 - visa felet i UI:t
        job["status"] = "error"
        job["error"] = str(exc)


def start_job(slug: str, project_name: str, include_originals: bool = False) -> dict[str, Any]:
    with _lock:
        existing = _jobs.get(slug)
        if existing and existing["status"] == "running":
            return existing
        job = {"status": "running", "total": 0, "done": 0, "error": None}
        _jobs[slug] = job
    threading.Thread(target=_build, args=(slug, project_name, include_originals), daemon=True).start()
    return job


def readiness(slug: str) -> list[dict[str, str]]:
    """Icke-blockerande förvarningar inför export: samma kriterier som editorns
    per-steg-readiness (plan.js/scene.js) fast samlat. Varnar men stoppar inte -
    en tur kan ha medvetna 'dead ends'. Returnerar [{level, msg}]."""
    tour = read_tour(slug)
    scenes = tour.get("scenes", {})
    issues: list[dict[str, str]] = []
    if not scenes:
        return [{"level": "warn", "msg": "Turen har inga scener än."}]

    mp = read_map(slug)
    placed = {s.get("id") for s in mp.get("scenes", [])}
    linked: set = set()
    for e in mp.get("edges", []):
        linked.add(e.get("from"))
        linked.add(e.get("to"))

    def _fmt(ids: list) -> str:
        return ", ".join(sorted(ids, key=_natural_key))

    unplaced = [sid for sid in scenes if sid not in placed]
    if unplaced:
        issues.append({"level": "warn", "msg": f"{len(unplaced)} oplacerade scener (scen {_fmt(unplaced)}) - saknar position på kartan."})

    if len(scenes) > 1:
        isolated = [sid for sid in scenes if sid in placed and sid not in linked]
        if isolated:
            issues.append({"level": "warn", "msg": f"{len(isolated)} scener utan länk (scen {_fmt(isolated)}) - besökaren kan inte navigera dit."})

    uncal = [sid for sid in scenes if sid in linked and scenes[sid].get("northOffset") is None]
    if uncal:
        issues.append({"level": "warn", "msg": f"Okalibrerade scener (scen {_fmt(uncal)}) - hotspot-riktningar kan bli fel."})

    dangling = {
        hs.get("sceneId")
        for sc in scenes.values()
        for hs in sc.get("hotSpots", [])
        if hs.get("type") == "scene" and hs.get("sceneId") not in scenes
    }
    if dangling:
        issues.append({"level": "warn", "msg": f"{len(dangling)} scen-hotspots pekar mot en borttagen scen."})

    first = tour.get("default", {}).get("firstScene")
    if first and first not in scenes:
        issues.append({"level": "warn", "msg": "Startscenen finns inte längre - välj en ny i turinställningarna."})

    return issues


def state(slug: str) -> dict[str, Any]:
    return {
        "job": _jobs.get(slug),
        "hasZip": zip_path(slug).exists(),
        "tileable": len(tileable_scenes(slug)),
        "tiled": len(read_manifest(slug)),
        "readiness": readiness(slug),
    }
