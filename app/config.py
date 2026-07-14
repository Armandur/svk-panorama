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

# Bakom en reverse proxy (produktion) är request.client.host proxyns IP - då blir
# alla klienter samma IP och rate limiting värdelös. Sätt SVK_TRUST_PROXY=1 bara när
# appen körs bakom en betrodd proxy som sätter X-Forwarded-For; annars (default) är
# den AV så en klient inte kan spoofa sin IP via headern.
TRUST_PROXY = os.environ.get("SVK_TRUST_PROXY", "").strip().lower() in ("1", "true", "yes", "on")

# Uppladdning: panoramabilder.
ALLOWED_PANORAMA_EXT = {".jpg", ".jpeg", ".png"}
MAX_PANORAMA_MB = int(os.environ.get("SVK_MAX_PANORAMA_MB", "80"))

# Uppladdning: kartbild.
ALLOWED_MAP_EXT = {".jpg", ".jpeg", ".png"}
MAX_MAP_MB = int(os.environ.get("SVK_MAX_MAP_MB", "20"))

# Skydd mot dekomprimeringsbomber: en liten fil kan ha enorma pixelmått. Utöver
# MB-taket avvisas bilder över detta megapixel-tak. Generöst satt (panorama är
# stora, equirektangulärt), men stoppar gigapixel-bomber.
MAX_IMAGE_MEGAPIXELS = int(os.environ.get("SVK_MAX_IMAGE_MP", "300"))

MAP_IMAGE_FILENAME = "map.png"

# Preview: nedskalad equirektangulär bild för auto-roterande hover-förhandsvisning.
PREVIEW_MAX_WIDTH = int(os.environ.get("SVK_PREVIEW_MAX_WIDTH", "2048"))
PREVIEW_QUALITY = int(os.environ.get("SVK_PREVIEW_QUALITY", "82"))

# Tiling: antal scener som tilas parallellt. Lågt default för delad VM;
# tänkt att kunna justeras i ett kommande admin-gränssnitt (skriver env/config).
TILE_CONCURRENCY = max(1, int(os.environ.get("SVK_TILE_CONCURRENCY", "2")))

# Diskanvändnings-cache (admin-lagringsvyn): TTL i sekunder för memoiserad
# mappstorlek. 0 = av (räkna om varje gång). Se app/services/storage.py.
STORAGE_CACHE_TTL = int(os.environ.get("SVK_STORAGE_CACHE_TTL", "60"))

# Versionshistorik (app/services/history.py): varje write_tour/write_map
# arkiverar NUVARANDE (pre-overwrite) tour.json+map.json ihop till
# projects/<slug>/_history/<epoch_ms>/ - en unified tidslinje man kan återställa.
# COALESCE_SEC: hoppa ny snapshot om nyaste är yngre än så här (en redigerings-
# burst kollapsar till en snapshot). MAX + FLOOR_DAYS = generös retention: behåll
# en version om den är bland de MAX nyaste ELLER yngre än FLOOR_DAYS (golvet
# skyddar den värdefulla "före sessionen"-snapshotten som ett rent antals-tak
# annars vräker ut).
HISTORY_MAX = int(os.environ.get("SVK_HISTORY_MAX", "50"))
HISTORY_FLOOR_DAYS = int(os.environ.get("SVK_HISTORY_FLOOR_DAYS", "7"))
HISTORY_COALESCE_SEC = int(os.environ.get("SVK_HISTORY_COALESCE_SEC", "20"))

# Flerspråkighet: språk editorn kan välja bland (kod -> visningsnamn på eget
# språk). SPEGLAS av window.LANG_NAMES i static/markdown.js - håll i synk. En tur
# väljer en delmängd i tour.default.languages; först i listan = default-språk.
# Textfält (hotspot text/body, scentitel, branding.content) blir {kod: text}
# vid flerspråkighet; ren sträng = default-språket (bakåtkompatibelt).
LANGUAGES = {
    "sv": "Svenska",
    "en": "English",
    "de": "Deutsch",
    "fi": "Suomi",
    "no": "Norsk",
    "da": "Dansk",
}
DEFAULT_LANGUAGE = "sv"

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
