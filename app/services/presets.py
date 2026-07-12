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

from app.database import ThemePreset

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
        "position": position if position in _BRANDING_POS else "bottom-left",
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
    b = c.get("branding")
    if isinstance(b, dict):
        sb = sanitize_branding(b.get("content"), b.get("size"), b.get("position"))
        if sb:
            out["branding"] = sb
    return out


def _dump(row: ThemePreset) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "is_default": row.is_default,
        "config": json.loads(row.config) if row.config else {},
    }


def list_presets(db: Session, owner_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(ThemePreset)
        .filter(ThemePreset.owner_id == owner_id)
        .order_by(ThemePreset.name)
        .all()
    )
    return [_dump(r) for r in rows]


def save_preset(db: Session, owner_id: int, name: str, config: dict[str, Any]) -> dict[str, Any]:
    """Skapa eller skriv över (per namn) en förinställning."""
    name = (name or "").strip()[:120] or "Förinställning"
    row = (
        db.query(ThemePreset)
        .filter(ThemePreset.owner_id == owner_id, ThemePreset.name == name)
        .first()
    )
    if row is None:
        row = ThemePreset(owner_id=owner_id, name=name, is_default=False)
        db.add(row)
    row.config = json.dumps(sanitize_config(config), ensure_ascii=False)
    db.commit()
    return _dump(row)


def delete_preset(db: Session, owner_id: int, preset_id: int) -> bool:
    row = (
        db.query(ThemePreset)
        .filter(ThemePreset.owner_id == owner_id, ThemePreset.id == preset_id)
        .first()
    )
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def set_default(db: Session, owner_id: int, preset_id: int, is_default: bool) -> bool:
    row = (
        db.query(ThemePreset)
        .filter(ThemePreset.owner_id == owner_id, ThemePreset.id == preset_id)
        .first()
    )
    if row is None:
        return False
    if is_default:
        db.query(ThemePreset).filter(ThemePreset.owner_id == owner_id).update({"is_default": False})
        row.is_default = True
    else:
        row.is_default = False
    db.commit()
    return True


def default_config(db: Session, owner_id: int) -> dict[str, Any] | None:
    """Config för ägarens standard-förinställning (för nya turer), eller None."""
    row = (
        db.query(ThemePreset)
        .filter(ThemePreset.owner_id == owner_id, ThemePreset.is_default.is_(True))
        .first()
    )
    return (json.loads(row.config) if row.config else {}) if row else None
