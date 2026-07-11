"""Runtime-viewer: visa en publicerad tur (fristående mall, ingen editor)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.database import Project
from app.deps import get_project_or_404, templates
from app.services.project_files import map_image_path, read_map, read_tour

router = APIRouter()


@router.get("/projects/{slug}/view", response_class=HTMLResponse)
def view_tour(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "viewer.html",
        {
            "project": project,
            "tour": read_tour(slug),
            "map_data": read_map(slug),
            "has_map_image": map_image_path(slug).exists(),
        },
    )
