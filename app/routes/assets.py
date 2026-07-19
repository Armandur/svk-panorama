"""Serverar råa projektfiler (bilder, tiles, map.png) med inloggning + ägar-koll.

Ersätter den tidigare öppna /projects-StaticFiles-mounten så en tenant inte kan
gissa sig till en annans filer. Registreras SIST så alla specifika
/projects/{slug}/...-routes (plan, scenes, view, previews, export ...) matchar
först; den här fångar resten (images/, tiles/, map.png)."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response

from app.database import Project
from app.deps import get_project_or_404
from app.services.project_files import project_dir

router = APIRouter()


@router.get("/projects/{slug}/{file_path:path}")
def serve_project_file(
    slug: str,
    file_path: str,
    project: Project = Depends(get_project_or_404),  # inloggning + ägarskap
) -> Response:
    # Tom sökväg = trailing-slash på uppladdningssidan (/projects/{slug}/). Catch-allen
    # fångar den före FastAPI:s redirect_slashes -> 302:a till den kanoniska URL:en.
    if not file_path:
        return RedirectResponse(url=f"/projects/{slug}", status_code=302)
    base = project_dir(slug).resolve()
    target = (base / file_path).resolve()
    # Path traversal-skydd: målet måste ligga under projektmappen.
    if os.path.commonpath([str(base), str(target)]) != str(base) or not target.is_file():
        raise HTTPException(status_code=404, detail="Filen hittades inte")
    return FileResponse(target)
