"""Lat generering och servering av nedskalade panorama-previews."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.database import Project
from app.deps import get_project_or_404
from app.services.project_files import ensure_preview

router = APIRouter()


@router.get("/projects/{slug}/previews/{scene_id}.jpg")
def scene_preview(
    slug: str,
    scene_id: str,
    project: Project = Depends(get_project_or_404),
) -> FileResponse:
    """Returnerar en liten equirektangulär preview, genererad on-demand första
    gången scenen förhandsvisas."""
    path = ensure_preview(slug, scene_id)
    return FileResponse(path, media_type="image/jpeg")
