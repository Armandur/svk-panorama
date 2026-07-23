"""Admin: hantera användare (sluten inbjudan - admin skapar + bjuder in)."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import config
from app.auth import hash_password, make_invite_token, password_error, require_admin
from app.database import TEAM_ROLE_ADMIN, TEAM_ROLE_MEMBER, Project, Team, User, get_db
from app.deps import (
    new_csrf_token,
    request_origin,
    set_csrf_cookie,
    templates,
    verify_csrf_form,
    verify_csrf_header,
)
from app.routes.profile import _process_avatar
from app.routes.teams import _ORPHAN_MSG, _would_orphan_admin
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
            "int_settings": site_settings.all_int_settings(),
            "int_labels": _INT_SETTING_LABELS,
            "csrf_token": token,
            "msg": request.query_params.get("msg"),
        },
    )
    set_csrf_cookie(response, token)
    return response


# Etiketter + hjälptext för prestanda/gräns-inställningarna (ordningen styr formuläret).
_INT_SETTING_LABELS = [
    ("tile_concurrency", "Tiling-parallellitet (avvecklad)", "Styr inte längre samtidighet - se SVK_JOB_WORKERS (global jobbkö)."),
    ("tile_quality", "Tile-kvalitet (JPEG)", "1-100. Gäller nästa tiling-jobb."),
    ("preview_max_width", "Förhandsvisning: max bredd (px)", "Gäller NYA uppladdningar."),
    ("preview_quality", "Förhandsvisning: JPEG-kvalitet", "10-100. Gäller NYA uppladdningar."),
    ("max_panorama_mb", "Max panoramastorlek (MB)", "Gräns för uppladdade panoraman."),
    ("max_map_mb", "Max kart-/mediastorlek (MB)", "Gräns för kartbild + mediepool."),
]


@router.post("/admin/settings")
async def save_settings(
    request: Request,
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
):
    form = await request.form()
    site_settings.set_site_name(form.get("site_name", ""))
    for key, *_ in _INT_SETTING_LABELS:
        site_settings.set_int(key, form.get(key))
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
    teams = {t.id: t.name for t in db.query(Team).order_by(Team.name).all()}
    # Filter på team: "" = alla, "none" = team-lösa, "<id>" = det teamet.
    team_filter = request.query_params.get("team") or ""
    q = db.query(User)
    if team_filter == "none":
        q = q.filter(User.team_id.is_(None))
    elif team_filter.isdigit():
        q = q.filter(User.team_id == int(team_filter))
    users = q.order_by(User.created_at.asc()).all()
    # Diskanvändning per användare (turer + mediepool). Cachad per mapp -> billigt.
    # Full översikt med drill-down finns på /admin/storage.
    psizes = storage.project_sizes()
    msizes = storage.media_sizes()
    # Kolumnen visar användarens PERSONLIGA footprint (solo-turer + personlig pool) - team-
    # delade resurser (team-turer + team-pool) hör till teamet och redovisas på /admin/teams
    # och /admin/storage:s team-grupper, så inget dubbelräknas mellan vyerna.
    solo_slugs_by_owner: dict[int, list[str]] = {}
    for p in db.query(Project).filter(Project.team_id.is_(None)).all():
        solo_slugs_by_owner.setdefault(p.owner_id, []).append(p.slug)
    rows = []
    for u in users:
        used = sum(psizes.get(s, 0) for s in solo_slugs_by_owner.get(u.id, [])) + msizes.get(str(u.id), 0)
        rows.append({
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "team": teams.get(u.team_id) if u.team_id else None,
            "team_role": u.team_role,
            "has_avatar": u.avatar is not None,
            "is_admin": u.is_admin,
            "active": u.active,
            "pending": u.password_hash is None,
            "invite_url": _invite_url(request, u.id) if u.password_hash is None else None,
            "storage": used,
        })
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_users.html",
        {
            "users": rows,
            "me": admin.id,
            "active": "users",
            "teams": teams,
            "team_filter": team_filter,
            "msg": request.query_params.get("msg"),
            "error": request.query_params.get("error"),
            "csrf_token": token,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.get("/admin/storage", response_class=HTMLResponse)
def storage_page(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    """Dedikerad lagringsöversikt grupperad per TEAM (delade turer + team-pool) och per
    SOLO-användare (personliga turer + personlig pool), plus ospårade mappar. Varje tur/
    pool redovisas i EXAKT en grupp -> tracked + untracked == disk_total. Cachad
    (SVK_STORAGE_CACHE_TTL); 'Räkna om' tömmer cachen."""
    member_counts = dict(
        db.query(User.team_id, func.count(User.id))
        .filter(User.team_id.isnot(None)).group_by(User.team_id).all()
    )
    data = storage.classify_storage(
        teams=db.query(Team).order_by(Team.name).all(),
        users=db.query(User).order_by(User.created_at.asc()).all(),
        projects=db.query(Project).all(),
        member_counts=member_counts,
        psizes=storage.project_sizes(),
        msizes=storage.media_sizes(),
    )
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_storage.html",
        {"active": "storage", **data, "cache_ttl": config.STORAGE_CACHE_TTL,
         "csrf_token": token, "msg": request.query_params.get("msg")},
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/admin/storage/refresh")
def storage_refresh(
    request: Request,
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Töm diskanvändnings-cachen -> nästa laddning räknar om från disk."""
    storage.invalidate()
    return RedirectResponse(url="/admin/storage?msg=Räknade+om+diskanvändningen", status_code=302)


@router.get("/admin/teams", response_class=HTMLResponse)
def teams_page(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    """Super-admin team-översikt: alla team (iterera Team-tabellen så noll-medlem-team
    syns) med medlems-/turantal + storlek (turer + team-pool). Skapa/radera team."""
    teams = db.query(Team).order_by(Team.name).all()
    member_counts = dict(
        db.query(User.team_id, func.count(User.id))
        .filter(User.team_id.isnot(None)).group_by(User.team_id).all()
    )
    psizes = storage.project_sizes()
    msizes = storage.media_sizes()
    rows = []
    for t in teams:
        tours = db.query(Project).filter(Project.team_id == t.id).all()
        size = storage.team_usage_bytes([p.slug for p in tours], t.id, psizes, msizes)
        q = storage.quota_status(size, t.storage_quota_bytes)
        rows.append({
            "id": t.id, "name": t.name, "slug": t.slug,
            "members": member_counts.get(t.id, 0), "tours": len(tours), "size": size,
            "quota": t.storage_quota_bytes,
            "quota_gb": round(t.storage_quota_bytes / 1024**3, 2) if t.storage_quota_bytes else "",
            "pct": q["pct"], "over": q["over"],
        })
    rows.sort(key=lambda r: r["size"], reverse=True)
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_teams.html",
        {
            "active": "teams", "teams": rows, "csrf_token": token,
            "msg": request.query_params.get("msg"),
            "error": request.query_params.get("error"),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/admin/teams")
async def create_team_admin(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Super-admin skapar ett (tomt) team. Medlemmar/admin tilldelas sedan via
    /admin/users/{id}. Slug globalt unik (per-team-slug är Fas 4b)."""
    from app.services.project_files import slugify

    name = name.strip()
    if not name:
        return RedirectResponse(url="/admin/teams?error=Teamnamn+krävs", status_code=303)
    base = slugify(name) or "team"
    slug, i = base, 2
    while db.query(Team).filter(Team.slug == slug).first() is not None:
        slug, i = f"{base}-{i}", i + 1
    db.add(Team(name=name, slug=slug))
    db.commit()
    return RedirectResponse(url="/admin/teams?msg=Team+skapat", status_code=303)


@router.post("/admin/teams/{team_id}/delete")
async def delete_team_admin(
    request: Request,
    team_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Super-admin raderar ett team. Blockeras om teamet äger turer (samma guard som
    team-admins radering) - flytta/radera turerna först."""
    from app.routes.teams import delete_team_by_id

    if not delete_team_by_id(db, team_id):
        return RedirectResponse(
            url="/admin/teams?error=Teamet+äger+turer+-+flytta+eller+radera+dem+först",
            status_code=303)
    return RedirectResponse(url="/admin/teams?msg=Team+raderat", status_code=303)


@router.post("/admin/teams/{team_id}/quota")
async def set_team_quota(
    request: Request,
    team_id: int,
    db: Session = Depends(get_db),
    quota_gb: str = Form(""),
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Sätt (eller nolla) teamets lagringskvot. Fältet anges i GB; tomt/0 = ingen kvot
    (obegränsat). HÅRD gräns: team_over_quota grindar content-adderande åtgärder
    (upload/media/tiling/import) med 409 när teamet ligger över."""
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Teamet finns inte")
    raw = quota_gb.strip().replace(",", ".")
    if not raw:
        team.storage_quota_bytes = None
    else:
        try:
            gb = float(raw)
        except ValueError:
            return RedirectResponse(url="/admin/teams?error=Ogiltig+kvot", status_code=303)
        if gb < 0:
            return RedirectResponse(url="/admin/teams?error=Kvot+kan+inte+vara+negativ", status_code=303)
        team.storage_quota_bytes = int(gb * 1024**3) if gb > 0 else None
    db.commit()
    return RedirectResponse(url="/admin/teams?msg=Kvot+uppdaterad", status_code=303)


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
    media_bytes = storage.media_size(target.owner_key)
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
            "all_teams": db.query(Team).order_by(Team.name).all(),
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
    # Att spärra teamets enda team-admin lämnar teamet utan aktiv admin (samma
    # orphaning-effekt som degradering/borttagning) - hedra sista-admin-skyddet.
    if not want_active and target.team_id is not None and _would_orphan_admin(db, target.team_id, target):
        return _back(user_id, error=_ORPHAN_MSG)
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


@router.post("/admin/users/{user_id}/team")
async def admin_set_team(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    team_id: str = Form(""),
    team_role: str = Form(TEAM_ROLE_MEMBER),
    _csrf: None = Depends(verify_csrf_form),
):
    """Super-admin tilldelar användaren ett team + roll (eller tar bort teamet, team_id
    tomt). SISTA-ADMIN-SKYDD: om ändringen tar target UR sitt nuvarande team eller
    degraderar target där, och target är den enda team-adminen medan andra medlemmar
    finns -> blockera (utse ny admin först). Speglar target-sessionen om target = admin."""
    from app.auth import set_user_session

    target = _target_or_404(db, user_id)
    new_team_id = int(team_id) if team_id.strip().isdigit() else None
    new_role = TEAM_ROLE_ADMIN if team_role == TEAM_ROLE_ADMIN else TEAM_ROLE_MEMBER
    if new_team_id is not None and db.get(Team, new_team_id) is None:
        return _back(user_id, error="Teamet finns inte.")
    leaving = target.team_id is not None and new_team_id != target.team_id
    demoting = (target.team_id is not None and new_team_id == target.team_id
                and new_role != TEAM_ROLE_ADMIN)
    if (leaving or demoting) and _would_orphan_admin(db, target.team_id, target):
        return _back(user_id, error=_ORPHAN_MSG)
    target.team_id = new_team_id
    target.team_role = new_role if new_team_id is not None else TEAM_ROLE_MEMBER
    db.commit()
    if target.id == admin.id:
        set_user_session(request, target)  # spegla eget team-byte i sessionen
    return _back(user_id, msg="Team uppdaterat.")


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
            if u.team_id is not None and _would_orphan_admin(db, u.team_id, u):
                skipped += 1  # sista team-admin -> orphaning-skyddet
                continue
            u.active = False
            done += 1
        elif action == "enable":
            u.active = True
            done += 1
        elif action == "delete":
            if db.query(Project).filter(Project.owner_id == u.id).count():
                skipped += 1  # äger turer -> delete-guarden
                continue
            if u.team_id is not None and _would_orphan_admin(db, u.team_id, u):
                skipped += 1  # sista team-admin -> orphaning-skyddet
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
        msg += f", {skipped} hoppade (du själv, ägare av turer eller sista team-admin)"
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
    if user.team_id is not None and _would_orphan_admin(db, user.team_id, user):
        return RedirectResponse(url=f"/admin/users?error={quote(_ORPHAN_MSG)}", status_code=303)
    db.delete(user)
    db.commit()
    return RedirectResponse(url="/admin/users", status_code=303)
