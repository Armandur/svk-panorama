"""Super-admin-inställningar: DB-override ovanpå env-default. In-process-cache
(single-host, jfr Fas 3). Läses av mallar via Jinja-globalen `site_name`.

CACHE-CAVEAT: cachen är korrekt just för att appen kör single-process (uvicorn en
worker, single-container). Med `uvicorn --workers N` uppdaterar `_set` bara den
anropande workerns `_cache` - övriga blir stale tills omstart. Inte ett problem idag."""
from __future__ import annotations

from app import config
from app.database import SessionLocal, Setting

_SITE_NAME_KEY = "site_name"
_WORKFLOW_KEY = "workflow_text"
_cache: dict[str, str] = {}

# Justerbara heltalsinställningar utan omstart: key -> (config-default-attr, min, max).
# `base_url` är MEDVETET utelämnad - den blir Fas 4.3:s per-team-seam (`team_origin`),
# och en GLOBAL override vore en multi-tenant foot-gun (alla tenants -> en origin).
_INT_SETTINGS = {
    "tile_concurrency": ("TILE_CONCURRENCY", 1, 8),
    "tile_quality": ("TILE_QUALITY", 1, 100),
    "preview_max_width": ("PREVIEW_MAX_WIDTH", 512, 8192),
    "preview_quality": ("PREVIEW_QUALITY", 10, 100),
    "max_panorama_mb": ("MAX_PANORAMA_MB", 1, 500),
    "max_map_mb": ("MAX_MAP_MB", 1, 200),
}


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def _default_workflow() -> str:
    p = config.WORKFLOW_MD_PATH
    return p.read_text(encoding="utf-8") if p.exists() else ""


def _get(key: str, default: str) -> str:
    if key in _cache:
        return _cache[key]
    db = SessionLocal()
    try:
        row = db.get(Setting, key)
        value = row.value if row else default
    finally:
        db.close()
    _cache[key] = value
    return value


def _set(key: str, value: str) -> None:
    db = SessionLocal()
    try:
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=value))
        else:
            row.value = value
        db.commit()
    finally:
        db.close()
    _cache[key] = value


def get_site_name() -> str:
    return _get(_SITE_NAME_KEY, config.SITE_NAME)


def set_site_name(value: str) -> None:
    _set(_SITE_NAME_KEY, value.strip() or config.SITE_NAME)


def get_workflow_text() -> str:
    return _get(_WORKFLOW_KEY, _default_workflow())


def set_workflow_text(value: str) -> None:
    _set(_WORKFLOW_KEY, value)


def _delete(key: str) -> None:
    """Radera override:n -> get faller tillbaka på env-defaulten."""
    db = SessionLocal()
    try:
        row = db.get(Setting, key)
        if row is not None:
            db.delete(row)
            db.commit()
    finally:
        db.close()
    _cache.pop(key, None)


def get_int(key: str) -> int:
    """Heltalsinställning: DB-override (clamp:ad) eller env-default. DEFENSIV parse -
    en tom/trasig lagrad rad kraschar ALDRIG en sidladdning, den faller till default."""
    cfg_attr, lo, hi = _INT_SETTINGS[key]
    default = int(getattr(config, cfg_attr))
    try:
        return _clamp(int(_get(key, str(default))), lo, hi)
    except (TypeError, ValueError):
        return default


def set_int(key: str, value: str | int | None) -> None:
    """Sätt en heltalsinställning. Tomt/blankt -> RADERA override (återgå till env-
    default), inte spara 0. Skräp ignoreras. Clampas vid write så visat == använt."""
    cfg_attr, lo, hi = _INT_SETTINGS[key]
    s = str(value).strip() if value is not None else ""
    if not s:
        _delete(key)
        return
    try:
        _set(key, str(_clamp(int(s), lo, hi)))
    except (TypeError, ValueError):
        return  # ignorera skräp -> behåll nuvarande


def all_int_settings() -> dict[str, dict]:
    """För admin-formuläret: {key: {value, default, min, max, is_override}}."""
    out = {}
    for key, (cfg_attr, lo, hi) in _INT_SETTINGS.items():
        default = int(getattr(config, cfg_attr))
        out[key] = {"value": get_int(key), "default": default, "min": lo, "max": hi}
    return out
