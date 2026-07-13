"""Login/logout. Sluten inbjudan - ingen registrering här."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.auth import hash_password, password_error, read_invite_token, set_user_session, verify_password
from app.database import User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_form
from app.services import ratelimit

router = APIRouter()


def _safe_next(next_url: str | None) -> str:
    """Bara lokala relativa vägar (skydd mot open redirect). Tom/ogiltig -> editorns
    hemsida (/ är den publika landningssidan, inte inloggningsmålet)."""
    if next_url and next_url.startswith("/") and not next_url.startswith("//"):
        return next_url
    return "/editor"


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
def login_form(request: Request, next: str = "/editor") -> HTMLResponse:
    return _render_login(request, next, error=None)


@router.post("/login")
async def login(
    request: Request,
    db: Session = Depends(get_db),
    email: str = Form(...),
    password: str = Form(...),
    next: str = Form("/editor"),
    _csrf: None = Depends(verify_csrf_form),
):
    key = "login:" + ratelimit.client_ip(request)
    if ratelimit.too_many(key):
        return _render_login(
            request, next,
            error="För många misslyckade försök. Vänta en stund och försök igen.",
            status_code=429,
        )
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    if user is None or not verify_password(password, user.password_hash):
        ratelimit.record_failure(key)
        return _render_login(request, next, error="Fel e-post eller lösenord.")
    if not user.active:
        ratelimit.record_failure(key)
        return _render_login(request, next, error="Kontot är spärrat. Kontakta en administratör.")
    ratelimit.reset(key)
    set_user_session(request, user)
    return RedirectResponse(url=_safe_next(next), status_code=303)


@router.post("/logout")
async def logout(request: Request):
    # Ingen CSRF på logout: värsta fallet är att någon tvingar utloggning
    # (annoyance, ingen dataförlust) - och nav-formuläret har ingen token.
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)


def _render_accept(request, token, valid, email, error, status_code=200):
    csrf = new_csrf_token()
    resp = templates.TemplateResponse(
        request,
        "accept_invite.html",
        {"csrf_token": csrf, "token": token, "valid": valid, "email": email, "error": error},
        status_code=status_code,
    )
    set_csrf_cookie(resp, csrf)
    return resp


@router.get("/accept-invite", response_class=HTMLResponse)
def accept_invite_form(request: Request, token: str = "", db: Session = Depends(get_db)) -> HTMLResponse:
    uid = read_invite_token(token)
    user = db.get(User, uid) if uid else None
    # Bara ett konto som ännu inte satt lösenord får aktiveras via länken - annars
    # kan en läckt (men ännu giltig) inbjudan kapa ett redan aktivt konto.
    pending = user is not None and user.password_hash is None
    return _render_accept(request, token, valid=pending, email=user.email if pending else None, error=None)


@router.post("/accept-invite")
async def accept_invite(
    request: Request,
    db: Session = Depends(get_db),
    token: str = Form(""),
    password: str = Form(...),
    password2: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
):
    # Rate-limita mot token-gissning (tokens är signerade -> infeasibelt, men billig
    # defense-in-depth). Räkna bara ogiltig/använd token som "försök"; legitima
    # lösenordsfel (för kort/matchar inte) triggar inte gränsen.
    key = "invite:" + ratelimit.client_ip(request)
    if ratelimit.too_many(key):
        return _render_accept(request, token, valid=False, email=None, error="För många försök. Vänta en stund och försök igen.")
    uid = read_invite_token(token)
    user = db.get(User, uid) if uid else None
    if user is None:
        ratelimit.record_failure(key)
        return _render_accept(request, token, valid=False, email=None, error="Länken är ogiltig eller har gått ut.")
    if user.password_hash is not None:
        # Kontot är redan aktiverat - en engångslänk får inte återanvändas för att
        # sätta ett nytt lösenord på ett befintligt konto (kontokapning).
        ratelimit.record_failure(key)
        return _render_accept(request, token, valid=False, email=None, error="Länken är redan använd. Be en administratör om en ny inbjudan eller logga in.")
    pw_err = password_error(password)
    if pw_err:
        return _render_accept(request, token, valid=True, email=user.email, error=pw_err)
    if password != password2:
        return _render_accept(request, token, valid=True, email=user.email, error="Lösenorden matchar inte.")
    user.password_hash = hash_password(password)
    db.commit()
    ratelimit.reset(key)
    set_user_session(request, user)
    return RedirectResponse(url="/editor", status_code=303)
