"""Super-admin-inställningar: DB-override ovanpå env-default. In-process-cache
(single-host, jfr Fas 3). Läses av mallar via Jinja-globalen `site_name`."""
from __future__ import annotations

from app import config
from app.database import SessionLocal, Setting

_SITE_NAME_KEY = "site_name"
_WORKFLOW_KEY = "workflow_text"
_cache: dict[str, str] = {}


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
