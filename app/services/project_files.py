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
