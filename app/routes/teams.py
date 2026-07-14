"""Team: self-serve skapande + enkel team-sida (medlemslista).

Fas 4: ett team äger turer och delar media/presets bland medlemmarna. Vem som
helst kan skapa ett team (blir team_admin). En användare tillhör ett team (enkel
FK). Team-scopad användarhantering (bjuda in fler m.m.) ligger i team-admin-UI:t."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.auth import make_invite_token, require_team_admin, require_user, set_user_session
from app.database import TEAM_ROLE_ADMIN, TEAM_ROLE_MEMBER, Team, User, get_db
from app.deps import new_csrf_token, request_origin, set_csrf_cookie, templates, verify_csrf_form
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
    is_team_admin = user.is_admin or user.team_role == TEAM_ROLE_ADMIN
    # Inbjudningslänk per ännu ej aktiverad medlem (password_hash None) - stateless
    # token, härledd ur user-id, så team-admin kan kopiera länken när som helst.
    invite_links = {}
    if is_team_admin:
        origin = request_origin(request)
        for m in members:
            if m.password_hash is None:
                invite_links[m.id] = f"{origin}/accept-invite?token={make_invite_token(m.id)}"
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "team.html",
        {
            "team": team, "members": members, "current_user": user,
            "is_team_admin": is_team_admin, "invite_links": invite_links,
            "csrf_token": token,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/team/invite")
async def invite_member(
    request: Request,
    db: Session = Depends(get_db),
    email: str = Form(...),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Team-admin bjuder in en medlem: skapa ett vilande konto (password_hash None)
    med team_id satt -> den inbjudna får teamet direkt när hen aktiverar via
    /accept-invite. Inbjudningslänken visas på /team-sidan."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    email = email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="E-post krävs")
    if db.query(User).filter(User.email == email).first() is not None:
        return RedirectResponse(url="/team?err=upptagen", status_code=303)
    db.add(User(email=email, team_id=admin.team_id, team_role=TEAM_ROLE_MEMBER))
    db.commit()
    return RedirectResponse(url="/team", status_code=303)


def _team_target(db: Session, admin: User, user_id: int) -> User:
    """Hämta en medlem i admins EGET team (annars 404). Super-admin kan nå alla."""
    target = db.get(User, user_id)
    if target is None or (not admin.is_admin and target.team_id != admin.team_id):
        raise HTTPException(status_code=404, detail="Medlemmen hittades inte")
    return target


@router.post("/team/members/{user_id}/role")
async def set_member_role(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    role: str = Form(...),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    target = _team_target(db, admin, user_id)
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="Du kan inte ändra din egen roll")
    target.team_role = TEAM_ROLE_ADMIN if role == TEAM_ROLE_ADMIN else TEAM_ROLE_MEMBER
    db.commit()
    return RedirectResponse(url="/team", status_code=303)


@router.post("/team/members/{user_id}/remove")
async def remove_member(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Ta bort en medlem ur teamet (blir team-lös solo-användare). Teamets turer
    förblir teamägda. Kan inte ta bort sig själv."""
    target = _team_target(db, admin, user_id)
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="Du kan inte ta bort dig själv")
    target.team_id = None
    target.team_role = TEAM_ROLE_MEMBER
    db.commit()
    return RedirectResponse(url="/team", status_code=303)


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
