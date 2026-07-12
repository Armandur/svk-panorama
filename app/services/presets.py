"""Tema-/inställningsförinställningar per ägare (services-lager). `config` lagras
som JSON-subset av tour.default: autoRotate, autoRotateInactivityDelay,
sceneFadeDuration, mapSize, theme{font,dotColor,currentColor}. INTE firstScene
(tur-specifik). Saneras vid spar så en förinställning kan mergas rakt in i en
tur/ny turs default utan att gå via TourSettings-validering."""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from app.database import BrandingPreset, ThemePreset

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_FONTS = {"sans", "serif", "mono", "humanist"}
_MAP_SIZES = {"small", "medium", "large"}
_BRANDING_SIZES = {"small", "medium", "large"}
_BRANDING_POS = {"bottom-left", "bottom-right", "top-left", "top-right"}
_BRANDING_MAX = 2000


def sanitize_branding(content: Any, size: Any, position: Any) -> dict[str, Any] | None:
    """Branding-block (logotyp/text/länk som markdown) för vieweren. Rå markdown
    lagras (renderas + DOMPurify-saneras vid visning som hotspots). None = ingen."""
    content = (content or "")
    content = content.strip() if isinstance(content, str) else ""
    if not content:
        return None
    return {
        "content": content[:_BRANDING_MAX],
        "size": size if size in _BRANDING_SIZES else "medium",
        "position": position if position in _BRANDING_POS else "bottom-right",
    }


def _hex(v: Any, fallback: str) -> str:
    return v if isinstance(v, str) and _HEX_RE.match(v) else fallback


def _clamp_int(v: Any, default: int, lo: int, hi: int) -> int:
    return int(v) if isinstance(v, (int, float)) and lo <= v <= hi else default


def sanitize_config(c: dict[str, Any]) -> dict[str, Any]:
    """Trust-but-validate på systemgränsen (inställningar från klienten)."""
    c = c or {}
    ar = c.get("autoRotate")
    auto_rotate: Any = ar if (isinstance(ar, (int, float)) and -20 <= ar <= 20) else False
    th = c.get("theme") or {}
    out: dict[str, Any] = {
        "autoRotate": auto_rotate,
        "autoRotateInactivityDelay": _clamp_int(c.get("autoRotateInactivityDelay"), 2000, 0, 60000),
        "sceneFadeDuration": _clamp_int(c.get("sceneFadeDuration"), 1500, 0, 10000),
        "mapSize": c.get("mapSize") if c.get("mapSize") in _MAP_SIZES else "medium",
        "theme": {
            "font": th.get("font") if th.get("font") in _FONTS else "sans",
            "dotColor": _hex(th.get("dotColor"), "#666666"),
            "currentColor": _hex(th.get("currentColor"), "#8b0000"),
        },
    }
    # OBS: branding ingår INTE i tema-presets - det är en egen mall (BrandingPreset)
    # så org-identitet kan återanvändas oberoende av temat. Stale branding-nyckel i
    # ett gammalt sparat config droppas här (create_project läser sanerat).
    return out


def _dump(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "is_default": row.is_default,
        "config": json.loads(row.config) if row.config else {},
    }


# --- Generisk CRUD delad av ThemePreset och BrandingPreset (identiska kolumner) ---
def _list(db: Session, Model: Any, owner_id: int) -> list[dict[str, Any]]:
    rows = db.query(Model).filter(Model.owner_id == owner_id).order_by(Model.name).all()
    return [_dump(r) for r in rows]


def _save(db: Session, Model: Any, owner_id: int, name: str, config_json: str) -> dict[str, Any]:
    """Skapa eller skriv över (per namn) en förinställning. config_json = redan sanerad JSON."""
    name = (name or "").strip()[:120] or "Förinställning"
    row = db.query(Model).filter(Model.owner_id == owner_id, Model.name == name).first()
    if row is None:
        row = Model(owner_id=owner_id, name=name, is_default=False)
        db.add(row)
    row.config = config_json
    db.commit()
    return _dump(row)


def _delete(db: Session, Model: Any, owner_id: int, preset_id: int) -> bool:
    row = db.query(Model).filter(Model.owner_id == owner_id, Model.id == preset_id).first()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def _set_default(db: Session, Model: Any, owner_id: int, preset_id: int, is_default: bool) -> bool:
    row = db.query(Model).filter(Model.owner_id == owner_id, Model.id == preset_id).first()
    if row is None:
        return False
    if is_default:
        db.query(Model).filter(Model.owner_id == owner_id).update({"is_default": False})
        row.is_default = True
    else:
        row.is_default = False
    db.commit()
    return True


def _default_row(db: Session, Model: Any, owner_id: int) -> Any:
    return (
        db.query(Model)
        .filter(Model.owner_id == owner_id, Model.is_default.is_(True))
        .first()
    )


# --- Tema-presets ---
def list_presets(db: Session, owner_id: int) -> list[dict[str, Any]]:
    return _list(db, ThemePreset, owner_id)


def save_preset(db: Session, owner_id: int, name: str, config: dict[str, Any]) -> dict[str, Any]:
    return _save(db, ThemePreset, owner_id, name, json.dumps(sanitize_config(config), ensure_ascii=False))


def delete_preset(db: Session, owner_id: int, preset_id: int) -> bool:
    return _delete(db, ThemePreset, owner_id, preset_id)


def set_default(db: Session, owner_id: int, preset_id: int, is_default: bool) -> bool:
    return _set_default(db, ThemePreset, owner_id, preset_id, is_default)


def default_config(db: Session, owner_id: int) -> dict[str, Any] | None:
    """Config för ägarens standard-tema-förinställning (för nya turer), eller None.
    Saneras vid läsning -> ev. stale branding-nyckel droppas (branding är egen mall)."""
    row = _default_row(db, ThemePreset, owner_id)
    return sanitize_config(json.loads(row.config) if row.config else {}) if row else None


# --- Branding-presets (egen mall, se BrandingPreset) ---
def list_branding_presets(db: Session, owner_id: int) -> list[dict[str, Any]]:
    return _list(db, BrandingPreset, owner_id)


def save_branding_preset(db: Session, owner_id: int, name: str, config: dict[str, Any]) -> dict[str, Any] | None:
    """Spara en branding-mall. None (tom content) -> inget sparas (route -> 400)."""
    c = config or {}
    sb = sanitize_branding(c.get("content"), c.get("size"), c.get("position"))
    if not sb:
        return None
    return _save(db, BrandingPreset, owner_id, name, json.dumps(sb, ensure_ascii=False))


def delete_branding_preset(db: Session, owner_id: int, preset_id: int) -> bool:
    return _delete(db, BrandingPreset, owner_id, preset_id)


def set_branding_default(db: Session, owner_id: int, preset_id: int, is_default: bool) -> bool:
    return _set_default(db, BrandingPreset, owner_id, preset_id, is_default)


def default_branding(db: Session, owner_id: int) -> dict[str, Any] | None:
    """Ägarens standard-branding (för nya turer), sanerad, eller None."""
    row = _default_row(db, BrandingPreset, owner_id)
    if not row:
        return None
    c = json.loads(row.config) if row.config else {}
    return sanitize_branding(c.get("content"), c.get("size"), c.get("position"))
