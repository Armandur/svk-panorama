"""Team: self-serve skapande + enkel team-sida (medlemslista).

Fas 4: ett team äger turer och delar media/presets bland medlemmarna. Vem som
helst kan skapa ett team (blir team_admin). En användare tillhör ett team (enkel
FK). Team-scopad användarhantering (bjuda in fler m.m.) ligger i team-admin-UI:t."""
from __future__ import annotations

import datetime
import re
import shutil
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import update
from sqlalchemy.orm import Session

from app import config
from app.auth import make_invite_token, require_team_admin, require_user, set_user_session
from app.database import TEAM_ROLE_ADMIN, TEAM_ROLE_MEMBER, Project, Team, User, get_db
from app.deps import (
    QUOTA_MSG,
    get_project_or_404,
    new_csrf_token,
    project_owner_key,
    request_origin,
    resolve_workspace,
    set_csrf_cookie,
    team_over_quota,
    templates,
    user_may_use_workspace,
    verify_csrf_form,
    verify_csrf_header,
)
from app.services import checkout
from app.services import domains as domains_svc
from app.services import history
from app.services import media as media_svc
from app.services import npm
from app.services import storage
from app.services.project_files import (
    _atomic_write_text,
    last_modified,
    project_dir,
    read_tour,
    slugify,
    tour_json_path,
    tour_lock,
)
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

    # Skriv om media-referenser (samma rå textsub som _rewrite_tour_media_key, under
    # tour_lock - annars kan en samtidig scen-/kartspar race:a mot omskrivningen).
    for p in solo:
        p.team_id = team.id
        _rewrite_tour_media_key(p.slug, old_key, new_key)
    db.commit()
    return len(solo)


def _tour_media_names(slug: str, owner_key: str) -> set[str]:
    """Namn på poolbilder i `owner_key`-poolen som turens tour.json refererar (alla
    språkvarianter av hotspot-text/body + branding). Använder bundle-referens-regexen."""
    from app.services.bundle import _media_refs  # lokal import: bundle drar tunga beroenden

    tour = read_tour(slug)
    return {name for owner, name in _media_refs(tour) if owner == owner_key}


def _copy_pool_media(old_key: str, new_key: str, names: set[str], uploader: dict | None) -> None:
    """Kopiera namngivna poolbilder (+ ev. tumnagel) old_key -> new_key om de saknas i
    målet. COPY-AND-LEAVE: källpoolen lämnas orörd - den kan delas av andra turer, och
    historik-snapshots + publika /s-länkar refererar fortfarande den gamla nyckeln.
    Team-mål -> stämpla uploadern så biblioteket kan visa 'uppladdad av'."""
    if old_key == new_key or not names:
        return
    src, dst = media_svc.owner_dir(old_key), media_svc.owner_dir(new_key)
    dst.mkdir(parents=True, exist_ok=True)
    thumb_src, thumb_dst = media_svc._thumb_dir(old_key), media_svc._thumb_dir(new_key)
    # Städa det HÄR anropet hann kopiera om något fallerar mitt i - annars ligger
    # halvkopierade, oreferrerade filer kvar i målpoolen + rått 500 till användaren.
    copied: list[Path] = []
    try:
        for name in names:
            s = src / name
            if s.exists() and not (dst / name).exists():
                shutil.copy2(str(s), str(dst / name))
                copied.append(dst / name)
                if uploader and new_key.startswith("team-"):
                    media_svc._record_uploader(new_key, name, uploader)
            ts = thumb_src / (name + ".jpg")
            if ts.exists() and not (thumb_dst / (name + ".jpg")).exists():
                thumb_dst.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(ts), str(thumb_dst / (name + ".jpg")))
                copied.append(thumb_dst / (name + ".jpg"))
    except OSError as exc:
        for f in copied:
            f.unlink(missing_ok=True)
        raise ValueError("Kunde inte kopiera turens bilder till målytan - flytten avbröts.") from exc


def _rewrite_tour_media_key(slug: str, old_key: str, new_key: str) -> None:
    """Skriv om /media/<old_key>/ -> /media/<new_key>/ i tour.json (under tour_lock) +
    tiles-manifest (troligen no-op - manifestet bär tile-paths, inte media). Rå textsub
    som _bring_solo_to_team; snapshottar INTE (flytt är en ägarskaps-op, ej redigering).
    `/`-gränsen hindrar att /media/1/ råkar träffa /media/10/."""
    ref_re = re.compile(r"/media/" + re.escape(old_key) + "/")
    with tour_lock:
        for path in (tour_json_path(slug), manifest_path(slug)):
            if path.exists():
                txt = path.read_text(encoding="utf-8")
                new = ref_re.sub(f"/media/{new_key}/", txt)
                if new != txt:
                    _atomic_write_text(path, new)


def _apply_move(
    db: Session, project: Project, new_team_id: int | None, new_owner_id: int | None,
    uploader: dict | None,
) -> None:
    """Utför en yt-flytt: kopiera turens media till målytans pool, skriv om refs, sätt
    ägarskap och rensa flyttbegäran + redigeringslås. `new_owner_id` sätts bara vid
    flytt UT till en personlig yta (annars bevaras owner_id = skapad-av). Media kopieras
    FÖRE tour_lock (oberoende I/O); bara ref-omskrivningen är låst."""
    old_key = project_owner_key(project)
    new_key = f"team-{new_team_id}" if new_team_id is not None else str(new_owner_id or project.owner_id)
    if old_key != new_key:
        _copy_pool_media(old_key, new_key, _tour_media_names(project.slug, old_key), uploader)
        _rewrite_tour_media_key(project.slug, old_key, new_key)
    project.team_id = new_team_id
    if new_owner_id is not None:
        project.owner_id = new_owner_id
    project.move_requested_by = None
    project.move_requested_at = None
    project.checked_out_by = None  # turen byter yta -> gammalt lås irrelevant
    project.checked_out_at = None
    db.commit()
    # Kvot-cachen ser annars inte de inkopierade poolbilderna förrän TTL löpt ut.
    if old_key != new_key:
        storage.invalidate(media_svc.owner_dir(new_key))


def _team_project(db: Session, admin: User, slug: str) -> Project:
    """Hämta en tur i admins EGET team (annars 404). Super-admin når alla."""
    p = db.query(Project).filter(Project.slug == slug).first()
    if p is None or (not admin.is_admin and p.team_id != admin.team_id):
        raise HTTPException(status_code=404, detail="Projektet hittades inte")
    return p


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
    pending_moves = []
    if is_team_admin:
        origin = request_origin(request)
        for m in members:
            if m.password_hash is None:
                invite_links[m.id] = f"{origin}/accept-invite?token={make_invite_token(m.id)}"
    # Väntande utflytts-begäranden i teamet (team-admin godkänner/avslår).
    if is_team_admin and user.team_id:
        rows = db.query(Project).filter(
            Project.team_id == user.team_id, Project.move_requested_by.isnot(None)
        ).order_by(Project.move_requested_at).all()
        for p in rows:
            req = db.get(User, p.move_requested_by)
            pending_moves.append({
                "slug": p.slug, "name": p.name,
                "requester": (req.name or req.email) if req else "?",
            })
    # Senaste aktivitet i teamet: turer sorterade på senast ändrad (mtime) + vem som
    # gjorde ändringen (historik-attributionen). Enkel översikt för alla medlemmar.
    activity = []
    if user.team_id:
        import datetime as _dt

        rows = []
        for p in db.query(Project).filter(Project.team_id == user.team_id).all():
            mt = last_modified(p.slug)
            ed = history.pending_editor(project_dir(p.slug))
            rows.append({
                "name": p.name, "slug": p.slug,
                "modified": _dt.datetime.fromtimestamp(mt) if mt else None,
                "editor": (ed or {}).get("name"),
            })
        rows.sort(key=lambda r: r["modified"] or _dt.datetime.min, reverse=True)
        activity = rows[:12]
    # Lagringsanvändning mot kvot: mätare för alla medlemmar (a) + per-tur-detalj för
    # team-admin (b). Delar samma skanning som /admin/storage.
    storage_info = None
    if team:
        from app.services import storage as storage_svc

        psizes, msizes = storage_svc.project_sizes(), storage_svc.media_sizes()
        team_projects = db.query(Project).filter(Project.team_id == team.id).all()
        usage = storage_svc.team_usage_bytes([p.slug for p in team_projects], team.id, psizes, msizes)
        q = storage_svc.quota_status(usage, team.storage_quota_bytes)
        tours_detail = sorted(
            [{"name": p.name, "slug": p.slug, "bytes": psizes.get(p.slug, 0)} for p in team_projects],
            key=lambda r: r["bytes"], reverse=True)
        storage_info = {**q, "tours": tours_detail, "pool": msizes.get(f"team-{team.id}", 0),
                        "pct_bar": min(q["pct"], 100) if q["pct"] is not None else None}
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "team.html",
        {
            "team": team, "members": members, "current_user": user,
            "is_team_admin": is_team_admin, "invite_links": invite_links,
            "solo_count": solo_count, "csrf_token": token,
            "pending_moves": pending_moves, "activity": activity,
            "storage_info": storage_info,
            "platform_domain": config.PLATFORM_DOMAIN,
            "team_subdomain": (f"{team.slug}.{config.PLATFORM_DOMAIN}" if team and config.PLATFORM_DOMAIN else ""),
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


@router.post("/team/domain/request")
async def request_domain(
    request: Request,
    db: Session = Depends(get_db),
    domain: str = Form(...),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Registrera en domän som väntar på TXT-verifiering (TASK-396). Team-admin
    lägger sedan `_pano-verify.<domän>` TXT = token, verifierar via /verify."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    team = db.get(Team, admin.team_id)
    try:
        domains_svc.request_domain(db, team, domain)
    except ValueError as exc:
        return RedirectResponse(url=f"/team?domain_error={quote(str(exc))}", status_code=303)
    return RedirectResponse(url="/team?domain=requested", status_code=303)


@router.post("/team/domain/verify")
async def verify_domain(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Slå upp TXT-posten och aktivera domänen (base_url) vid match (TASK-396)."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    team = db.get(Team, admin.team_id)
    ok = domains_svc.verify_domain(db, team)
    if ok:
        result = npm.provision_domain(team.base_url)
        if result["ok"] or result["skipped"]:
            return RedirectResponse(url="/team?domain=verified", status_code=303)
        # Domänen ÄR verifierad (base_url satt) - certifikatet gick bara inte
        # att skapa automatiskt. Egen flagg så team.html kan visa en varning
        # utan att låtsas att verifieringen misslyckades.
        return RedirectResponse(
            url=f"/team?domain=verified_no_cert&domain_error={quote(result['error'] or 'Okänt fel')}",
            status_code=303,
        )
    return RedirectResponse(
        url=f"/team?domain_error={quote('Kunde inte verifiera domänen - TXT-posten hittades inte eller stämmer inte.')}",
        status_code=303,
    )


@router.post("/team/domain/clear")
async def clear_domain(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Avaktivera teamets domän (nollar base_url + ev. väntande verifiering)."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    team = db.get(Team, admin.team_id)
    host = team.base_url
    domains_svc.clear_domain(db, team)
    if host:
        # Deprovision-fel ska inte blockera clear (base_url är redan nollad) -
        # bara logga, npm.py loggar redan internt vid fel.
        npm.deprovision_domain(host)
    return RedirectResponse(url="/team?domain=cleared", status_code=303)


@router.post("/team/domain/use-subdomain")
async def use_subdomain(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Tilldela teamet plattformens subdomän-fallback (TASK-399): ingen egen
    domän behövs, ingen TXT-verifiering (vi äger plattformsdomänen). Subdomänen
    provisioneras per-host via HTTP-01 (samma väg som en kunddomän, TASK-397)
    eftersom den redan resolvar till servern - ingen wildcard-infra krävs."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    team = db.get(Team, admin.team_id)
    try:
        subdomain = domains_svc.assign_subdomain(db, team, config.PLATFORM_DOMAIN)
    except ValueError as exc:
        return RedirectResponse(url=f"/team?domain_error={quote(str(exc))}", status_code=303)
    result = npm.provision_domain(subdomain)
    if result["ok"] or result["skipped"]:
        return RedirectResponse(url="/team?domain=subdomain", status_code=303)
    # Subdomänen är satt (base_url) men certifikatet gick inte att skapa
    # automatiskt - egen flagg så mallen kan varna utan att dölja subdomänen.
    return RedirectResponse(
        url=f"/team?domain=subdomain_no_cert&domain_error={quote(result['error'] or 'Okänt fel')}",
        status_code=303,
    )


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


def delete_team_by_id(db: Session, team_id: int) -> bool:
    """Radera ett team: släpp alla medlemmar (team-lösa), radera teamets presets +
    mediapool, ta bort team-raden. BLOCKERAS (returnerar False, inget raderat) om teamet
    äger turer - vi tar aldrig bort turdata implicit. Delad av team-admins /team/delete och
    super-admins /admin/teams/{id}/delete."""
    from app.database import BrandingPreset, ThemePreset

    if db.query(Project).filter(Project.team_id == team_id).count() > 0:
        return False
    db.query(User).filter(User.team_id == team_id).update(
        {"team_id": None, "team_role": TEAM_ROLE_MEMBER}, synchronize_session=False)
    db.query(ThemePreset).filter(ThemePreset.team_id == team_id).delete(synchronize_session=False)
    db.query(BrandingPreset).filter(BrandingPreset.team_id == team_id).delete(synchronize_session=False)
    team = db.get(Team, team_id)
    if team:
        db.delete(team)
    db.commit()
    shutil.rmtree(media_svc.owner_dir(f"team-{team_id}"), ignore_errors=True)
    return True


@router.get("/teams/{team_id}/icon")
def team_icon(
    team_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Response:
    """Serverar teamets ikon (PNG). Gated: medlem i teamet eller super-admin."""
    if not (user.is_admin or user.team_id == team_id):
        raise HTTPException(status_code=404, detail="Ingen ikon")
    team = db.get(Team, team_id)
    if team is None or not team.icon:
        raise HTTPException(status_code=404, detail="Ingen ikon")
    return Response(content=team.icon, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.post("/team/icon")
async def set_team_icon(
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    file: UploadFile = File(...),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    """Team-admin sätter/byter teamets ikon (center-croppad PNG som avatarer)."""
    from app.routes.profile import _process_avatar
    from app.services.project_files import validate_image_magic, validate_size

    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    content = await file.read()
    validate_size(content, file.filename or "bild", max_mb=10)
    validate_image_magic(content, file.filename or "bild")
    try:
        team = db.get(Team, admin.team_id)
        team.icon = _process_avatar(content)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Kunde inte läsa bilden")
    db.commit()
    return {"ok": True}


@router.post("/team/icon/delete")
async def delete_team_icon(
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    """Team-admin tar bort teamets ikon (fallback: initial i fliken)."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    team = db.get(Team, admin.team_id)
    team.icon = None
    db.commit()
    return {"ok": True}


@router.post("/team/delete")
async def delete_team(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Radera teamet (team-admin). BLOCKERAS om teamet äger turer (flytta/radera dem
    först). Släpper medlemmar, raderar presets + mediapool + team-raden."""
    if admin.team_id is None:
        raise HTTPException(status_code=400, detail="Du tillhör inget team")
    if not delete_team_by_id(db, admin.team_id):
        return RedirectResponse(url="/team?err=har_turer", status_code=303)
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


@router.post("/projects/{slug}/move-workspace")
async def move_workspace(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare/team eller admin
    workspace: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Initiera en yt-flytt. IN till ett team (personlig -> team) körs DIREKT. UT ur ett
    team (team -> personlig) skapar en BEGÄRAN som team-admin godkänner - även om
    initieraren själv är team-admin (enhetligt; admin godkänner sin egen på /team)."""
    from app.routes.projects import _job_running

    target_team_id, ok = resolve_workspace(db, user, workspace)
    if not ok:
        raise HTTPException(status_code=400, detail="Ogiltig arbetsyta")
    if target_team_id == project.team_id:
        return RedirectResponse(url=f"/projects/{slug}", status_code=303)  # no-op
    if _job_running(slug):
        return RedirectResponse(
            url=f"/projects/{slug}?move_error=V%C3%A4nta+tills+tiling%2Fexport+%C3%A4r+klar",
            status_code=303,
        )
    # IN till team: direkt flytt (owner_id bevaras som skapad-av). Adderar turens
    # footprint + inkopierad media permanent till teamet -> grinda mot kvoten (M2).
    if project.team_id is None and target_team_id is not None:
        if team_over_quota(db, target_team_id):
            return RedirectResponse(url=f"/projects/{slug}?move_error={quote(QUOTA_MSG)}", status_code=303)
        try:
            _apply_move(db, project, target_team_id, None,
                        {"by": user.id, "name": user.name or user.email})
        except ValueError as exc:
            return RedirectResponse(url=f"/projects/{slug}?move_error={quote(str(exc))}", status_code=303)
        return RedirectResponse(url=f"/projects/{slug}", status_code=303)
    # UT ur team: skapa begäran (godkänns av team-admin). En annan medlems väntande
    # begäran får inte tyst skrivas över (L5).
    if project.team_id is not None and target_team_id is None:
        if project.move_requested_by is not None and project.move_requested_by != user.id:
            return RedirectResponse(
                url=f"/projects/{slug}?move_error={quote('En annan medlems flyttbegäran väntar redan.')}",
                status_code=303)
        project.move_requested_by = user.id
        project.move_requested_at = datetime.datetime.utcnow()
        db.commit()
        return RedirectResponse(url=f"/projects/{slug}?move=requested", status_code=303)
    # Mellan team är inte möjligt med single-team (användaren tillhör ett team).
    raise HTTPException(status_code=400, detail="Flytt mellan team stöds inte")


@router.post("/projects/{slug}/move-approve")
async def move_approve(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Team-admin godkänner en utflytt (team -> begärarens personliga yta). Blockeras om
    någon ANNAN håller ett färskt redigeringslås (be hen checka in först). Begäraren blir
    ny ägare; media kopieras till hens personliga pool (copy-and-leave)."""
    from app.routes.projects import _job_running

    project = _team_project(db, admin, slug)
    if project.move_requested_by is None:
        raise HTTPException(status_code=400, detail="Ingen väntande flyttbegäran")
    requester_id = project.move_requested_by
    requester = db.get(User, requester_id)
    # Begäraren måste kunna äga egna turer OCH vara aktiv (annars parkeras turen
    # under ett spärrat konto) - annars avslå i stället (L6).
    if (requester is None or not requester.active
            or not user_may_use_workspace(db, requester, str(requester_id))):
        raise HTTPException(
            status_code=400,
            detail="Begäraren kan inte längre ta emot turen - avslå begäran i stället.",
        )
    holder = checkout.current_holder(db, project)
    if holder and holder["id"] != admin.id:
        raise HTTPException(
            status_code=409,
            detail=f"Turen är utcheckad av {holder['name']} - be hen checka in först.",
        )
    # Godkännandet kan ske långt efter begäran -> kolla att inget tiling/export-jobb
    # skriver just nu (media-/manifest-omskrivningen skulle annars race:a) (N8).
    if _job_running(slug):
        raise HTTPException(status_code=409, detail="Vänta tills tiling/export är klar innan du godkänner.")
    # Atomiskt "hävda" begäran (villkorad UPDATE + rowcount) så en samtidig återkallelse
    # inte kan slinka mellan läsning och godkännande (L4, som checkout.try_acquire).
    claimed = db.execute(
        update(Project).where(Project.id == project.id, Project.move_requested_by == requester_id)
        .values(move_requested_by=None, move_requested_at=None)
    ).rowcount
    db.commit()
    if not claimed:
        raise HTTPException(status_code=409, detail="Flyttbegäran återkallades - inget att godkänna.")
    try:
        _apply_move(db, project, None, requester_id, None)
    except ValueError as exc:
        # Media-kopieringen fallerade och städade efter sig -> lägg tillbaka begäran
        # så den är kvar att försöka igen, och visa felet.
        project.move_requested_by = requester_id
        project.move_requested_at = datetime.datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=400, detail=str(exc))
    return RedirectResponse(url="/team", status_code=303)


@router.post("/projects/{slug}/move-reject")
async def move_reject(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_team_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Team-admin avslår en flyttbegäran (turen stannar i teamet)."""
    project = _team_project(db, admin, slug)
    project.move_requested_by = None
    project.move_requested_at = None
    db.commit()
    return RedirectResponse(url="/team", status_code=303)


@router.post("/projects/{slug}/move-cancel")
async def move_cancel(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Begäraren återkallar sin egen flyttbegäran."""
    if project.move_requested_by != user.id:
        raise HTTPException(status_code=403, detail="Bara begäraren kan återkalla")
    project.move_requested_by = None
    project.move_requested_at = None
    db.commit()
    return RedirectResponse(url=f"/projects/{slug}", status_code=303)
