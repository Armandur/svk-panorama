"""Konstanter och miljövariabler för svk-panorama-editorn."""
from __future__ import annotations

import os
import secrets
from pathlib import Path

# Repo-roten: två nivåer upp från denna fil (app/config.py -> app/ -> roten).
REPO_ROOT = Path(__file__).resolve().parent.parent

PORT = int(os.environ.get("SVK_PORT", "8002"))
HOST = os.environ.get("SVK_HOST", "0.0.0.0")

_projects_env = os.environ.get("SVK_PROJECTS_DIR", "projects")
_projects_path = Path(_projects_env)
PROJECTS_DIR = _projects_path if _projects_path.is_absolute() else REPO_ROOT / _projects_path

DB_PATH = REPO_ROOT / os.environ.get("SVK_DB_FILE", "svk.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

WORKFLOW_MD_PATH = REPO_ROOT / "WORKFLOW.md"

# Hemlighet för CSRF-signering. Genereras per processtart om inget env-värde
# finns - gör att CSRF-cookies satta innan en omstart av dev-servern blir
# ogiltiga, vilket är helt okej för detta lokala verktyg.
SECRET_KEY = os.environ.get("SVK_SECRET_KEY") or secrets.token_hex(32)

# Uppladdning: panoramabilder.
ALLOWED_PANORAMA_EXT = {".jpg", ".jpeg", ".png"}
MAX_PANORAMA_MB = int(os.environ.get("SVK_MAX_PANORAMA_MB", "80"))

# Uppladdning: kartbild.
ALLOWED_MAP_EXT = {".jpg", ".jpeg", ".png"}
MAX_MAP_MB = int(os.environ.get("SVK_MAX_MAP_MB", "20"))

MAP_IMAGE_FILENAME = "map.png"

# Preview: nedskalad equirektangulär bild för auto-roterande hover-förhandsvisning.
PREVIEW_MAX_WIDTH = int(os.environ.get("SVK_PREVIEW_MAX_WIDTH", "2048"))
PREVIEW_QUALITY = int(os.environ.get("SVK_PREVIEW_QUALITY", "82"))
