"""Delad mediepool per ägare (mediebibliotek v2). Se services/media.py för
lagringslagret och ROADMAP ("Mediebibliotek v2") för spec.

Bilder refereras i hotspot-markdown som absoluta `/media/<owner_id>/<name>` och
serveras publikt per oigissbar capability-URL (som share-token-modellen) så de
funkar i editorn, publika /s-vyn och bundlen utan URL-omskrivning. Listning,
uppladdning och radering är auth-grindade till den inloggade ägaren."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session


class MediaBatch(BaseModel):
    names: list[str]

from app import config
from app.auth import require_user
from app.database import Project, User, get_db
from app.deps import (
    QUOTA_MSG,
    new_csrf_token,
    project_owner_key,
    set_csrf_cookie,
    team_over_quota,
    templates,
    user_can_access_project,
    user_may_use_workspace,
    user_workspaces,
    verify_csrf_header,
)
from app.services import storage


def _pool_owner(db: Session, user: User, slug: str | None, owner: str | None) -> str:
    """Vilken mediapool (ytanyckel) en förfrågan gäller. `slug` = redigeringskontext
    -> turens yta (gate:ad); `owner` = explicit yta (/media-sidan, validerad); annars
    användarens primära yta. Media följer turens yta i arbetsyte-modellen."""
    if slug:
        project = db.query(Project).filter(Project.slug == slug).first()
        if project is None or not user_can_access_project(user, project):
            raise HTTPException(status_code=404, detail="Turen hittades inte")
        return project_owner_key(project)
    if owner:
        if not user_may_use_workspace(db, user, owner):
            raise HTTPException(status_code=403, detail="Otillåten arbetsyta")
        return owner
    return user.owner_key
from app.services import media
from app.services.project_files import (
    validate_extension,
    validate_image_dimensions,
    validate_image_magic,
    validate_size,
)

router = APIRouter()


def _workspace_projects(db: Session, owner: str) -> list[tuple[str, str]]:
    """Turerna i en yta (för usage-scan): team-<id> -> teamets turer; <user_id> ->
    ägarens personliga turer (team_id NULL)."""
    if owner.startswith("team-"):
        q = db.query(Project).filter(Project.team_id == int(owner[5:]))
    else:
        q = db.query(Project).filter(Project.owner_id == int(owner), Project.team_id.is_(None))
    return [(p.slug, p.name) for p in q.order_by(Project.name).all()]


@router.get("/media")
def media_library_page(
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Administrationsvy: pool per arbetsyta (yta-växlare) med metadata + användning."""
    token = new_csrf_token()
    resp = templates.TemplateResponse(
        request, "media_library.html",
        {"csrf_token": token, "workspaces": user_workspaces(db, user)},
    )
    set_csrf_cookie(resp, token)
    return resp


@router.post("/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    slug: str = Query(None),
    owner: str = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    pool = _pool_owner(db, user, slug, owner)
    # Hård kvot-grind: bara team-pooler har kvot (personliga pooler = obegränsat).
    if pool.startswith("team-") and team_over_quota(db, int(pool[5:])):
        raise HTTPException(status_code=409, detail=QUOTA_MSG)
    filename = file.filename or "bild"
    validate_extension(filename, config.ALLOWED_MAP_EXT)  # jpg/jpeg/png
    content = await file.read()
    validate_size(content, filename, config.MAX_MAP_MB)
    validate_image_magic(content, filename)
    validate_image_dimensions(content, filename)
    name = media.store(pool, filename, content, uploader={"by": user.id, "name": user.name or user.email})
    storage.invalidate(media.owner_dir(pool))  # kvot-grinden ska se poolens nya storlek direkt
    return JSONResponse({"url": media.media_url(pool, name), "name": name})


@router.get("/media/list")
def list_media(
    slug: str = Query(None),
    owner: str = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Ytans pool med metadata + härledd användning + ytans projektlista (filter).
    Yta väljs via slug (turens yta) eller owner (explicit); annars primär yta."""
    pool = _pool_owner(db, user, slug, owner)
    items = media.list_pool(pool)
    projects = _workspace_projects(db, pool)
    usage = media.scan_usage(pool, projects)
    for it in items:
        it["usage"] = usage.get(it["name"], [])
    return JSONResponse({
        "items": items,
        "projects": [{"slug": s, "name": n} for s, n in projects],
        "owner": pool,
    })


@router.post("/media/{name}/delete")
def delete_media(
    name: str,
    slug: str = Query(None),
    owner: str = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    pool = _pool_owner(db, user, slug, owner)
    if not media.delete(pool, name):
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    storage.invalidate(media.owner_dir(pool))  # frigör kvot-utrymme direkt
    return JSONResponse({"ok": True})


@router.post("/media/batch-delete")
def batch_delete_media(
    payload: MediaBatch,
    slug: str = Query(None),
    owner: str = Query(None),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    """Radera flera poolbilder på en gång (yta-scopat via _pool_owner)."""
    pool = _pool_owner(db, user, slug, owner)
    deleted = sum(1 for name in payload.names if media.delete(pool, name))
    if deleted:
        storage.invalidate(media.owner_dir(pool))  # frigör kvot-utrymme direkt
    return JSONResponse({"deleted": deleted})


@router.get("/media/{owner}/thumb/{name}")
def serve_thumb(owner: str, name: str) -> FileResponse:
    """Nedskalad tumnagel (genereras + cachas vid första anrop). Capability-URL
    som originalet - ingen auth-grind, bara traversal-guard via media.resolve
    (som även validerar ägar-nyckelns format)."""
    thumb = media.ensure_thumb(owner, name)
    if thumb is None:
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    return FileResponse(thumb)


@router.get("/media/{owner}/{name}")
def serve_media(owner: str, name: str) -> FileResponse:
    """Capability-URL: ingen auth-grind (oigissbart namn), bara traversal-guard.
    Så publika /s-vyn och bundlen når bilden direkt, som turinnehåll."""
    target = media.resolve(owner, name)
    if target is None:
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    return FileResponse(target)
