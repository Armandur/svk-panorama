"""Versionshistorik: lista tidigare versioner av en tur och återställ en.

Historiken byggs av history.snapshot() som hakas in i write_tour/write_map (varje
spar arkiverar pre-overwrite-läget). Denna route läser bara tidslinjen och kör
restore. Restore är reversibelt: nuläget force-snapshottas innan det skrivs över."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.database import Project
from app.deps import get_project_or_404, new_csrf_token, set_csrf_cookie, templates, verify_csrf_form
from app.services import history
from app.services.project_files import (
    map_image_path,
    project_dir,
    read_tour,
    tour_lock,
    write_map,
    write_tour,
)

router = APIRouter()


@router.get("/projects/{slug}/history", response_class=HTMLResponse)
def history_view(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    versions = history.list_versions(project_dir(slug))
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "history.html",
        {
            "project": project,
            "versions": versions,
            "csrf_token": token,
            "restored": request.query_params.get("restored"),
            "has_map_image": map_image_path(slug).exists(),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects/{slug}/history/restore")
async def restore_version(
    request: Request,
    slug: str,
    version: int = Form(...),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    pdir = project_dir(slug)
    with tour_lock:
        # Läs målversionen FÖRST: force-snapshotten nedan lägger till en version och
        # kan trigga retention-prune som annars skulle radera just den version vi vill
        # återställa (äldsta posten när historiken är full). read_version kastar
        # KeyError -> 404 (stänger även validate-to-read-gapet).
        try:
            data = history.read_version(pdir, version)
        except KeyError:
            raise HTTPException(status_code=404, detail="Versionen finns inte")
        # Force-snapshotta nuläget -> restore blir reversibel oavsett coalesce-fönstret.
        # Skriv sedan den valda versionen med snapshot=False så write_map-hooken inte
        # arkiverar det inkonsistenta mellanläget (ny tour + gammal map) mellan de två
        # skrivningarna.
        history.snapshot(pdir, force=True)
        if "tour.json" in data:
            write_tour(slug, data["tour.json"], snapshot=False)
        if "map.json" in data:
            write_map(slug, data["map.json"], snapshot=False)

    return RedirectResponse(url=f"/projects/{slug}/history?restored=1", status_code=303)
