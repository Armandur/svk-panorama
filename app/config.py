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

# Delad mediepool per ägare (mediebibliotek v2): bilder som återanvänds i
# info-hotspots markdown över projekt. Lagras platt under media/<owner_id>/.
_media_env = os.environ.get("SVK_MEDIA_DIR", "media")
_media_path = Path(_media_env)
MEDIA_DIR = _media_path if _media_path.is_absolute() else REPO_ROOT / _media_path

DB_PATH = REPO_ROOT / os.environ.get("SVK_DB_FILE", "svk.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

WORKFLOW_MD_PATH = REPO_ROOT / "WORKFLOW.md"

# Schemaversion för tour.json/map.json + projektarkiv (project.json). Policy:
# ADDITIV-FÖRST - nya fält är valfria med defaultar och okända fält ignoreras vid
# läsning, så bumpa BARA vid en brytande ändring. Skrivs i tour.json (write_tour)
# och backup-manifestet; import avvisar arkiv med högre version än denna
# (se services/backup.py). Stäm av kompat-policyn i CLAUDE.md vid ändring.
SCHEMA_VERSION = 1

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

# Tiling: antal scener som tilas parallellt. Lågt default för delad VM;
# tänkt att kunna justeras i ett kommande admin-gränssnitt (skriver env/config).
TILE_CONCURRENCY = max(1, int(os.environ.get("SVK_TILE_CONCURRENCY", "2")))

# Publik bas-URL för turer/export (t.ex. https://turer.exempel.se). Tom sträng
# = använd relativa vägar / request-host. Env-default; tänkt att kunna överridas
# i ett kommande admin-gränssnitt där admin-värdet vinner över env. Konsumeras
# av bundle-export och delningslänkar (byggs senare).
BASE_URL = os.environ.get("SVK_BASE_URL", "").rstrip("/")

# Tjänstens visningsnamn (brand + sidtitlar). Env-default; super-admin kan
# override:a i DB via /admin/settings (DB-värdet vinner). Läses genom
# app/services/settings.py och exponeras som Jinja-global `site_name`.
SITE_NAME = os.environ.get("SVK_SITE_NAME", "SVK Panorama")

# Bootstrap-admin: skapas vid uppstart om inga användare finns. Sluten inbjudan
# -> ingen öppen registrering; admin bjuder in övriga.
# PRE-PRODUKTION: default admin/admin. BYT (via env) innan produktion.
ADMIN_EMAIL = os.environ.get("SVK_ADMIN_EMAIL", "admin").strip().lower()
ADMIN_PASSWORD = os.environ.get("SVK_ADMIN_PASSWORD", "admin")
