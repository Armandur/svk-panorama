"""Redigeringslås: checka ut/in en team-tur för redigering. Se services/checkout.py.

- POST /projects/{slug}/checkout: ta/förnya låset (heartbeat). JSON + header-CSRF.
  Svar {acquired, holder} - acquired=False + holder betyder att någon annan håller
  det (eller tog över); klienten går i läsläge / varnar.
- POST /projects/{slug}/checkin: släpp låset. FORM-CSRF (token i body) så det funkar
  via navigator.sendBeacon vid unload (kan inte sätta header). Håller man låset ->
  släpp; annars kan team-admin/super-admin TVINGA incheck (force)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import TEAM_ROLE_ADMIN, Project, User, get_db
from app.auth import require_user
from app.deps import get_project_or_404, verify_csrf_form, verify_csrf_header
from app.services import checkout

router = APIRouter()


@router.post("/projects/{slug}/checkout")
def checkout_project(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    # Solo-turer låses inte - klienten behöver inte checka ut dem.
    if project.team_id is None:
        return JSONResponse({"locking": False, "acquired": True, "holder": None})
    acquired = checkout.try_acquire(db, project.id, user.id)
    db.refresh(project)
    return JSONResponse({
        "locking": True,
        "acquired": acquired,
        "holder": checkout.current_holder(db, project),
    })


@router.post("/projects/{slug}/checkin")
async def checkin_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_form),
) -> JSONResponse:
    if project.team_id is None:
        return JSONResponse({"released": False})
    # Håller man låset -> släpp. Annars: team-admin för turens team eller super-admin
    # kan TVINGA incheck (säkerhetsventil för övergivna lås).
    if project.checked_out_by == user.id:
        released = checkout.release(db, project.id, user.id)
    elif user.is_admin or (user.team_role == TEAM_ROLE_ADMIN and user.team_id == project.team_id):
        released = checkout.release(db, project.id, user.id, force=True)
    else:
        released = False
    return JSONResponse({"released": released})
