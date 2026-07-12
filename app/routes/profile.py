"""Profil: användarspecifika inställningar (namn, lösenord, profilbild)."""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from PIL import Image
from sqlalchemy.orm import Session

from app.auth import hash_password, password_error, require_user, verify_password
from app.database import User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_form, verify_csrf_header
from app.services.project_files import validate_image_magic, validate_size

router = APIRouter()

AVATAR_SIZE = 256


def _process_avatar(data: bytes) -> bytes:
    """Center-croppa till kvadrat och skala till en PNG-avatar."""
    im = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = im.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    im = im.crop((left, top, left + s, top + s)).resize((AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


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
    request.session["name"] = user.name or ""  # kontokortet uppdateras
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
    pw_err = password_error(new)
    if pw_err:
        return _render(request, user, error=pw_err)
    if new != new2:
        return _render(request, user, error="De nya lösenorden matchar inte.")
    user.password_hash = hash_password(new)
    db.commit()
    return _render(request, user, msg="Lösenordet ändrat.")


@router.get("/profile/avatar")
def get_avatar(user: User = Depends(require_user)) -> Response:
    if not user.avatar:
        raise HTTPException(status_code=404, detail="Ingen profilbild")
    return Response(content=user.avatar, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.post("/profile/avatar")
async def upload_avatar(
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    file: UploadFile = File(...),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    content = await file.read()
    validate_size(content, file.filename or "bild", max_mb=10)
    validate_image_magic(content, file.filename or "bild")
    try:
        user.avatar = _process_avatar(content)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Kunde inte läsa bilden")
    db.commit()
    return {"ok": True}


@router.post("/profile/avatar/delete")
async def delete_avatar(
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    user.avatar = None
    db.commit()
    return {"ok": True}
