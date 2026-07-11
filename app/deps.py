"""Delade FastAPI-dependencies: DB-session, templates, CSRF-skydd,
projekt-lookup. Importeras härifrån - kopiera aldrig lokalt i route-filer."""
from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app import config
from app.auth import require_user
from app.database import Project, User, get_db  # get_db bor i database (undviker cirkulär import)

templates = Jinja2Templates(directory=str(config.REPO_ROOT / "app" / "templates"))

CSRF_COOKIE_NAME = "csrf_token"

__all__ = ["get_db", "templates", "CSRF_COOKIE_NAME"]  # get_db re-exporteras här


# --- CSRF ----------------------------------------------------------------
# Dubbel-cookie-mönster: en signerad token sätts som cookie när en sida med
# formulär/JS renderas. Formuläret skickar samma värde tillbaka som fält
# (HTML-formulär) eller header (JSON-anrop via fetch). Signeringen hindrar
# att en godtycklig sträng godkänns även om någon kunde sätta en cookie.


def new_csrf_token() -> str:
    raw = secrets.token_urlsafe(24)
    sig = hmac.new(config.SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def _csrf_token_well_formed(token: str) -> bool:
    if not token or "." not in token:
        return False
    raw, _, sig = token.rpartition(".")
    expected = hmac.new(config.SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def set_csrf_cookie(response, token: str) -> None:
    response.set_cookie(
        CSRF_COOKIE_NAME, token, samesite="lax", httponly=False, path="/"
    )


async def verify_csrf_form(request: Request) -> None:
    """CSRF-koll för formulärposter (multipart/x-www-form-urlencoded).
    Fältet csrf_token måste matcha cookien och vara giltigt signerat."""
    form = await request.form()
    field_value = form.get("csrf_token")
    cookie_value = request.cookies.get(CSRF_COOKIE_NAME)
    if (
        not field_value
        or not cookie_value
        or not _csrf_token_well_formed(str(field_value))
        or not hmac.compare_digest(str(field_value), cookie_value)
    ):
        raise HTTPException(status_code=403, detail="Ogiltig eller saknad CSRF-token")


def verify_csrf_header(request: Request) -> None:
    """CSRF-koll för JSON-anrop (fetch). Header X-CSRF-Token måste matcha
    cookien - kräver en preflight som blockeras eftersom appen inte
    tillåter CORS, vilket i sig stoppar korswebbplats-anrop."""
    header_value = request.headers.get("x-csrf-token")
    cookie_value = request.cookies.get(CSRF_COOKIE_NAME)
    if (
        not header_value
        or not cookie_value
        or not _csrf_token_well_formed(header_value)
        or not hmac.compare_digest(header_value, cookie_value)
    ):
        raise HTTPException(status_code=403, detail="Ogiltig eller saknad CSRF-token")


def get_project_or_404(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Project:
    """Kräver inloggning och att projektet ägs av användaren (eller admin).
    Returnerar 404 även vid fel ägare - läck inte att slugen finns."""
    project = db.query(Project).filter(Project.slug == slug).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Projektet hittades inte")
    if not user.is_admin and project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Projektet hittades inte")
    return project
