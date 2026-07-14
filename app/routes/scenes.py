"""Scenvyn: kalibrera nordoffset per scen och spara genererade hotspots."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.database import Project
from app.deps import get_editor, get_project_or_404, new_csrf_token, require_edit_access, set_csrf_cookie, templates, verify_csrf_header
from app.services.presets import sanitize_hotspot_langs, sanitize_i18n_text
from app.services.project_files import map_image_path, read_map, read_tour, tour_lock, write_tour
from app.services.tiling import read_manifest

router = APIRouter()


class SceneUpdate(BaseModel):
    northOffset: float | None = None
    title: str | dict[str, str] | None = None  # str el. {kod: text} (flerspråkigt)
    calibRef: str | None = None  # grannscen kalibreringen gjordes mot (UI-state)
    horizonRoll: float | None = None  # räta upp sned horisont (grader)
    yaw: float | None = None    # startriktning (default yaw) vid ankomst utan hotspot/länk
    pitch: float | None = None  # startriktning (default pitch)
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
            "manifest": read_manifest(slug),
            "has_map_image": map_image_path(slug).exists(),
            "csrf_token": token,
            "is_multilingual": len(tour.get("default", {}).get("languages") or []) > 1,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects/{slug}/tour")
def save_tour(
    slug: str,
    payload: TourSavePayload,
    project: Project = Depends(require_edit_access),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    with tour_lock:  # läs-modifiera-skriv atomiskt mot andra tour.json-skrivare
        tour = read_tour(slug)
        scenes = tour.get("scenes", {})
        tour_languages = tour.get("default", {}).get("languages") or []
        updated = 0
        for scene_id, upd in payload.scenes.items():
            if scene_id not in scenes:
                raise HTTPException(status_code=400, detail=f"Okänd scen: {scene_id}")
            scene = scenes[scene_id]
            if upd.northOffset is None:
                scene.pop("northOffset", None)
            else:
                scene["northOffset"] = round(upd.northOffset, 2)
            # /tour är en full per-scen-överskrivning (hotSpots ersätts alltid) och
            # scene.js skickar ALLTID title -> None betyder "rensa", inte "rör ej".
            title = sanitize_i18n_text(upd.title, 200)  # str | {kod: text} | None
            if title:
                scene["title"] = title
            else:
                scene.pop("title", None)
            if upd.calibRef:
                scene["calibRef"] = upd.calibRef
            else:
                scene.pop("calibRef", None)
            if upd.horizonRoll:
                scene["horizonRoll"] = round(upd.horizonRoll, 2)
            else:
                scene.pop("horizonRoll", None)
            # yaw/pitch: 0 är en giltig riktning -> is None (inte truthiness).
            if upd.yaw is None:
                scene.pop("yaw", None)
            else:
                scene["yaw"] = round(upd.yaw, 2)
            if upd.pitch is None:
                scene.pop("pitch", None)
            else:
                scene["pitch"] = round(upd.pitch, 2)
            # Sanera hotspot-`langs` (språkbegränsning) - annars kan klienten spara
            # ogiltiga/okända koder som filtret sedan litar på (fynd 4).
            for hs in upd.hotSpots:
                if isinstance(hs, dict) and "langs" in hs:
                    cleaned = sanitize_hotspot_langs(hs.get("langs"), tour_languages)
                    if cleaned:
                        hs["langs"] = cleaned
                    else:
                        hs.pop("langs", None)
            scene["hotSpots"] = upd.hotSpots
            updated += 1
        write_tour(slug, tour, editor=editor)
    return {"ok": True, "scenes": updated}
