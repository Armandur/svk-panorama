"""Tema-/inställningsförinställningar per ägare. Se services/presets.py."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session

from app.auth import require_user
from app.database import User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_header
from app.services import presets

router = APIRouter()


@router.get("/mallar", response_class=HTMLResponse)
def presets_page(request: Request, user: User = Depends(require_user)):
    """Administrationsvy: ägarens tema- och branding-mallar med förhandsvisning."""
    token = new_csrf_token()
    resp = templates.TemplateResponse(request, "presets_library.html", {"csrf_token": token})
    set_csrf_cookie(resp, token)
    return resp


@router.get("/presets")
def list_presets(user: User = Depends(require_user), db: Session = Depends(get_db)) -> JSONResponse:
    return JSONResponse({"presets": presets.list_presets(db, user.id)})


@router.post("/presets")
async def save_preset(
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Namn krävs")
    preset = presets.save_preset(db, user.id, name, data.get("config") or {})
    return JSONResponse({"preset": preset})


@router.post("/presets/{preset_id}")
async def update_preset(
    preset_id: int,
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Namn krävs")
    preset = presets.update_preset(db, user.id, preset_id, name, data.get("config") or {})
    if preset is None:
        raise HTTPException(status_code=404, detail="Förinställningen hittades inte")
    return JSONResponse({"preset": preset})


@router.post("/presets/{preset_id}/delete")
def delete_preset(
    preset_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    if not presets.delete_preset(db, user.id, preset_id):
        raise HTTPException(status_code=404, detail="Förinställningen hittades inte")
    return JSONResponse({"ok": True})


@router.post("/presets/{preset_id}/default")
async def set_default(
    preset_id: int,
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    data = await request.json()
    if not presets.set_default(db, user.id, preset_id, bool(data.get("isDefault"))):
        raise HTTPException(status_code=404, detail="Förinställningen hittades inte")
    return JSONResponse({"ok": True})


# --- Branding-mallar (egen mall skild från tema-presets) ---
@router.get("/branding-presets")
def list_branding(user: User = Depends(require_user), db: Session = Depends(get_db)) -> JSONResponse:
    return JSONResponse({"presets": presets.list_branding_presets(db, user.id)})


@router.post("/branding-presets")
async def save_branding(
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Namn krävs")
    preset = presets.save_branding_preset(db, user.id, name, data.get("config") or {})
    if preset is None:
        raise HTTPException(status_code=400, detail="Branding får inte vara tom")
    return JSONResponse({"preset": preset})


@router.post("/branding-presets/{preset_id}")
async def update_branding(
    preset_id: int,
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Namn krävs")
    preset = presets.update_branding_preset(db, user.id, preset_id, name, data.get("config") or {})
    if preset is None:
        raise HTTPException(status_code=400, detail="Branding-mallen hittades inte eller är tom")
    return JSONResponse({"preset": preset})


@router.post("/branding-presets/{preset_id}/delete")
def delete_branding(
    preset_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    if not presets.delete_branding_preset(db, user.id, preset_id):
        raise HTTPException(status_code=404, detail="Branding-mallen hittades inte")
    return JSONResponse({"ok": True})


@router.post("/branding-presets/{preset_id}/default")
async def set_branding_default(
    preset_id: int,
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    data = await request.json()
    if not presets.set_branding_default(db, user.id, preset_id, bool(data.get("isDefault"))):
        raise HTTPException(status_code=404, detail="Branding-mallen hittades inte")
    return JSONResponse({"ok": True})
