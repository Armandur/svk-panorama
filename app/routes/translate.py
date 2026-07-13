"""Översätt-steget: guidat verktyg för att komplettera saknade översättningar i
flerspråkiga turer. Flerspråkighets-GRUNDEN (i18n-textfält, tour.default.languages,
resolveText/attachHsTooltips) är LÅST - denna route lägger bara en granulär
spar-endpoint + vy ovanpå den, och rör inte kontraktet."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from app.database import Project
from app.deps import get_project_or_404, new_csrf_token, set_csrf_cookie, templates, verify_csrf_header
from app.services.presets import set_i18n_lang
from app.services.project_files import map_image_path, read_map, read_tour, tour_lock, write_tour
from app.services.tiling import read_manifest

router = APIRouter()

_TITLE_MAX = 200      # samma gräns som SceneUpdate.title (scenes.py)
_BRANDING_MAX = 2000  # samma gräns som sanitize_branding (presets.py)


class TranslateUpdate(BaseModel):
    kind: Literal["hotspot_text", "hotspot_body", "title", "branding"]
    sceneId: str | None = None
    hotspotIndex: int | None = None
    lang: str
    value: str


@router.get("/projects/{slug}/translate", response_class=HTMLResponse)
def translate_view(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
):
    tour = read_tour(slug)
    languages = list(tour.get("default", {}).get("languages") or [])
    if len(languages) <= 1:
        # Enspråkig tur - inget att översätta, steget ska inte gå att nå.
        return RedirectResponse(url=f"/projects/{slug}/preview", status_code=302)

    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "translate.html",
        {
            "project": project,
            "tour": tour,
            "map_data": read_map(slug),
            "has_map_image": map_image_path(slug).exists(),
            "manifest": read_manifest(slug),
            "csrf_token": token,
            "is_multilingual": True,
            "languages": languages,
        },
    )
    set_csrf_cookie(response, token)
    return response


def _scene_or_400(tour: dict[str, Any], scene_id: str | None) -> dict[str, Any]:
    scenes = tour.get("scenes", {})
    if not scene_id or scene_id not in scenes:
        raise HTTPException(status_code=400, detail="Okänd scen")
    return scenes[scene_id]


def _apply_lang(container: dict[str, Any], field: str, lang: str, value: str, default_lang: str, max_len: int | None = None) -> None:
    text = value.strip()[:max_len] if max_len else value
    result = set_i18n_lang(container.get(field), lang, text, default_lang)
    if result:
        container[field] = result
    else:
        container.pop(field, None)


@router.post("/projects/{slug}/translate")
def save_translation(
    slug: str,
    payload: TranslateUpdate,
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    with tour_lock:  # läs-modifiera-skriv atomiskt mot andra tour.json-skrivare
        tour = read_tour(slug)
        languages = tour.get("default", {}).get("languages") or []
        if len(languages) <= 1:
            raise HTTPException(status_code=400, detail="Turen är inte flerspråkig")
        default_lang = languages[0]
        if payload.lang not in languages:
            raise HTTPException(status_code=400, detail="Okänt språk för turen")

        if payload.kind == "title":
            scene = _scene_or_400(tour, payload.sceneId)
            _apply_lang(scene, "title", payload.lang, payload.value, default_lang, _TITLE_MAX)
        elif payload.kind == "branding":
            default = tour.setdefault("default", {})
            branding = default.get("branding")
            if not branding:
                raise HTTPException(status_code=400, detail="Turen har ingen branding att översätta")
            _apply_lang(branding, "content", payload.lang, payload.value, default_lang, _BRANDING_MAX)
            if not branding.get("content"):
                # Ingen branding kvar på källspråket - hela blocket är meningslöst.
                default.pop("branding", None)
        else:  # hotspot_text | hotspot_body
            scene = _scene_or_400(tour, payload.sceneId)
            hotspots = scene.get("hotSpots", [])
            idx = payload.hotspotIndex
            if idx is None or not (0 <= idx < len(hotspots)):
                raise HTTPException(status_code=400, detail="Okänd hotspot")
            field = "text" if payload.kind == "hotspot_text" else "body"
            _apply_lang(hotspots[idx], field, payload.lang, payload.value, default_lang)

        write_tour(slug, tour)
    return {"ok": True}
