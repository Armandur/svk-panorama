"""Admin: hantera användare (sluten inbjudan - admin skapar + bjuder in)."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from app.auth import hash_password, make_invite_token, password_error, require_admin
from app.database import Project, User, get_db
from app.deps import (
    new_csrf_token,
    request_origin,
    set_csrf_cookie,
    templates,
    verify_csrf_form,
    verify_csrf_header,
)
from app.routes.profile import _process_avatar
from app.services import settings as site_settings
from app.services import storage
from app.services.project_files import validate_image_magic, validate_size
from app.services.tiling import project_tile_state

router = APIRouter()


@router.get("/admin")
def admin_home(admin: User = Depends(require_admin)) -> RedirectResponse:
    return RedirectResponse(url="/admin/users", status_code=302)


def _invite_url(request: Request, user_id: int) -> str:
    return f"{request_origin(request)}/accept-invite?token={make_invite_token(user_id)}"


def _target_or_404(db: Session, user_id: int) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Användaren finns inte")
    return target


def _back(user_id: int, msg: str | None = None, error: str | None = None) -> RedirectResponse:
    url = f"/admin/users/{user_id}"
    if msg:
        url += f"?msg={quote(msg)}"
    elif error:
        url += f"?error={quote(error)}"
    return RedirectResponse(url=url, status_code=303)


@router.get("/admin/settings", response_class=HTMLResponse)
def settings_page(
    request: Request,
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_settings.html",
        {
            "active": "settings",
            "site_name_value": site_settings.get_site_name(),
            "csrf_token": token,
            "msg": request.query_params.get("msg"),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/admin/settings")
async def save_settings(
    request: Request,
    admin: User = Depends(require_admin),
    site_name: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
):
    site_settings.set_site_name(site_name)
    return RedirectResponse(url="/admin/settings?msg=Sparat", status_code=303)


@router.get("/admin/settings/texts", response_class=HTMLResponse)
def texts_page(
    request: Request,
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_texts.html",
        {
            "active": "texts",
            "workflow_text": site_settings.get_workflow_text(),
            "csrf_token": token,
            "msg": request.query_params.get("msg"),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/admin/settings/texts")
async def save_texts(
    request: Request,
    admin: User = Depends(require_admin),
    workflow_text: str = Form(""),
    _csrf: None = Depends(verify_csrf_form),
):
    site_settings.set_workflow_text(workflow_text)
    return RedirectResponse(url="/admin/settings/texts?msg=Sparat", status_code=303)


@router.get("/admin/users", response_class=HTMLResponse)
def users_page(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    users = db.query(User).order_by(User.created_at.asc()).all()
    # Diskanvändning: skanna mapparna en gång och summera per användare (turer +
    # mediepool). Ospårade mappar (utan matchande DB-rad) fångas som differens.
    psizes = storage.project_sizes()
    msizes = storage.media_sizes()
    slugs_by_owner: dict[int, list[str]] = {}
    for p in db.query(Project).all():
        slugs_by_owner.setdefault(p.owner_id, []).append(p.slug)
    rows = []
    tracked = 0
    for u in users:
        used = sum(psizes.get(s, 0) for s in slugs_by_owner.get(u.id, [])) + msizes.get(u.id, 0)
        tracked += used
        rows.append({
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "has_avatar": u.avatar is not None,
            "is_admin": u.is_admin,
            "active": u.active,
            "pending": u.password_hash is None,
            "invite_url": _invite_url(request, u.id) if u.password_hash is None else None,
            "storage": used,
        })
    disk_total = sum(psizes.values()) + sum(msizes.values())
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_users.html",
        {
            "users": rows,
            "me": admin.id,
            "active": "users",
            "storage_tracked": tracked,
            "storage_disk": disk_total,
            "storage_untracked": max(0, disk_total - tracked),
            "msg": request.query_params.get("msg"),
            "error": request.query_params.get("error"),
            "csrf_token": token,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.get("/admin/users/{user_id}/projects", response_class=HTMLResponse)
def user_projects(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Användaren finns inte")
    projects = (
        db.query(Project).filter(Project.owner_id == user_id).order_by(Project.created_at.desc()).all()
    )
    tile_states = {p.slug: project_tile_state(p.slug) for p in projects}
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_user_projects.html",
        {
            "target": target,
            "projects": projects,
            "tile_states": tile_states,
            "active": "users",
            "csrf_token": token,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.get("/admin/users/{user_id}", response_class=HTMLResponse)
def user_detail(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    target = _target_or_404(db, user_id)
    projects = db.query(Project).filter(Project.owner_id == user_id).order_by(Project.created_at.desc()).all()
    # Lagringsnedbrytning: per tur + mediepool + total.
    storage_rows = [{"slug": p.slug, "name": p.name, "bytes": storage.project_size(p.slug)} for p in projects]
    media_bytes = storage.media_size(user_id)
    storage_total = sum(r["bytes"] for r in storage_rows) + media_bytes
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_user_detail.html",
        {
            "target": target,
            "is_self": target.id == admin.id,
            "owns": len(projects),
            "pending": target.password_hash is None,
            "invite_url": _invite_url(request, target.id) if target.password_hash is None else None,
            "active": "users",
            "storage_rows": storage_rows,
            "storage_media": media_bytes,
            "storage_total": storage_total,
            "csrf_token": token,
            "msg": request.query_params.get("msg"),
            "error": request.query_params.get("error"),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/admin/users/{user_id}/profile")
async def admin_set_name(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    name: str = Form(""),
    _csrf: None = Depends(verify_csrf_form),
):
    target = _target_or_404(db, user_id)
    target.name = name.strip() or None
    db.commit()
    if target.id == admin.id:  # egen ändring -> uppdatera kontokortet
        request.session["name"] = target.name or ""
    return _back(user_id, msg="Namn sparat.")


@router.post("/admin/users/{user_id}/password")
async def admin_set_password(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    new: str = Form(...),
    new2: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
):
    target = _target_or_404(db, user_id)
    pw_err = password_error(new)
    if pw_err:
        return _back(user_id, error=pw_err)
    if new != new2:
        return _back(user_id, error="Lösenorden matchar inte.")
    target.password_hash = hash_password(new)  # admin override - inget nuvarande krävs
    db.commit()
    return _back(user_id, msg="Lösenordet ändrat.")


@router.get("/admin/users/{user_id}/avatar")
def admin_get_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    target = _target_or_404(db, user_id)
    if not target.avatar:
        raise HTTPException(status_code=404, detail="Ingen profilbild")
    return Response(content=target.avatar, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.post("/admin/users/{user_id}/avatar")
async def admin_upload_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    file: UploadFile = File(...),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    target = _target_or_404(db, user_id)
    content = await file.read()
    validate_size(content, file.filename or "bild", max_mb=10)
    validate_image_magic(content, file.filename or "bild")
    try:
        target.avatar = _process_avatar(content)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Kunde inte läsa bilden")
    db.commit()
    return {"ok": True}


@router.post("/admin/users/{user_id}/avatar/delete")
async def admin_delete_avatar(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    target = _target_or_404(db, user_id)
    target.avatar = None
    db.commit()
    return {"ok": True}


@router.post("/admin/users/{user_id}/active")
async def admin_set_active(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    active: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
):
    target = _target_or_404(db, user_id)
    want_active = active == "1"
    if not want_active and target.id == admin.id:
        return _back(user_id, error="Du kan inte spärra ditt eget konto.")
    target.active = want_active
    db.commit()
    return _back(user_id, msg="Kontot aktiverat." if want_active else "Kontot spärrat.")


@router.post("/admin/users/{user_id}/admin")
async def admin_set_role(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    is_admin: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
):
    target = _target_or_404(db, user_id)
    want_admin = is_admin == "1"
    if not want_admin and target.id == admin.id:
        return _back(user_id, error="Du kan inte ta bort din egen adminbehörighet.")
    target.is_admin = want_admin
    db.commit()
    return _back(user_id, msg="Användaren är nu administratör." if want_admin else "Adminbehörighet borttagen.")


@router.post("/admin/users/batch")
async def batch_users(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    action: str = Form(...),
    user_ids: list[int] = Form(default=[]),
    _csrf: None = Depends(verify_csrf_form),
):
    if action not in {"reset_password", "disable", "enable", "delete"}:
        return RedirectResponse(url="/admin/users?error=Ok%C3%A4nd+%C3%A5tg%C3%A4rd", status_code=303)
    if not user_ids:
        return RedirectResponse(url="/admin/users?error=Inga+anv%C3%A4ndare+valda", status_code=303)

    targets = db.query(User).filter(User.id.in_(user_ids)).all()
    done = 0
    skipped = 0
    for u in targets:
        # Aldrig destruktiva åtgärder på det egna kontot (undvik självutlåsning).
        if u.id == admin.id and action in {"reset_password", "disable", "delete"}:
            skipped += 1
            continue
        if action == "reset_password":
            u.password_hash = None  # -> inbjuden igen, sätter nytt via länk
            done += 1
        elif action == "disable":
            u.active = False
            done += 1
        elif action == "enable":
            u.active = True
            done += 1
        elif action == "delete":
            if db.query(Project).filter(Project.owner_id == u.id).count():
                skipped += 1  # äger turer -> delete-guarden
                continue
            db.delete(u)
            done += 1
    db.commit()

    labels = {
        "reset_password": "återställda",
        "disable": "spärrade",
        "enable": "aktiverade",
        "delete": "borttagna",
    }
    msg = f"{done} {labels[action]}"
    if skipped:
        msg += f", {skipped} hoppade (du själv eller ägare av turer)"
    return RedirectResponse(url=f"/admin/users?msg={quote(msg)}", status_code=303)


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
