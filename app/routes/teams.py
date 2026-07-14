"""Team: self-serve skapande + enkel team-sida (medlemslista).

Fas 4: ett team äger turer och delar media/presets bland medlemmarna. Vem som
helst kan skapa ett team (blir team_admin). En användare tillhör ett team (enkel
FK). Team-scopad användarhantering (bjuda in fler m.m.) ligger i team-admin-UI:t."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.auth import require_user, set_user_session
from app.database import TEAM_ROLE_ADMIN, Team, User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_form
from app.services.project_files import slugify

router = APIRouter()


@router.get("/team", response_class=HTMLResponse)
def team_page(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> HTMLResponse:
    team = db.get(Team, user.team_id) if user.team_id else None
    members = (
        db.query(User).filter(User.team_id == user.team_id).order_by(User.created_at).all()
        if user.team_id else []
    )
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "team.html",
        {"team": team, "members": members, "current_user": user, "csrf_token": token},
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/teams")
async def create_team(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    user: User = Depends(require_user),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Skapa ett team och gör skaparen till team_admin. En användare tillhör ETT
    team - redan medlem -> vägra (byte/lämna hanteras separat senare)."""
    if user.team_id is not None:
        raise HTTPException(status_code=400, detail="Du tillhör redan ett team")
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Teamnamn krävs")

    base_slug = slugify(name)
    slug = base_slug
    suffix = 2
    while db.query(Team).filter(Team.slug == slug).first() is not None:
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    team = Team(name=name, slug=slug)
    db.add(team)
    db.commit()

    user.team_id = team.id
    user.team_role = TEAM_ROLE_ADMIN
    db.commit()
    set_user_session(request, user)  # spegla nya team-scopet i sessionen direkt

    return RedirectResponse(url="/team", status_code=303)
