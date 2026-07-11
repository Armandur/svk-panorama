"""Multires-tiling av projektbilder via pannellums generate.py (Docker).

Tiles skrivs som ren bilddata till projects/<slug>/tiles/<sceneId>/ och
multiRes-blocken sparas i tiles/manifest.json. Turen görs INTE om till
multires på disk - `apply_multires()` lägger på blocken först vid visning
eller export, så tour.json förblir en ren equirektangulär sanningskälla och
hotspot-ändringar inte kräver om-tiling.

Jobbet körs i en bakgrundstråd; status pollas via `job_status()`."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from app.services.project_files import (
    _natural_key,
    project_dir,
    read_tour,
    scene_source_image,
)

DOCKER_IMAGE = "pannellum-multires"

# Jobbstatus per slug (single-worker lokalverktyg -> in-memory räcker).
_jobs: dict[str, dict[str, Any]] = {}
_start_lock = threading.Lock()


def tiles_dir(slug: str) -> Path:
    return project_dir(slug) / "tiles"


def manifest_path(slug: str) -> Path:
    return tiles_dir(slug) / "manifest.json"


def read_manifest(slug: str) -> dict[str, Any]:
    path = manifest_path(slug)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_manifest(slug: str, data: dict[str, Any]) -> None:
    tiles_dir(slug).mkdir(parents=True, exist_ok=True)
    manifest_path(slug).write_text(
        json.dumps(data, indent="\t", ensure_ascii=False), encoding="utf-8"
    )


def drop_scene_tiles(slug: str, scene_id: str) -> None:
    """Ta bort en scens tiles + manifestpost (vid borttagen/ersatt bild)."""
    scene_tiles = tiles_dir(slug) / scene_id
    if scene_tiles.exists():
        shutil.rmtree(scene_tiles, ignore_errors=True)
    manifest = read_manifest(slug)
    if scene_id in manifest:
        del manifest[scene_id]
        write_manifest(slug, manifest)


def apply_multires(tour: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    """Byt equirektangulära scener mot multires där tiles finns. Muterar och
    returnerar samma tur-dict (kalla på en kopia som ska serveras/exporteras)."""
    scenes = tour.get("scenes", {})
    for scene_id, multires in manifest.items():
        scene = scenes.get(scene_id)
        if scene is None:
            continue
        scene["type"] = "multires"
        scene["multiRes"] = multires
        scene.pop("panorama", None)
    return tour


def tileable_scenes(slug: str) -> list[tuple[str, Path]]:
    """Scener som kan tilas: equirektangulära med en bildfil på disk."""
    tour = read_tour(slug)
    out: list[tuple[str, Path]] = []
    for scene_id, scene in tour.get("scenes", {}).items():
        if scene.get("type") != "equirectangular":
            continue
        img = scene_source_image(slug, scene_id)
        if img is not None:
            out.append((scene_id, img))
    out.sort(key=lambda pair: _natural_key(pair[0]))
    return out


def job_status(slug: str) -> dict[str, Any] | None:
    return _jobs.get(slug)


# generate.py skriver ut sina faser på stdout; vi mappar dem till ungefärlig
# progress inom en scen så baren rör sig i stället för att stå still ~20s.
_STAGES = [
    ("Processing input", 10, "läser bild"),
    ("Generating cube faces", 30, "kubfaces"),
    ("Generating tiles", 65, "genererar tiles"),
    ("Generating fallback", 90, "fallback"),
]


def _run_docker(image_fs: Path, out_dir: Path, quality: int, on_stage=None) -> dict[str, Any]:
    """Kör generate.py i Docker, skriv tiles till out_dir, returnera config.
    Streamar stdout och rapporterar faser via on_stage(progress, etikett)."""
    out_parent = out_dir.parent
    out_parent.mkdir(parents=True, exist_ok=True)
    # Rensa ev. gamla tiles så inte stale nivåer blir kvar vid om-tiling.
    if out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)

    uid, gid = os.getuid(), os.getgid()
    cmd = [
        "docker", "run", "--rm",
        "--user", f"{uid}:{gid}",
        # Obuffrat -> generate.py:s fas-rader når oss live (annars kommer de i
        # en klump vid slutet och progress-baren hoppar direkt till klar).
        "-e", "PYTHONUNBUFFERED=1",
        "-v", f"{image_fs.parent}:/in:ro",
        "-v", f"{out_parent}:/out",
        DOCKER_IMAGE,
        "--quality", str(quality),
        "--output", f"/out/{out_dir.name}",
        f"/in/{image_fs.name}",
    ]
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    tail: list[str] = []
    for line in proc.stdout:
        tail.append(line.rstrip())
        if len(tail) > 15:
            tail.pop(0)
        if on_stage:
            for key, pct, label in _STAGES:
                if key in line:
                    on_stage(pct, label)
                    break
    proc.wait()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, output="\n".join(tail))
    return json.loads((out_dir / "config.json").read_text(encoding="utf-8"))


def pending_scenes(slug: str) -> list[tuple[str, Path]]:
    """Tileable scener som ännu saknar tiles (inte i manifestet)."""
    manifest = read_manifest(slug)
    return [(sid, img) for sid, img in tileable_scenes(slug) if sid not in manifest]


def _run_job(slug: str, quality: int, scenes: list[tuple[str, Path]]) -> None:
    job = _jobs[slug]
    entries = {s["id"]: s for s in job["scenes"]}
    manifest = read_manifest(slug)
    try:
        for scene_id, image_fs in scenes:
            job["current"] = scene_id
            entry = entries[scene_id]
            entry["status"] = "running"
            entry["progress"] = 5
            entry["stage"] = "startar"

            def on_stage(pct, label, _e=entry):
                _e["progress"] = pct
                _e["stage"] = label

            out_dir = tiles_dir(slug) / scene_id
            config = _run_docker(image_fs, out_dir, quality, on_stage)
            multires = config["multiRes"]
            multires["basePath"] = f"/projects/{slug}/tiles/{scene_id}"
            manifest[scene_id] = multires
            write_manifest(slug, manifest)  # skriv löpande -> överlever avbrott
            entry["status"] = "done"
            entry["progress"] = 100
            entry["stage"] = "klar"
            job["done"] += 1
        job["current"] = None
        job["status"] = "done"
    except (subprocess.CalledProcessError, Exception) as exc:  # noqa: BLE001 - visa felet i UI:t
        cur = job.get("current")
        if cur and cur in entries:
            entries[cur]["status"] = "error"
            entries[cur]["stage"] = "fel"
        detail = getattr(exc, "output", None) or exc
        job["status"] = "error"
        job["error"] = f"scen {cur}: {detail}"


def start_job(slug: str, quality: int = 80) -> dict[str, Any]:
    """Starta ett tiling-jobb för scener som saknar tiles. Redan tilade
    scener hoppas över, så om-uppladdning av en scen inte re-tilar allt."""
    with _start_lock:
        existing = _jobs.get(slug)
        if existing and existing["status"] == "running":
            return existing
        scenes = pending_scenes(slug)
        job = {
            "status": "running",
            "total": len(scenes),
            "done": 0,
            "current": None,
            "error": None,
            "scenes": [
                {"id": sid, "status": "pending", "progress": 0, "stage": ""}
                for sid, _ in scenes
            ],
        }
        _jobs[slug] = job
    if not scenes:
        job["status"] = "done"
        return job
    threading.Thread(target=_run_job, args=(slug, quality, scenes), daemon=True).start()
    return job
