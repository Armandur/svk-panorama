"""Publik, oautentiserad visning av en delad tur via oigissbar token.

`/s/{token}` renderar samma viewer som den inloggade förhandsvisningen men med
asset-basen omskriven till `/s/{token}/`, och `/s/{token}/{path}` serverar turens
råa filer (läs-only, traversal-skyddat). Bara turer med en satt `share_token` nås;
nolla token (sluta dela) -> länken slutar fungera direkt."""
from __future__ import annotations

import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session

from app.database import Project, get_db
from app.deps import request_origin, templates
from app.services.project_files import map_image_path, project_dir, read_map, read_tour
from app.services.tiling import apply_multires, read_manifest

router = APIRouter()


def _project_by_token(db: Session, token: str) -> Project:
    project = db.query(Project).filter(Project.share_token == token).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Turen finns inte eller delas inte längre")
    return project


@router.get("/s/{token}", response_class=HTMLResponse)
def public_view(request: Request, token: str, db: Session = Depends(get_db)) -> HTMLResponse:
    project = _project_by_token(db, token)
    slug = project.slug
    tour = read_tour(slug)
    manifest = read_manifest(slug)
    if manifest:
        apply_multires(tour, manifest)
    base = f"/s/{token}/"
    # Skriv om absoluta /projects/{slug}/-paths (panorama, multiRes.basePath) till
    # den publika basen så pannellum hämtar via token-routen i stället.
    tour = json.loads(json.dumps(tour).replace(f"/projects/{slug}/", base))
    has_map = map_image_path(slug).exists()
    page_url = f"{request_origin(request)}/s/{token}"
    return templates.TemplateResponse(
        request,
        "viewer.html",
        {
            "project": project,
            "tour": tour,
            "map_data": read_map(slug),
            "has_map_image": has_map,
            "asset_base": base,
            "page_url": page_url,
            "og_image": f"{page_url}/map.png" if has_map else None,
            "og_description": f"Utforska {project.name} i en virtuell 360-rundtur.",
        },
    )


@router.get("/s/{token}/{file_path:path}")
def public_file(token: str, file_path: str, db: Session = Depends(get_db)) -> FileResponse:
    project = _project_by_token(db, token)
    base = project_dir(project.slug).resolve()
    target = (base / file_path).resolve()
    # Path traversal-skydd: målet måste ligga under projektmappen.
    if os.path.commonpath([str(base), str(target)]) != str(base) or not target.is_file():
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    return FileResponse(target)
