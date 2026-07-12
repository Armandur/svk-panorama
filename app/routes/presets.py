"""Tema-/inställningsförinställningar per ägare. Se services/presets.py."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth import require_user
from app.database import User, get_db
from app.deps import verify_csrf_header
from app.services import presets

router = APIRouter()


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
