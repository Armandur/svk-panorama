"""Team: self-serve skapande + enkel team-sida (medlemslista).

Fas 4: ett team äger turer och delar media/presets bland medlemmarna. Vem som
helst kan skapa ett team (blir team_admin). En användare tillhör ett team (enkel
FK). Team-scopad användarhantering (bjuda in fler m.m.) ligger i team-admin-UI:t."""
from __future__ import annotations

import re
import shutil

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.auth import make_invite_token, require_team_admin, require_user, set_user_session
from app.database import TEAM_ROLE_ADMIN, TEAM_ROLE_MEMBER, Project, Team, User, get_db
from app.deps import new_csrf_token, request_origin, set_csrf_cookie, templates, verify_csrf_form
from app.services import media as media_svc
from app.services.project_files import _atomic_write_text, slugify, tour_json_path
from app.services.tiling import manifest_path

router = APIRouter()


def _bring_solo_to_team(db: Session, user: User, team: Team) -> int:
    """Flytta användarens SOLO-turer (team_id NULL) in i det nya teamet: sätt team_id,
    flytta hela den personliga mediapoolen -> team-poolen och skriv om
    `/media/<user_id>/`-referenser -> `/media/team-<id>/` i tour.json + tiles-manifest.
    Nytt team -> tom team-pool, ren flytt. Returnerar antal flyttade turer."""
    solo = db.query(Project).filter(Project.owner_id == user.id, Project.team_id.is_(None)).all()
    if not solo:
        return 0
    old_key, new_key = str(user.id), f"team-{team.id}"

    # Flytta personliga poolens filer (inkl. .thumbs) in i team-poolen.
    src, dst = media_svc.owner_dir(old_key), media_svc.owner_dir(new_key)
    if src.exists():
        dst.mkdir(parents=True, exist_ok=True)
        for entry in src.iterdir():
            target = dst / entry.name
            if not target.exists():
                shutil.move(str(entry), str(target))

    # Skriv om media-referenser (textsub som backup._rewrite_refs; `/`-gränsen hindrar
    # att /media/1/ råkar träffa /media/10/).
    ref_re = re.compile(r"/media/" + re.escape(old_key) + "/")
    for p in solo:
        p.team_id = team.id
        for path in (tour_json_path(p.slug), manifest_path(p.slug)):
            if path.exists():
                txt = ref_re.sub(f"/media/{new_key}/", path.read_text(encoding="utf-8"))
                _atomic_write_text(path, txt)
    db.commit()
    return len(solo)


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
    # Antal solo-turer (för "ta med mina turer"-valet på skapa-team-formuläret).
    solo_count = 0 if user.team_id else db.query(Project).filter(
        Project.owner_id == user.id, Project.team_id.is_(None)).count()
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
            "solo_count": solo_count, "csrf_token": token,
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
    # Konton en team-admin skapar äger inte egna turer utanför teamet (default) -
    # team-admin kan slå på det per medlem efteråt.
    db.add(User(email=email, team_id=admin.team_id, team_role=TEAM_ROLE_MEMBER, can_personal=False))
    db.commit()
    return RedirectResponse(url="/team", status_code=303)


def _team_target(db: Session, admin: User, user_id: int) -> User:
    """Hämta en medlem i admins EGET team (annars 404). Super-admin kan nå alla."""
    target = db.get(User, user_id)
    if target is None or (not admin.is_admin and target.team_id != admin.team_id):
        raise HTTPException(status_code=404, detail="Medlemmen hittades inte")
    return target


def _would_orphan_admin(db: Session, team_id: int, target: User) -> bool:
    """SKYDDSRÄCKE: True om att degradera/ta bort/lämna som `target` skulle lämna
    teamet UTAN någon team-admin MEDAN andra medlemmar finns kvar. (Är target inte
    admin, eller finns fler admins, eller är target ensam medlem -> inget att skydda.)"""
    if target.team_role != TEAM_ROLE_ADMIN:
        return False
    other_admins = db.query(User).filter(
        User.team_id == team_id, User.team_role == TEAM_ROLE_ADMIN, User.id != target.id
    ).count()
    if other_admins > 0:
        return False
    other_members = db.query(User).filter(User.team_id == team_id, User.id != target.id).count()
    return other_members > 0


_ORPHAN_MSG = "Utse en ny team-admin först - teamet får inte bli utan admin."


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
    new_role = TEAM_ROLE_ADMIN if role == TEAM_ROLE_ADMIN else TEAM_ROLE_MEMBER
    if new_role == TEAM_ROLE_MEMBER and _would_orphan_admin(db, target.team_id, target):
        raise HTTPException(status_code=400, detail=_ORPHAN_MSG)
    target.team_role = new_role
    db.commit()
    return RedirectResponse(url="/team", status_code=303)


@router.post("/team/members/{user_id}/personal")
async def set_member_personal(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    allow: str = Form(...),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Team-admin styr om en medlem får äga egna (icke-team) turer."""
    target = _team_target(db, admin, user_id)
    target.can_personal = allow == "1"
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
    if _would_orphan_admin(db, target.team_id, target):
        raise HTTPException(status_code=400, detail=_ORPHAN_MSG)
    target.team_id = None
    target.team_role = TEAM_ROLE_MEMBER
    db.commit()
    return RedirectResponse(url="/team", status_code=303)


@router.post("/team/rename")
async def rename_team(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Byt teamets visningsnamn (team-admin). Slug/adresser oförändrade."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    name = name.strip()
    if name:
        team = db.get(Team, admin.team_id)
        team.name = name
        db.commit()
    return RedirectResponse(url="/team", status_code=303)


@router.post("/team/leave")
async def leave_team(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Lämna teamet (blir team-lös). Teamets turer förblir teamägda. Sista-admin-
    skyddet gäller: den enda admin:en kan inte lämna om andra medlemmar finns kvar."""
    if user.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    if _would_orphan_admin(db, user.team_id, user):
        raise HTTPException(status_code=400, detail="Utse en ny team-admin innan du lämnar teamet.")
    user.team_id = None
    user.team_role = TEAM_ROLE_MEMBER
    db.commit()
    set_user_session(request, user)  # spegla att man nu är team-lös
    return RedirectResponse(url="/editor", status_code=303)


@router.post("/team/delete")
async def delete_team(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Radera teamet (team-admin). BLOCKERAS om teamet äger turer (flytta/radera dem
    först - vi tar aldrig bort turdata implicit). Annars: släpp alla medlemmar (team-
    lösa), radera teamets presets + mediapool, ta bort team-raden."""
    from app.database import BrandingPreset, ThemePreset

    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    tid = admin.team_id
    if db.query(Project).filter(Project.team_id == tid).count() > 0:
        return RedirectResponse(url="/team?err=har_turer", status_code=303)

    db.query(User).filter(User.team_id == tid).update(
        {"team_id": None, "team_role": TEAM_ROLE_MEMBER}, synchronize_session=False)
    db.query(ThemePreset).filter(ThemePreset.team_id == tid).delete(synchronize_session=False)
    db.query(BrandingPreset).filter(BrandingPreset.team_id == tid).delete(synchronize_session=False)
    team = db.get(Team, tid)
    if team:
        db.delete(team)
    db.commit()
    shutil.rmtree(media_svc.owner_dir(f"team-{tid}"), ignore_errors=True)

    db.refresh(admin)  # bulk-update lämnade sessionsobjektet stale
    set_user_session(request, admin)
    return RedirectResponse(url="/editor", status_code=303)


@router.post("/teams")
async def create_team(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    bring_tours: str = Form(None),
    user: User = Depends(require_user),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Skapa ett team och gör skaparen till team_admin. En användare tillhör ETT
    team - redan medlem -> vägra (byte/lämna hanteras separat senare). bring_tours=1
    flyttar skaparens befintliga solo-turer + personliga mediapool in i teamet."""
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

    # Flytta solo-turer FÖRE team_id sätts på användaren (flytten läser owner_key =
    # <user_id>, dvs den gamla personliga poolen).
    if bring_tours == "1":
        _bring_solo_to_team(db, user, team)

    user.team_id = team.id
    user.team_role = TEAM_ROLE_ADMIN
    db.commit()
    set_user_session(request, user)  # spegla nya team-scopet i sessionen direkt

    return RedirectResponse(url="/team", status_code=303)
