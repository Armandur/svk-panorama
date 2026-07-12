"""Delad mediepool per ägare (mediebibliotek v2). Se services/media.py för
lagringslagret och ROADMAP ("Mediebibliotek v2") för spec.

Bilder refereras i hotspot-markdown som absoluta `/media/<owner_id>/<name>` och
serveras publikt per oigissbar capability-URL (som share-token-modellen) så de
funkar i editorn, publika /s-vyn och bundlen utan URL-omskrivning. Listning,
uppladdning och radering är auth-grindade till den inloggade ägaren."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from app import config
from app.auth import require_user
from app.database import Project, User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_header
from app.services import media
from app.services.project_files import (
    validate_extension,
    validate_image_magic,
    validate_size,
)

router = APIRouter()


@router.get("/media")
def media_library_page(request: Request, user: User = Depends(require_user)):
    """Administrationsvy: hela ägarens pool med metadata + användning."""
    token = new_csrf_token()
    resp = templates.TemplateResponse(request, "media_library.html", {"csrf_token": token})
    set_csrf_cookie(resp, token)
    return resp


@router.post("/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    filename = file.filename or "bild"
    validate_extension(filename, config.ALLOWED_MAP_EXT)  # jpg/jpeg/png
    content = await file.read()
    validate_size(content, filename, config.MAX_MAP_MB)
    validate_image_magic(content, filename)
    name = media.store(user.id, filename, content)
    return JSONResponse({"url": media.media_url(user.id, name), "name": name})


@router.get("/media/list")
def list_media(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Ägarens pool med metadata + härledd användning + hens projektlista (filter)."""
    items = media.list_pool(user.id)
    projects = [
        (p.slug, p.name)
        for p in db.query(Project).filter(Project.owner_id == user.id).order_by(Project.name).all()
    ]
    usage = media.scan_usage(user.id, projects)
    for it in items:
        it["usage"] = usage.get(it["name"], [])
    return JSONResponse({
        "items": items,
        "projects": [{"slug": s, "name": n} for s, n in projects],
    })


@router.post("/media/{name}/delete")
def delete_media(
    name: str,
    user: User = Depends(require_user),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    if not media.delete(user.id, name):
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    return JSONResponse({"ok": True})


@router.get("/media/{owner_id}/thumb/{name}")
def serve_thumb(owner_id: int, name: str) -> FileResponse:
    """Nedskalad tumnagel (genereras + cachas vid första anrop). Capability-URL
    som originalet - ingen auth-grind, bara traversal-guard via media.resolve."""
    thumb = media.ensure_thumb(owner_id, name)
    if thumb is None:
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    return FileResponse(thumb)


@router.get("/media/{owner_id}/{name}")
def serve_media(owner_id: int, name: str) -> FileResponse:
    """Capability-URL: ingen auth-grind (oigissbart namn), bara traversal-guard.
    Så publika /s-vyn och bundlen når bilden direkt, som turinnehåll."""
    target = media.resolve(owner_id, name)
    if target is None:
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    return FileResponse(target)
