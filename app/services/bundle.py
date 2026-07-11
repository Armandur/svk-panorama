"""Bundle-export: bygg en självbärande zip (tiles + JSON + templatead viewer +
vendored pannellum + hosting-instruktioner) att lägga på valfri webbserver.

Alla sökvägar görs relativa så bundlen fungerar oavsett underkatalog och utan
server-kod. Bygget körs i en bakgrundstråd med progress, som tiling."""
from __future__ import annotations

import threading
import zipfile
from pathlib import Path
from typing import Any

from app import config
from app.deps import templates
from app.services.project_files import (
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


def _relativize(slug: str, tour: dict) -> dict:
    """Applicera multires och gör alla asset-sökvägar relativa till bundle-roten."""
    apply_multires(tour, read_manifest(slug))
    for scene_id, scene in tour.get("scenes", {}).items():
        if scene.get("type") == "multires" and scene.get("multiRes"):
            scene["multiRes"]["basePath"] = f"tiles/{scene_id}"
        elif scene.get("type") == "equirectangular" and scene.get("panorama"):
            scene["panorama"] = "images/" + Path(scene["panorama"]).name
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
        "  images/       - originalbilder for ev. otilade scener\n"
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


def _collect(slug: str, tour: dict) -> list[tuple[str, Path]]:
    """(arcname, källfil) för allt statiskt som ska med i zipen."""
    files: list[tuple[str, Path]] = []

    td = tiles_dir(slug)
    if td.exists():
        for f in td.rglob("*"):
            if f.is_file() and f.name != "manifest.json":
                files.append(("tiles/" + f.relative_to(td).as_posix(), f))

    # Originalbilder bara för scener som inte blev multires (saknar tiles).
    for scene in tour.get("scenes", {}).values():
        if scene.get("type") == "equirectangular" and scene.get("panorama"):
            fn = Path(scene["panorama"]).name
            src = images_dir(slug) / fn
            if src.exists():
                files.append(("images/" + fn, src))

    for name in ("pannellum.js", "pannellum.css"):
        files.append((name, _VENDOR / name))
    for name in ("viewer.js", "viewer.css"):
        files.append((name, _STATIC / name))
    if map_image_path(slug).exists():
        files.append(("map.png", map_image_path(slug)))
    return files


def _build(slug: str, project_name: str) -> None:
    job = _jobs[slug]
    try:
        tour = _relativize(slug, read_tour(slug))
        map_data = read_map(slug)
        has_map = map_image_path(slug).exists()
        index_html = templates.env.get_template("bundle_index.html").render(
            project_name=project_name, tour=tour, map_data=map_data, has_map_image=has_map
        )
        generated = [
            ("index.html", index_html.encode("utf-8")),
            ("README.txt", _readme(project_name, slug).encode("utf-8")),
        ]
        files = _collect(slug, tour)
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


def start_job(slug: str, project_name: str) -> dict[str, Any]:
    with _lock:
        existing = _jobs.get(slug)
        if existing and existing["status"] == "running":
            return existing
        job = {"status": "running", "total": 0, "done": 0, "error": None}
        _jobs[slug] = job
    threading.Thread(target=_build, args=(slug, project_name), daemon=True).start()
    return job


def state(slug: str) -> dict[str, Any]:
    return {
        "job": _jobs.get(slug),
        "hasZip": zip_path(slug).exists(),
        "tileable": len(tileable_scenes(slug)),
        "tiled": len(read_manifest(slug)),
    }
