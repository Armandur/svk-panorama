"""Login/logout. Sluten inbjudan - ingen registrering här."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.auth import verify_password
from app.database import User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_form

router = APIRouter()


def _safe_next(next_url: str | None) -> str:
    """Bara lokala relativa vägar (skydd mot open redirect)."""
    if next_url and next_url.startswith("/") and not next_url.startswith("//"):
        return next_url
    return "/"


def _render_login(request: Request, next_url: str, error: str | None, status_code: int = 200) -> HTMLResponse:
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "login.html",
        {"csrf_token": token, "next": _safe_next(next_url), "error": error},
        status_code=status_code,
    )
    set_csrf_cookie(response, token)
    return response


@router.get("/login", response_class=HTMLResponse)
def login_form(request: Request, next: str = "/") -> HTMLResponse:
    return _render_login(request, next, error=None)


@router.post("/login")
async def login(
    request: Request,
    db: Session = Depends(get_db),
    email: str = Form(...),
    password: str = Form(...),
    next: str = Form("/"),
    _csrf: None = Depends(verify_csrf_form),
):
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if user is None or not verify_password(password, user.password_hash):
        return _render_login(request, next, error="Fel e-post eller lösenord.")
    request.session["uid"] = user.id
    return RedirectResponse(url=_safe_next(next), status_code=303)


@router.post("/logout")
async def logout(request: Request):
    # Ingen CSRF på logout: värsta fallet är att någon tvingar utloggning
    # (annoyance, ingen dataförlust) - och nav-formuläret har ingen token.
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)
