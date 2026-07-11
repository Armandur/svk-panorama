"""Admin: hantera användare (sluten inbjudan - admin skapar + bjuder in)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app import config
from app.auth import make_invite_token, require_admin
from app.database import Project, User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_form

router = APIRouter()


def _invite_url(request: Request, user_id: int) -> str:
    base = config.BASE_URL or str(request.base_url).rstrip("/")
    return f"{base}/accept-invite?token={make_invite_token(user_id)}"


@router.get("/admin/users", response_class=HTMLResponse)
def users_page(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    users = db.query(User).order_by(User.created_at.asc()).all()
    rows = [
        {
            "id": u.id,
            "email": u.email,
            "is_admin": u.is_admin,
            "pending": u.password_hash is None,
            "invite_url": _invite_url(request, u.id) if u.password_hash is None else None,
        }
        for u in users
    ]
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_users.html",
        {"users": rows, "me": admin.id, "error": request.query_params.get("error"), "csrf_token": token},
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/admin/users")
async def create_user(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    email: str = Form(...),
    is_admin: str = Form(""),
    _csrf: None = Depends(verify_csrf_form),
):
    email = email.strip().lower()
    if not email:
        return RedirectResponse(url="/admin/users?error=E-post+kr%C3%A4vs", status_code=303)
    if db.query(User).filter(User.email == email).first():
        return RedirectResponse(url="/admin/users?error=E-posten+finns+redan", status_code=303)
    db.add(User(email=email, is_admin=bool(is_admin)))  # password_hash NULL -> inbjuden
    db.commit()
    return RedirectResponse(url="/admin/users", status_code=303)


@router.post("/admin/users/{user_id}/delete")
async def delete_user(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
):
    if user_id == admin.id:
        return RedirectResponse(url="/admin/users?error=Du+kan+inte+ta+bort+dig+sj%C3%A4lv", status_code=303)
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Användaren finns inte")
    owns = db.query(Project).filter(Project.owner_id == user_id).count()
    if owns:
        return RedirectResponse(url=f"/admin/users?error=Anv%C3%A4ndaren+%C3%A4ger+{owns}+turer", status_code=303)
    db.delete(user)
    db.commit()
    return RedirectResponse(url="/admin/users", status_code=303)
