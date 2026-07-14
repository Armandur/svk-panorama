"""Tema-/inställningsförinställningar per ägare (services-lager). `config` lagras
som JSON-subset av tour.default: autoRotate, autoRotateInactivityDelay,
sceneFadeDuration, mapSize, theme{font,dotColor,currentColor}. INTE firstScene
(tur-specifik). Saneras vid spar så en förinställning kan mergas rakt in i en
tur/ny turs default utan att gå via TourSettings-validering."""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app import config
from app.database import BrandingPreset, ThemePreset, User

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_FONTS = {"sans", "serif", "mono", "humanist", "dmsans", "spectral"}
_MAP_SIZES = {"small", "medium", "large"}
_BRANDING_SIZES = {"small", "medium", "large"}
_BRANDING_POS = {"bottom-left", "bottom-right", "top-left", "top-right"}
_BRANDING_MAX = 2000


def sanitize_languages(value: Any) -> list[str]:
    """Ordnad lista giltiga språkkoder (första = default-språk). Okända koder
    droppas, dubbletter tas bort med bevarad ordning. Tom/ogiltig -> default."""
    seen: list[str] = []
    if isinstance(value, list):
        for code in value:
            if isinstance(code, str) and code in config.LANGUAGES and code not in seen:
                seen.append(code)
    return seen or [config.DEFAULT_LANGUAGE]


def sanitize_i18n_text(value: Any, max_len: int) -> Any:
    """Textfält som kan vara ren sträng (default-språk) eller {kod: text}
    (flerspråkigt). Trimmar, klipper längd, droppar okända koder/tomma värden.
    Returnerar str, {kod: str} eller None (inget kvar)."""
    if isinstance(value, str):
        v = value.strip()
        return v[:max_len] if v else None
    if isinstance(value, dict):
        out: dict[str, str] = {}
        for code, text in value.items():
            if code in config.LANGUAGES and isinstance(text, str):
                t = text.strip()
                if t:
                    out[code] = t[:max_len]
        return out or None
    return None


def set_i18n_lang(current: Any, lang: str, new_text: str, default_lang: str) -> Any:
    """Sätt ETT språks text i ett i18n-textfält (str | {kod:text} | None), för
    Översätt-stegets granulära spar (routes/translate.py). Bygger en {kod:text}-
    dict av `current` (ren sträng -> {default_lang: current}), sätter/tar bort
    `lang`-nyckeln, och kollapsar sedan tillbaka: om bara default_lang (eller
    inget) blir kvar -> ren sträng (eller None), annars dicten."""
    if isinstance(current, str):
        d: dict[str, str] = {default_lang: current} if current else {}
    elif isinstance(current, dict):
        d = dict(current)
    else:
        d = {}
    text = (new_text or "").strip()
    if text:
        d[lang] = text
    else:
        d.pop(lang, None)
    if not d or set(d.keys()) <= {default_lang}:
        return d.get(default_lang)
    return d


def sanitize_hotspot_langs(value: Any, tour_languages: list[str]) -> list[str] | None:
    """Hotspot-fältet `langs` (begränsa hotspoten till vissa språk, se
    hotspot_in_lang/hotspotInLang). Behåll bara giltiga koder i bevarad ordning,
    utan dubbletter. Returnerar None (droppa fältet) om listan är tom eller
    täcker ALLA turens språk (= ingen begränsning) - speglar klientens setHsLangs
    (scene.js) som inte lagrar `langs` när alla rutor är ikryssade."""
    if not isinstance(value, list):
        return None
    seen: list[str] = []
    for code in value:
        if isinstance(code, str) and code in config.LANGUAGES and code not in seen:
            seen.append(code)
    if not seen:
        return None
    tl = set(tour_languages or [])
    if tl and set(seen) >= tl:
        return None
    return seen


def i18n_text_values(value: Any) -> list[str]:
    """Alla textvarianter av ett fält som kan vara ren sträng (default-språk),
    {kod: text} (flerspråkigt) eller saknas/annat. Delas av regex-skanningar
    (media-referenser i bundle/backup, usage-scan i media.py) som ska hitta
    träffar i ALLA språkvarianter, inte bara default-språket."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [v for v in value.values() if isinstance(v, str)]
    return []


def sanitize_branding(content: Any, size: Any, position: Any) -> dict[str, Any] | None:
    """Branding-block (logotyp/text/länk som markdown) för vieweren. Rå markdown
    lagras (renderas + DOMPurify-saneras vid visning som hotspots). `content` kan
    vara ren sträng eller {kod: text} (flerspråkigt). None = ingen branding."""
    content = sanitize_i18n_text(content, _BRANDING_MAX)
    if not content:
        return None
    return {
        "content": content,
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
# Scope (Fas 4): en användare med team ser/äger TEAMETS presets (team_id-match,
# delas i teamet); en solo-användare sina personliga (owner_id + team_id NULL).
# owner_id bevaras alltid som "skapad av". Solo-klausulen skriver team_id IS NULL
# EXPLICIT (avsiktligt) - inte den läckande `team_id == None`-fällan.
def _scope_filter(Model: Any, owner_id: int, team_id: int | None):
    """Presets i en YTA: team_id satt -> teamets; None -> ägarens personliga
    (owner_id + team_id NULL). Explicit yta (används för tur-arv per turens yta)."""
    if team_id is not None:
        return Model.team_id == team_id
    return and_(Model.owner_id == owner_id, Model.team_id.is_(None))


def _scope_clause(Model: Any, user: User):
    """Användarens PRIMÄRA yta (teamet om medlem, annars personlig) - för CRUD/
    hantering på /mallar. Tur-arv använder _scope_filter med turens yta."""
    return _scope_filter(Model, user.id, user.team_id)


def _new_scope(user: User) -> dict[str, Any]:
    return {"owner_id": user.id, "team_id": user.team_id}


def _list(db: Session, Model: Any, user: User) -> list[dict[str, Any]]:
    rows = db.query(Model).filter(_scope_clause(Model, user)).order_by(Model.name).all()
    return [_dump(r) for r in rows]


def _save(db: Session, Model: Any, user: User, name: str, config_json: str) -> dict[str, Any]:
    """Skapa eller skriv över (per namn) en förinställning. config_json = redan sanerad JSON."""
    name = (name or "").strip()[:120] or "Förinställning"
    row = db.query(Model).filter(_scope_clause(Model, user), Model.name == name).first()
    if row is None:
        row = Model(**_new_scope(user), name=name, is_default=False)
        db.add(row)
    row.config = config_json
    db.commit()
    return _dump(row)


def _delete(db: Session, Model: Any, user: User, preset_id: int) -> bool:
    row = db.query(Model).filter(_scope_clause(Model, user), Model.id == preset_id).first()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def _set_default(db: Session, Model: Any, user: User, preset_id: int, is_default: bool) -> bool:
    row = db.query(Model).filter(_scope_clause(Model, user), Model.id == preset_id).first()
    if row is None:
        return False
    if is_default:
        db.query(Model).filter(_scope_clause(Model, user)).update({"is_default": False})
        row.is_default = True
    else:
        row.is_default = False
    db.commit()
    return True


def _default_row(db: Session, Model: Any, owner_id: int, team_id: int | None) -> Any:
    return (
        db.query(Model)
        .filter(_scope_filter(Model, owner_id, team_id), Model.is_default.is_(True))
        .first()
    )


def _guard_name_clash(db: Session, Model: Any, user: User, name: str, preset_id: int) -> None:
    """Namnbyte får inte kollidera med en ANNAN mall - annars kan den namn-baserade
    upserten (_save, "Spara som mall") senare träffa fel rad. Kastar ValueError."""
    clash = (
        db.query(Model)
        .filter(_scope_clause(Model, user), Model.name == name, Model.id != preset_id)
        .first()
    )
    if clash is not None:
        raise ValueError("Namnet används redan av en annan mall")


# --- Tema-presets ---
def list_presets(db: Session, user: User) -> list[dict[str, Any]]:
    return _list(db, ThemePreset, user)


def save_preset(db: Session, user: User, name: str, config: dict[str, Any]) -> dict[str, Any]:
    return _save(db, ThemePreset, user, name, json.dumps(sanitize_config(config), ensure_ascii=False))


def update_preset(db: Session, user: User, preset_id: int, name: str, config: dict[str, Any]) -> dict[str, Any] | None:
    """Redigera en befintlig tema-mall (id) - namn + config. None om den saknas."""
    row = db.query(ThemePreset).filter(_scope_clause(ThemePreset, user), ThemePreset.id == preset_id).first()
    if row is None:
        return None
    new_name = (name or "").strip()[:120] or row.name
    _guard_name_clash(db, ThemePreset, user, new_name, preset_id)
    row.name = new_name
    row.config = json.dumps(sanitize_config(config), ensure_ascii=False)
    db.commit()
    return _dump(row)


def delete_preset(db: Session, user: User, preset_id: int) -> bool:
    return _delete(db, ThemePreset, user, preset_id)


def set_default(db: Session, user: User, preset_id: int, is_default: bool) -> bool:
    return _set_default(db, ThemePreset, user, preset_id, is_default)


def default_config(db: Session, owner_id: int, team_id: int | None) -> dict[str, Any] | None:
    """Config för standard-tema-förinställningen i en YTA (för nya turer i den ytan),
    eller None. team_id = turens yta (None = personlig). Saneras vid läsning."""
    row = _default_row(db, ThemePreset, owner_id, team_id)
    return sanitize_config(json.loads(row.config) if row.config else {}) if row else None


# --- Branding-presets (egen mall, se BrandingPreset) ---
def list_branding_presets(db: Session, user: User) -> list[dict[str, Any]]:
    return _list(db, BrandingPreset, user)


def save_branding_preset(db: Session, user: User, name: str, config: dict[str, Any]) -> dict[str, Any] | None:
    """Spara en branding-mall. None (tom content) -> inget sparas (route -> 400)."""
    c = config or {}
    sb = sanitize_branding(c.get("content"), c.get("size"), c.get("position"))
    if not sb:
        return None
    return _save(db, BrandingPreset, user, name, json.dumps(sb, ensure_ascii=False))


def update_branding_preset(db: Session, user: User, preset_id: int, name: str, config: dict[str, Any]) -> dict[str, Any] | None:
    """Redigera en befintlig branding-mall (id). None = hittades inte (404).
    Kastar ValueError vid tom content eller namnkollision (400)."""
    row = db.query(BrandingPreset).filter(_scope_clause(BrandingPreset, user), BrandingPreset.id == preset_id).first()
    if row is None:
        return None
    c = config or {}
    sb = sanitize_branding(c.get("content"), c.get("size"), c.get("position"))
    if not sb:
        raise ValueError("Branding får inte vara tom")
    new_name = (name or "").strip()[:120] or row.name
    _guard_name_clash(db, BrandingPreset, user, new_name, preset_id)
    row.name = new_name
    row.config = json.dumps(sb, ensure_ascii=False)
    db.commit()
    return _dump(row)


def delete_branding_preset(db: Session, user: User, preset_id: int) -> bool:
    return _delete(db, BrandingPreset, user, preset_id)


def set_branding_default(db: Session, user: User, preset_id: int, is_default: bool) -> bool:
    return _set_default(db, BrandingPreset, user, preset_id, is_default)


def default_branding(db: Session, owner_id: int, team_id: int | None) -> dict[str, Any] | None:
    """Standard-branding i en YTA (för nya turer i den ytan), sanerad, eller None.
    team_id = turens yta (None = personlig)."""
    row = _default_row(db, BrandingPreset, owner_id, team_id)
    if not row:
        return None
    c = json.loads(row.config) if row.config else {}
    return sanitize_branding(c.get("content"), c.get("size"), c.get("position"))
