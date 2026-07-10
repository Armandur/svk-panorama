"""Filsystemslager för projekt: mappstruktur, slug, tour.json och map.json.

Geometridata (scener, positioner, länkar, hotspots) lagras alltid som
JSON-filer i projektmappen - det är samma format som Pannellum-touren och
exporten konsumerar, så det finns ingen mellanhand i databasen."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app import config


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "projekt"


def project_dir(slug: str) -> Path:
    return config.PROJECTS_DIR / slug


def images_dir(slug: str) -> Path:
    return project_dir(slug) / "images"


def map_image_path(slug: str) -> Path:
    return project_dir(slug) / config.MAP_IMAGE_FILENAME


def tour_json_path(slug: str) -> Path:
    return project_dir(slug) / "tour.json"


def map_json_path(slug: str) -> Path:
    return project_dir(slug) / "map.json"


def previews_dir(slug: str) -> Path:
    return project_dir(slug) / "previews"


def preview_path(slug: str, scene_id: str) -> Path:
    return previews_dir(slug) / f"{scene_id}.jpg"


def ensure_project_structure(slug: str) -> None:
    images_dir(slug).mkdir(parents=True, exist_ok=True)


def default_tour() -> dict[str, Any]:
    return {
        "default": {
            "autoLoad": True,
            "autoRotate": -2,
            "autoRotateInactivityDelay": 2000,
            "sceneFadeDuration": 1500,
            "editorMode": False,
            "firstScene": "",
        },
        "scenes": {},
    }


def read_tour(slug: str) -> dict[str, Any]:
    path = tour_json_path(slug)
    if not path.exists():
        return default_tour()
    return json.loads(path.read_text(encoding="utf-8"))


def write_tour(slug: str, tour: dict[str, Any]) -> None:
    tour_json_path(slug).write_text(
        json.dumps(tour, indent="\t", ensure_ascii=False), encoding="utf-8"
    )


def default_map() -> dict[str, Any]:
    return {"scenes": [], "edges": []}


def read_map(slug: str) -> dict[str, Any]:
    path = map_json_path(slug)
    if not path.exists():
        return default_map()
    return json.loads(path.read_text(encoding="utf-8"))


def write_map(slug: str, data: dict[str, Any]) -> None:
    map_json_path(slug).write_text(
        json.dumps(data, indent="\t", ensure_ascii=False), encoding="utf-8"
    )


def scene_id_from_filename(filename: str) -> str:
    return Path(filename).stem


def _natural_key(text: str) -> list:
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", text)]


def scene_source_image(slug: str, scene_id: str) -> Path | None:
    scene = read_tour(slug).get("scenes", {}).get(scene_id)
    if not scene:
        return None
    filename = Path(scene.get("panorama", "")).name
    if not filename:
        return None
    path = images_dir(slug) / filename
    return path if path.exists() else None


def generate_preview(slug: str, scene_id: str) -> Path:
    """Skapa en nedskalad equirektangulär preview för hover-förhandsvisning.
    Lat: kallas först när scenen faktiskt förhandsvisas."""
    src = scene_source_image(slug, scene_id)
    if src is None:
        raise HTTPException(status_code=404, detail=f"Scen {scene_id} saknar bild")
    from PIL import Image

    previews_dir(slug).mkdir(parents=True, exist_ok=True)
    dst = preview_path(slug, scene_id)
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > config.PREVIEW_MAX_WIDTH:
            height = round(im.height * config.PREVIEW_MAX_WIDTH / im.width)
            im = im.resize((config.PREVIEW_MAX_WIDTH, height), Image.LANCZOS)
        im.save(dst, "JPEG", quality=config.PREVIEW_QUALITY)
    return dst


def ensure_preview(slug: str, scene_id: str) -> Path:
    dst = preview_path(slug, scene_id)
    return dst if dst.exists() else generate_preview(slug, scene_id)


def clear_preview(slug: str, scene_id: str) -> None:
    dst = preview_path(slug, scene_id)
    if dst.exists():
        dst.unlink()


def list_scenes(slug: str) -> list[dict[str, Any]]:
    """Uppladdade scener med metadata, naturligt sorterade på id. `placed`
    anger om scenen har en position i map.json."""
    tour = read_tour(slug)
    placed = {s.get("id") for s in read_map(slug).get("scenes", [])}
    out = []
    for scene_id, scene in tour.get("scenes", {}).items():
        filename = Path(scene.get("panorama", "")).name
        fpath = images_dir(slug) / filename
        out.append({
            "id": scene_id,
            "filename": filename,
            "size": fpath.stat().st_size if fpath.exists() else 0,
            "placed": scene_id in placed,
        })
    out.sort(key=lambda s: _natural_key(s["id"]))
    return out


def remove_scene(slug: str, scene_id: str) -> None:
    """Ta bort en scen helt: bildfil, tour.json-post och ev. position/länkar
    i map.json."""
    tour = read_tour(slug)
    scenes = tour.get("scenes", {})
    scene = scenes.pop(scene_id, None)
    if scene is None:
        raise HTTPException(status_code=404, detail=f"Scen {scene_id} finns inte")

    filename = Path(scene.get("panorama", "")).name
    if filename:
        fpath = images_dir(slug) / filename
        if fpath.exists():
            fpath.unlink()
    clear_preview(slug, scene_id)

    default = tour.setdefault("default", default_tour()["default"])
    if default.get("firstScene") == scene_id:
        default["firstScene"] = next(iter(scenes), "")
    write_tour(slug, tour)

    map_data = read_map(slug)
    map_data["scenes"] = [s for s in map_data.get("scenes", []) if s.get("id") != scene_id]
    map_data["edges"] = [e for e in map_data.get("edges", []) if scene_id not in e]
    write_map(slug, map_data)


def merge_scene_into_tour(tour: dict[str, Any], scene_id: str, panorama_url: str) -> None:
    """Lägg till eller uppdatera en scen i tour.json. Bevarar befintliga
    hotSpots/titel om scenen redan finns (t.ex. vid omuppladdning)."""
    scenes = tour.setdefault("scenes", {})
    existing = scenes.get(scene_id, {})
    scenes[scene_id] = {
        **existing,
        "type": "equirectangular",
        "panorama": panorama_url,
        "hotSpots": existing.get("hotSpots", []),
    }
    default = tour.setdefault("default", default_tour()["default"])
    if not default.get("firstScene"):
        default["firstScene"] = scene_id


# --- Uppladdningsvalidering ------------------------------------------------

_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def safe_upload_name(filename: str) -> str:
    """Neutralisera path traversal: reducera till basnamn och tillåt bara
    ofarliga tecken. Skyddar mot filnamn som ../../evil.jpg."""
    name = Path(filename or "").name
    if not name or name in (".", "..") or not _SAFE_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail=f"Ogiltigt filnamn: {filename}")
    return name


def validate_extension(filename: str, allowed: set[str]) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Filtypen {suffix or '(okänd)'} stöds inte för {filename}",
        )
    return suffix


def validate_image_magic(content: bytes, filename: str) -> None:
    """Enkel signaturkontroll - trust but validate på systemgränsen. Skyddar
    inte mot allt, men fångar filer som bara döpts om till .jpg/.png."""
    if not (content.startswith(_JPEG_MAGIC) or content.startswith(_PNG_MAGIC)):
        raise HTTPException(
            status_code=400,
            detail=f"{filename} verkar inte vara en giltig JPEG/PNG-bild",
        )


def validate_size(content: bytes, filename: str, max_mb: int) -> None:
    max_bytes = max_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"{filename} är för stor (max {max_mb} MB)",
        )
    if len(content) == 0:
        raise HTTPException(status_code=400, detail=f"{filename} är tom")
