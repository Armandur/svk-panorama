"""Projektlista, skapa-formulär och hur-man-gör-guide."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import require_user
from app.database import Project, User
from app.deps import (
    get_db,
    get_editor,
    get_project_or_404,
    new_csrf_token,
    request_origin,
    resolve_workspace,
    set_csrf_cookie,
    templates,
    user_workspaces,
    verify_csrf_form,
    verify_csrf_header,
    visible_projects_clause,
)
from app.services.backup import forget_job as forget_backup_job
from app.services.presets import default_branding, sanitize_languages
from app.services.presets import default_config as default_preset_config
from app.services.bundle import forget_job as forget_export_job
from app.services.bundle import job_status as export_job_status
from app.services.project_files import (
    default_map,
    default_tour,
    delete_project_files,
    ensure_project_structure,
    list_scenes,
    map_image_path,
    read_tour,
    rename_project_files,
    slugify,
    tour_lock,
    write_map,
    write_tour,
)
from app.services import settings as site_settings
from app.services.tiling import forget_job as forget_tile_job
from app.services.tiling import job_status as tile_job_status
from app.services.tiling import project_tile_state

router = APIRouter()


class LanguagesPayload(BaseModel):
    """Body för POST /projects/{slug}/languages - rör ENBART default.languages."""

    languages: list[str] = []


@router.get("/", response_class=HTMLResponse)
def landing(request: Request) -> HTMLResponse:
    """Publik landningssida (ingen auth). Editorn bor på /editor. Inloggade ser
    samma sida men med 'Till editorn' som primär-CTA (via request.session i mallen)."""
    return templates.TemplateResponse(request, "landing.html", {})


@router.get("/editor", response_class=HTMLResponse)
def editor_home(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> HTMLResponse:
    # Egna turer + teamets turer (om användaren har team). Andras/andra teams
    # turer nås via Admin -> Användare. Team-lös -> bara egna (None-guardad).
    projects = (
        db.query(Project)
        .filter(visible_projects_clause(user))
        .order_by(Project.created_at.desc())
        .all()
    )
    tile_states = {p.slug: project_tile_state(p.slug) for p in projects}
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "index.html",
        {
            "projects": projects,
            "tile_states": tile_states,
            "current_user": user,
            "csrf_token": token,
            "guide_text": site_settings.get_workflow_text(),
            "workspaces": user_workspaces(db, user),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects")
async def create_project(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    scope: str = Form(None),
    user: User = Depends(require_user),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Namn krävs")

    # Yta (arbetsyte-modellen): team-tur eller personlig. scope=None -> default (teamet
    # om medlem, annars personlig). Ogiltig/otillåten yta avvisas (t.ex. personlig när
    # can_personal=False) - lita aldrig på klientens värde.
    team_id, ok = resolve_workspace(db, user, scope)
    if not ok:
        raise HTTPException(status_code=400, detail="Ogiltig arbetsyta")

    base_slug = slugify(name)
    slug = base_slug
    suffix = 2
    while db.query(Project).filter(Project.slug == slug).first() is not None:
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    # owner_id bevaras alltid som "skapad av"; team_id avgör ytan (None = personlig).
    project = Project(slug=slug, name=name, owner_id=user.id, team_id=team_id)
    db.add(project)
    db.commit()

    ensure_project_structure(slug)
    tour = default_tour()
    # Ny tur ärver standard-förinställningarna i TURENS yta (team_id) - en personlig
    # tur ärver personliga presets, en team-tur teamets. Tema + branding var för sig.
    preset = default_preset_config(db, user.id, team_id)
    if preset:
        tour.setdefault("default", {}).update(preset)
    brand = default_branding(db, user.id, team_id)
    if brand:
        tour.setdefault("default", {})["branding"] = brand
    write_tour(slug, tour, editor=editor)
    write_map(slug, default_map(), editor=editor)

    return RedirectResponse(url=f"/projects/{slug}", status_code=302)


@router.post("/projects/{slug}/delete")
async def delete_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Radera en hel tur: DB-rad + projektmappen + ev. in-memory-jobb."""
    owner_id = project.owner_id
    acted_on_other = user.is_admin and owner_id != user.id

    db.delete(project)
    db.commit()

    forget_tile_job(slug)
    forget_export_job(slug)
    forget_backup_job(slug)
    delete_project_files(slug)

    # Admin som raderar en annans tur -> tillbaka till den användarens turlista.
    dest = f"/admin/users/{owner_id}/projects" if acted_on_other else "/editor"
    return RedirectResponse(url=dest, status_code=303)


def _share_url(request: Request, token: str) -> str:
    return f"{request_origin(request)}/s/{token}"


def _wants_json(request: Request) -> bool:
    return "application/json" in request.headers.get("accept", "")


@router.post("/projects/{slug}/share")
async def share_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    _csrf: None = Depends(verify_csrf_form),
):
    """Aktivera publik delning: skapa en oigissbar token om ingen finns. JS-anrop
    (Accept: application/json) får länken tillbaka och uppdaterar rutan utan omladdning;
    vanlig formulärpost (utan JS) faller tillbaka på redirect."""
    if not project.share_token:
        project.share_token = secrets.token_urlsafe(16)
        db.commit()
    if _wants_json(request):
        return JSONResponse({"share_url": _share_url(request, project.share_token)})
    return RedirectResponse(url=f"/projects/{slug}/preview", status_code=303)


@router.post("/projects/{slug}/unshare")
async def unshare_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_form),
):
    """Sluta dela: nolla token -> gamla /s/{token}-länken slutar fungera direkt."""
    project.share_token = None
    db.commit()
    if _wants_json(request):
        return JSONResponse({"share_url": None})
    return RedirectResponse(url=f"/projects/{slug}/preview", status_code=303)


@router.post("/projects/{slug}/rename")
async def rename_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    name: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Byt turens visningsnamn (påverkar inte slug/adress)."""
    name = name.strip()
    if name:
        project.name = name
        db.commit()
    return RedirectResponse(url=f"/projects/{slug}", status_code=303)


def _job_running(slug: str) -> bool:
    for status in (tile_job_status(slug), export_job_status(slug)):
        if status and status.get("status") == "running":
            return True
    return False


@router.post("/projects/{slug}/rename-slug")
async def rename_slug(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    new_slug: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Byt turens slug: mappnamn + DB-rad + glöm jobb på gamla slugen. Bokmärkta
    /view-länkar och redan byggda bundlar bryts - varnas för i UI:t."""
    new_slug = slugify(new_slug)
    if new_slug == slug:
        return RedirectResponse(url=f"/projects/{slug}", status_code=303)
    if db.query(Project).filter(Project.slug == new_slug).first() is not None:
        return RedirectResponse(
            url=f"/projects/{slug}?slug_error=Slugen+%C3%A4r+upptagen", status_code=303
        )
    if _job_running(slug):
        return RedirectResponse(
            url=f"/projects/{slug}?slug_error=V%C3%A4nta+tills+tiling%2Fexport+%C3%A4r+klar",
            status_code=303,
        )

    rename_project_files(slug, new_slug)  # flyttar mappen (guardad)
    project.slug = new_slug
    db.commit()
    forget_tile_job(slug)  # in-memory-status nycklad på gamla slugen
    forget_export_job(slug)
    forget_backup_job(slug)
    return RedirectResponse(url=f"/projects/{new_slug}", status_code=303)


@router.get("/projects/{slug}", response_class=HTMLResponse)
def project_home(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    """Steg 1: ladda upp bilder + karta och hantera scenlistan."""
    scenes = list_scenes(slug)
    tour = read_tour(slug)
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "upload.html",
        {
            "project": project,
            "scenes": scenes,
            "has_map_image": map_image_path(slug).exists(),
            "csrf_token": token,
            "slug_error": request.query_params.get("slug_error"),
            "languages": tour.get("default", {}).get("languages") or ["sv"],
            "is_multilingual": len(tour.get("default", {}).get("languages") or []) > 1,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects/{slug}/languages")
def save_languages(
    slug: str,
    payload: LanguagesPayload,
    project: Project = Depends(get_project_or_404),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    """Spara ENBART turens språkval (uppladdningssteget) - rör inget annat
    fält i default-blocket."""
    with tour_lock:
        tour = read_tour(slug)
        default = tour.setdefault("default", {})
        default["languages"] = sanitize_languages(payload.languages)
        write_tour(slug, tour, editor=editor)
    return {"ok": True}
