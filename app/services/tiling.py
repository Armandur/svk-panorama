"""Multires-tiling av projektbilder via pannellums generate.py (Docker).

Tiles skrivs som ren bilddata till projects/<slug>/tiles/<sceneId>/ och
multiRes-blocken sparas i tiles/manifest.json. Turen görs INTE om till
multires på disk - `apply_multires()` lägger på blocken först vid visning
eller export, så tour.json förblir en ren equirektangulär sanningskälla och
hotspot-ändringar inte kräver om-tiling.

Varje scen läggs som ett eget jobb i den globala jobbkön (app/services/jobqueue.py)
- SVK_JOB_WORKERS är den globala samtidighetsgränsen, delad med export/backup.
Status pollas via `job_status()`."""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from app.services import jobqueue
from app.services.project_files import (
    _atomic_write_text,
    _natural_key,
    project_dir,
    read_tour,
    scene_source_image,
)

DOCKER_IMAGE = "pannellum-multires"

# Jobbstatus per slug (single-worker lokalverktyg -> in-memory räcker).
_jobs: dict[str, dict[str, Any]] = {}
_start_lock = threading.Lock()
_manifest_lock = threading.Lock()
# Skyddar _finalize_job:s läs-modifiera-skriv av job["status"]. EN global lock
# (inte per-job) - job-dicten returneras rakt av som JSON via /tile-job/status
# (routes/tiling.py), så den får INTE innehålla ett Lock-objekt (osserialiserbart).
# Finalize är billigt -> en delad global lock kostar ingen märkbar genomströmning.
_finalize_lock = threading.Lock()


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
    # Atomiskt -> pollande läsare (status/preview/view) ser aldrig en truncerad fil.
    _atomic_write_text(manifest_path(slug), json.dumps(data, indent="\t", ensure_ascii=False))


def drop_scene_tiles(slug: str, scene_id: str) -> None:
    """Ta bort en scens tiles + manifestpost (vid borttagen/ersatt bild)."""
    job = _jobs.get(slug)
    # Rör inte tile-katalogen om ett jobb kör - Docker kan skriva där just nu.
    # Nästa tiling rmtree:ar den ändå innan omgenerering.
    if not (job and job["status"] == "running"):
        scene_tiles = tiles_dir(slug) / scene_id
        if scene_tiles.exists():
            shutil.rmtree(scene_tiles, ignore_errors=True)
    # Läs-modifiera-skriv under samma lås som tiling-trådarna använder.
    with _manifest_lock:
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


def forget_job(slug: str) -> None:
    """Glöm in-memory-jobbstatus för en slug (t.ex. när turen raderas). En
    ev. redan startad tråd är daemon och avslutar av sig själv."""
    with _start_lock:
        _jobs.pop(slug, None)


def all_jobs() -> dict[str, dict[str, Any]]:
    """Ögonblicksbild av alla in-memory-jobb för bulk-polling. Kopieras under
    _start_lock så en samtidig jobbstart inte ändrar dictens storlek under
    iteration (RuntimeError)."""
    with _start_lock:
        return dict(_jobs)


def project_tile_state(slug: str) -> dict[str, Any]:
    """Sammanfattad tiling-status för en tur, för badge på lista/hemsida.
    status: running | done | error | partial | none."""
    job = _jobs.get(slug)
    tiled = len(read_manifest(slug))
    tileable = len(tileable_scenes(slug))
    if job:
        return {
            "status": job["status"],
            "done": job["done"],
            "total": job["total"],
            "tiled": tiled,
            "tileable": tileable,
        }
    if tileable == 0:
        status = "none"
    elif tiled >= tileable:
        status = "done"
    else:
        status = "partial"
    return {"status": status, "done": tiled, "total": tileable, "tiled": tiled, "tileable": tileable}


_TILE_SIZE = 512  # generate.py:s default (vi skickar inte --tileSize)


def _expected_tile_count(image_fs: Path) -> int | None:
    """Förväntat antal tile-jpg som generate.py skriver, härlett ur bildmåtten
    (replikerar generate.py:s cube/level-matte). None om inte en 2:1-full-pano."""
    from PIL import Image

    with Image.open(image_fs) as im:
        w, h = im.size
    if h == 0 or abs(w / h - 2) > 0.02:
        return None  # partiell pano: tiles kan hoppas över, exakt räkning svår
    cube = 8 * int(w / math.pi / 8)
    ts = min(_TILE_SIZE, cube)
    if ts <= 0:
        return None
    levels = int(math.ceil(math.log(cube / ts, 2))) + 1
    if int(cube / 2 ** (levels - 2)) == ts:
        levels -= 1
    total, size = 0, cube
    for _ in range(levels):
        t = math.ceil(size / ts)
        total += t * t
        size = int(size / 2)
    return total * 6  # 6 kubsidor


def _count_in(path: Path) -> int:
    try:
        return sum(1 for _ in os.scandir(path))
    except OSError:
        return 0


def _file_progress(out_dir: Path, expected: int | None) -> tuple[int, str]:
    """Härled progress + fas-etikett ur filerna generate.py skrivit hittills."""
    # Tiles ligger i numeriskt namngivna nivåmappar; fallback separat.
    tiles = 0
    try:
        for entry in os.scandir(out_dir):
            if entry.is_dir() and entry.name.isdigit():
                tiles += _count_in(entry.path)
    except OSError:
        pass

    if tiles == 0:
        # Kubfas: nona skriver face0000.tif..face0005.tif en i taget.
        faces = 0
        try:
            faces = sum(
                1 for e in os.scandir(out_dir)
                if e.name.startswith("face") and e.name.endswith(".tif")
            )
        except OSError:
            pass
        return min(30, 5 + round(faces / 6 * 25)), "kubfaces"

    fallback = _count_in(out_dir / "fallback")
    if fallback > 0:
        return min(98, 90 + round(fallback / 6 * 8)), "fallback"
    if expected:
        return min(89, 30 + round(tiles / expected * 59)), "genererar tiles"
    return 60, "genererar tiles"


def _run_docker(image_fs: Path, out_dir: Path, quality: int, on_progress=None) -> dict[str, Any]:
    """Kör generate.py i Docker, skriv tiles till out_dir, returnera config.
    En watcher-tråd räknar skrivna filer och rapporterar finkornig progress via
    on_progress(procent, etikett) medan huvudtråden läser stdout (för felsvans)."""
    out_parent = out_dir.parent
    out_parent.mkdir(parents=True, exist_ok=True)
    # Rensa ev. gamla tiles så inte stale nivåer blir kvar vid om-tiling.
    if out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)

    expected = _expected_tile_count(image_fs)
    uid, gid = os.getuid(), os.getgid()
    cmd = [
        "docker", "run", "--rm",
        "--user", f"{uid}:{gid}",
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

    stop = threading.Event()

    def watch():
        last = 0
        while not stop.wait(0.4):
            if on_progress:
                pct, label = _file_progress(out_dir, expected)
                if pct >= last:  # låt aldrig baren backa
                    last = pct
                    on_progress(pct, label)

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()

    tail: list[str] = []
    try:
        for line in proc.stdout:
            tail.append(line.rstrip())
            if len(tail) > 15:
                tail.pop(0)
    finally:
        # Stoppa watcher-tråden även om stdout-läsningen kastar (t.ex. bruten
        # pipe om Docker-daemonen dör) - annars läcker den och pollar vidare.
        stop.set()
        watcher.join(timeout=1)
    proc.wait()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, output="\n".join(tail))
    return json.loads((out_dir / "config.json").read_text(encoding="utf-8"))


def pending_scenes(slug: str) -> list[tuple[str, Path]]:
    """Tileable scener som ännu saknar tiles (inte i manifestet)."""
    manifest = read_manifest(slug)
    return [(sid, img) for sid, img in tileable_scenes(slug) if sid not in manifest]


def _tile_one(slug: str, quality: int, scene_id: str, image_fs: Path, entry: dict, job: dict) -> None:
    """Tila en scen och skriv in dess multiRes i manifestet (under lås)."""
    entry["status"] = "running"
    entry["progress"] = 5
    entry["stage"] = "startar"

    def on_stage(pct, label):
        entry["progress"] = pct
        entry["stage"] = label

    out_dir = tiles_dir(slug) / scene_id
    config = _run_docker(image_fs, out_dir, quality, on_stage)
    multires = config["multiRes"]
    multires["basePath"] = f"/projects/{slug}/tiles/{scene_id}"
    # Läs-modifiera-skriv av manifestet måste serialiseras mellan trådarna.
    with _manifest_lock:
        manifest = read_manifest(slug)
        manifest[scene_id] = multires
        write_manifest(slug, manifest)
        job["done"] += 1
    entry["status"] = "done"
    entry["progress"] = 100
    entry["stage"] = "klar"


def _finalize_job(slug: str, job: dict) -> None:
    """Anropas efter VARJE scen-jobb (av en jobqueue-worker - kan hända för
    flera scener "samtidigt" och i GODTYCKLIG ordning, kön ger inga garantier).
    Sätter turens overall-status EXAKT EN GÅNG, när ALLA dess scen-jobb är
    terminal (done/error) - skyddat av jobbets egna lås så out-of-order-
    slutförande aldrig race:ar eller dubbel-finaliserar."""
    entries = job["scenes"]
    with _finalize_lock:
        if job["status"] != "running":
            return  # redan finaliserat av en annan scens worker
        if any(e["status"] not in ("done", "error") for e in entries):
            return  # väntar fortfarande på andra scener i kön
        errors = [f"scen {e['id']}: {e['error_detail']}" for e in entries if e["status"] == "error"]
        job["status"] = "error" if errors else "done"
        if errors:
            job["error"] = "; ".join(errors)
    if errors:
        from app.services import joblog
        joblog.append(slug, "tiling", job["error"])  # persistent så felet överlever omstart
    # Kakel skrevs -> töm diskcachen så kvot-grinden ser den nya storleken direkt.
    from app.services import storage
    storage.invalidate(project_dir(slug))


def _run_scene_job(slug: str, quality: int, scene_id: str, image_fs: Path, entry: dict, job: dict) -> None:
    """EN jobqueue-arbetsenhet: tila en enda scen. Körs av en worker-tråd i den
    globala kön (fire-and-forget - blockerar aldrig på ett annat kö-jobb).
    Fångar ALLA fel själv (annars dör workern tyst och entry/job fastnar på
    'running' utan spår) och finaliserar turens overall-status när sista scenen
    i turen är klar."""
    try:
        _tile_one(slug, quality, scene_id, image_fs, entry, job)
    except Exception as exc:  # noqa: BLE001 - visa felet i UI:t
        entry["status"] = "error"
        entry["stage"] = "fel"
        entry["error_detail"] = str(getattr(exc, "output", None) or exc)
    finally:
        _finalize_job(slug, job)


def start_job(slug: str, quality: int | None = None) -> dict[str, Any]:
    """Starta tiling för scener som saknar tiles. Redan tilade scener hoppas
    över, så om-uppladdning av en scen inte re-tilar allt. quality=None ->
    super-admins inställning (env-default + DB-override).

    Varje scen läggs som ETT EGET jobb i den globala jobbkön (jobqueue.py) -
    INGEN egen per-tur trådpool längre, så den globala samtidighetsgränsen
    (SVK_JOB_WORKERS) gäller oavsett hur många turer som tilar samtidigt."""
    if quality is None:
        from app.services import settings
        quality = settings.get_int("tile_quality")
    with _start_lock:
        existing = _jobs.get(slug)
        if existing and existing["status"] == "running":
            return existing
        scenes = pending_scenes(slug)
        job = {
            "status": "running",
            "total": len(scenes),
            "done": 0,
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
    entries = {s["id"]: s for s in job["scenes"]}
    for sid, img in scenes:
        entry = entries[sid]
        jobqueue.submit(
            lambda sid=sid, img=img, entry=entry: _run_scene_job(slug, quality, sid, img, entry, job),
            kind="tiling",
            slug=slug,
            scene_id=sid,
        )
    return job
