"""Planeringsvyn: visa kartan för placering/länkning och spara map.json."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.database import Project
from app.deps import get_editor, get_project_or_404, new_csrf_token, require_edit_access, set_csrf_cookie, templates, verify_csrf_header
from app.schemas import MapPayload
from app.services.project_files import map_image_path, read_map, read_tour, tour_lock, write_map

router = APIRouter()


@router.get("/projects/{slug}/plan", response_class=HTMLResponse)
def plan_view(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    tour = read_tour(slug)
    map_data = read_map(slug)
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "plan.html",
        {
            "project": project,
            "tour": tour,
            "map_data": map_data,
            "has_map_image": map_image_path(slug).exists(),
            "csrf_token": token,
            "is_multilingual": len(tour.get("default", {}).get("languages") or []) > 1,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects/{slug}/map")
def save_map(
    slug: str,
    payload: MapPayload,
    project: Project = Depends(require_edit_access),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    # Serialisera validering + skrivning under det delade tour-låset så en samtidig
    # tur-ändring (t.ex. scen raderas) inte kan interfoliera mellan valideringen och
    # skrivningen och lämna map.json refererande en scen som just togs bort.
    with tour_lock:
        tour = read_tour(slug)
        known_ids = set(tour.get("scenes", {}).keys())

        for scene in payload.scenes:
            if scene.id not in known_ids:
                raise HTTPException(status_code=400, detail=f"Okänt scen-id: {scene.id}")
        for edge in payload.edges:
            for scene_id in (edge.from_, edge.to):
                if scene_id not in known_ids:
                    raise HTTPException(status_code=400, detail=f"Okänt scen-id i länk: {scene_id}")

        data = {
            "scenes": [scene.model_dump() for scene in payload.scenes],
            "edges": [edge.model_dump(by_alias=True) for edge in payload.edges],
        }
        write_map(slug, data, editor=editor)
    return {"ok": True, "scenes": len(data["scenes"]), "edges": len(data["edges"])}
