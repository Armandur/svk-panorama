"""Scenvyn: kalibrera nordoffset per scen och spara genererade hotspots."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.database import Project
from app.deps import get_project_or_404, new_csrf_token, set_csrf_cookie, templates, verify_csrf_header
from app.services.project_files import map_image_path, read_map, read_tour, write_tour

router = APIRouter()


class SceneUpdate(BaseModel):
    northOffset: float | None = None
    hotSpots: list[dict[str, Any]] = Field(default_factory=list)


class TourSavePayload(BaseModel):
    scenes: dict[str, SceneUpdate] = Field(default_factory=dict)


@router.get("/projects/{slug}/scenes", response_class=HTMLResponse)
def scene_view(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    tour = read_tour(slug)
    map_data = read_map(slug)
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "scene.html",
        {
            "project": project,
            "tour": tour,
            "map_data": map_data,
            "has_map_image": map_image_path(slug).exists(),
            "csrf_token": token,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects/{slug}/tour")
def save_tour(
    slug: str,
    payload: TourSavePayload,
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    tour = read_tour(slug)
    scenes = tour.get("scenes", {})
    updated = 0
    for scene_id, upd in payload.scenes.items():
        if scene_id not in scenes:
            raise HTTPException(status_code=400, detail=f"Okänd scen: {scene_id}")
        scene = scenes[scene_id]
        if upd.northOffset is None:
            scene.pop("northOffset", None)
        else:
            scene["northOffset"] = round(upd.northOffset, 2)
        scene["hotSpots"] = upd.hotSpots
        updated += 1
    write_tour(slug, tour)
    return {"ok": True, "scenes": updated}
