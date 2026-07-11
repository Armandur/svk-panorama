"""Turinställningar + förhandsvisning: sätt globala default-inställningar
(autorotate, fördröjning, scen-fade, förstascen, kartstorlek) och förhandsgranska
hela turen i multires med scenbläddring."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

FONT_KEYS = {"sans", "serif", "mono", "humanist"}
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _hex(value: str, fallback: str) -> str:
    return value if _HEX_RE.match(value or "") else fallback

from app import config
from app.database import Project
from app.deps import get_project_or_404, new_csrf_token, set_csrf_cookie, templates, verify_csrf_header
from app.services.project_files import _natural_key, map_image_path, read_map, read_tour, tour_lock, write_tour
from app.services.tiling import read_manifest

router = APIRouter()


class TourSettings(BaseModel):
    autoLoad: bool = True
    autoRotateEnabled: bool = True
    autoRotateSpeed: float = 2.0          # magnitud (grader/sek)
    autoRotateDir: int = -1               # -1 eller 1 (rotationsriktning)
    autoRotateInactivityDelay: int = 2000  # ms innan autorotate återupptas
    sceneFadeDuration: int = 1500          # ms crossfade vid scenbyte
    firstScene: str = ""
    mapSize: str = "medium"                # small | medium | large
    themeFont: str = "sans"                # sans | serif | mono | humanist
    themeDotColor: str = "#666666"
    themeCurrentColor: str = "#8b0000"


@router.get("/projects/{slug}/preview", response_class=HTMLResponse)
def preview_view(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    tour = read_tour(slug)
    # Multires appliceras klient-side i tour-preview.js (defaultar multires) så
    # användaren kan byta upplösning preview/multires/full - därför bäddas rå tur
    # + manifest in, inte en multires-mergad tur.
    manifest = read_manifest(slug)
    scene_ids = sorted(tour.get("scenes", {}).keys(), key=_natural_key)
    token = new_csrf_token()
    share_url = None
    if project.share_token:
        origin = config.BASE_URL or str(request.base_url).rstrip("/")
        share_url = f"{origin}/s/{project.share_token}"
    response = templates.TemplateResponse(
        request,
        "preview.html",
        {
            "project": project,
            "tour": tour,
            "map_data": read_map(slug),
            "has_map_image": map_image_path(slug).exists(),
            "scene_ids": scene_ids,
            "manifest": manifest,
            "csrf_token": token,
            "share_url": share_url,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects/{slug}/tour-settings")
def save_tour_settings(
    slug: str,
    payload: TourSettings,
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    with tour_lock:  # läs-modifiera-skriv atomiskt mot andra tour.json-skrivare
        tour = read_tour(slug)  # rå (equirektangulär) sanningskälla
        default = tour.setdefault("default", {})
        default["autoLoad"] = payload.autoLoad
        speed = abs(payload.autoRotateSpeed)
        direction = 1 if payload.autoRotateDir >= 0 else -1
        default["autoRotate"] = direction * speed if payload.autoRotateEnabled else False
        default["autoRotateInactivityDelay"] = max(0, payload.autoRotateInactivityDelay)
        default["sceneFadeDuration"] = max(0, payload.sceneFadeDuration)
        if payload.firstScene and payload.firstScene in tour.get("scenes", {}):
            default["firstScene"] = payload.firstScene
        default["mapSize"] = payload.mapSize if payload.mapSize in ("small", "medium", "large") else "medium"
        default["theme"] = {
            "font": payload.themeFont if payload.themeFont in FONT_KEYS else "sans",
            "dotColor": _hex(payload.themeDotColor, "#666666"),
            "currentColor": _hex(payload.themeCurrentColor, "#8b0000"),
        }
        default["editorMode"] = False
        write_tour(slug, tour)
    return {"ok": True}
