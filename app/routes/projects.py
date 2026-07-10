"""Projektlista, skapa-formulär och hur-man-gör-guide."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app import config
from app.database import Project
from app.deps import get_db, new_csrf_token, set_csrf_cookie, templates, verify_csrf_form
from app.services.project_files import (
    default_map,
    default_tour,
    ensure_project_structure,
    slugify,
    write_map,
    write_tour,
)

router = APIRouter()


def _read_guide_text() -> str:
    if not config.WORKFLOW_MD_PATH.exists():
        return "Ingen arbetsgångsguide hittades (WORKFLOW.md saknas)."
    return config.WORKFLOW_MD_PATH.read_text(encoding="utf-8")


@router.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_db)) -> HTMLResponse:
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "index.html",
        {
            "projects": projects,
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

    project = Project(slug=slug, name=name)
    db.add(project)
    db.commit()

    ensure_project_structure(slug)
    write_tour(slug, default_tour())
    write_map(slug, default_map())

    return RedirectResponse(url="/", status_code=302)
