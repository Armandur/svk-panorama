"""Projektlista, skapa-formulär och hur-man-gör-guide."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app import config
from app.auth import require_user
from app.database import Project, User
from app.deps import (
    get_db,
    get_project_or_404,
    new_csrf_token,
    set_csrf_cookie,
    templates,
    verify_csrf_form,
)
from app.services.bundle import forget_job as forget_export_job
from app.services.bundle import job_status as export_job_status
from app.services.project_files import (
    default_map,
    default_tour,
    delete_project_files,
    ensure_project_structure,
    list_scenes,
    map_image_path,
    rename_project_files,
    slugify,
    write_map,
    write_tour,
)
from app.services.tiling import forget_job as forget_tile_job
from app.services.tiling import job_status as tile_job_status
from app.services.tiling import project_tile_state

router = APIRouter()


def _read_guide_text() -> str:
    if not config.WORKFLOW_MD_PATH.exists():
        return "Ingen arbetsgångsguide hittades (WORKFLOW.md saknas)."
    return config.WORKFLOW_MD_PATH.read_text(encoding="utf-8")


@router.get("/", response_class=HTMLResponse)
def index(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> HTMLResponse:
    # Alla ser bara sina EGNA turer här (även admin) - andras turer nås via
    # Admin -> Användare.
    projects = (
        db.query(Project)
        .filter(Project.owner_id == user.id)
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
            "guide_text": _read_guide_text(),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects")
async def create_project(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    user: User = Depends(require_user),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Namn krävs")

    base_slug = slugify(name)
    slug = base_slug
    suffix = 2
    while db.query(Project).filter(Project.slug == slug).first() is not None:
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    project = Project(slug=slug, name=name, owner_id=user.id)
    db.add(project)
    db.commit()

    ensure_project_structure(slug)
    write_tour(slug, default_tour())
    write_map(slug, default_map())

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
    delete_project_files(slug)

    # Admin som raderar en annans tur -> tillbaka till den användarens turlista.
    dest = f"/admin/users/{owner_id}/projects" if acted_on_other else "/"
    return RedirectResponse(url=dest, status_code=303)


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
    return RedirectResponse(url=f"/projects/{new_slug}", status_code=303)


@router.get("/projects/{slug}", response_class=HTMLResponse)
def project_home(
    request: Request,
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    """Steg 1: ladda upp bilder + karta och hantera scenlistan."""
    scenes = list_scenes(slug)
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
        },
    )
    set_csrf_cookie(response, token)
    return response
