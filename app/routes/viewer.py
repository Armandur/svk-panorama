"""Runtime-viewer: visa en publicerad tur (fristående mall, ingen editor)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.database import Project
from app.deps import get_project_or_404, request_origin, templates
from app.services import i18n
from app.services.project_files import map_image_path, read_map, read_tour
from app.services.tiling import apply_multires, read_manifest
from app.services.tourlinks import apply_tour_links

router = APIRouter()


@router.get("/projects/{slug}/view", response_class=HTMLResponse)
def view_tour(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    tour = read_tour(slug)
    manifest = read_manifest(slug)
    if manifest:
        apply_multires(tour, manifest)
    apply_tour_links(tour, "view")  # cross-tour-hotspots -> /projects/<slug>/view#scene=
    has_map = map_image_path(slug).exists()
    origin = request_origin(request)
    return templates.TemplateResponse(
        request,
        "viewer.html",
        {
            "project": project,
            "tour": tour,
            "map_data": read_map(slug),
            "has_map_image": has_map,
            "asset_base": f"/projects/{slug}/",
            "page_url": f"{origin}/projects/{slug}/view",
            "og_image": f"{origin}/projects/{slug}/map.png" if has_map else None,
            "og_description": i18n.og_description(project.name, i18n.tour_default_lang(tour)),
        },
    )
