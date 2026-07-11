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
from app.services.project_files import (
    default_map,
    default_tour,
    ensure_project_structure,
    list_scenes,
    map_image_path,
    slugify,
    write_map,
    write_tour,
)
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
        },
    )
    set_csrf_cookie(response, token)
    return response
