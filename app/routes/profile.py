"""Profil: användarspecifika inställningar (namn, byt lösenord)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.auth import hash_password, require_user, verify_password
from app.database import User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_form

router = APIRouter()


def _render(request: Request, user: User, msg=None, error=None) -> HTMLResponse:
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request, "profile.html", {"user": user, "csrf_token": token, "msg": msg, "error": error}
    )
    set_csrf_cookie(response, token)
    return response


@router.get("/profile", response_class=HTMLResponse)
def profile_page(request: Request, user: User = Depends(require_user)) -> HTMLResponse:
    return _render(request, user)


@router.post("/profile")
async def update_profile(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    name: str = Form(""),
    _csrf: None = Depends(verify_csrf_form),
):
    user.name = name.strip() or None
    db.commit()
    return _render(request, user, msg="Profil sparad.")


@router.post("/profile/password")
async def change_password(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    current: str = Form(...),
    new: str = Form(...),
    new2: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
):
    if not verify_password(current, user.password_hash):
        return _render(request, user, error="Fel nuvarande lösenord.")
    if len(new) < 8:
        return _render(request, user, error="Nytt lösenord måste vara minst 8 tecken.")
    if new != new2:
        return _render(request, user, error="De nya lösenorden matchar inte.")
    user.password_hash = hash_password(new)
    db.commit()
    return _render(request, user, msg="Lösenordet ändrat.")
