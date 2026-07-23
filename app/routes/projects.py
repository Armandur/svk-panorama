"""Projektlista, skapa-formulär och hur-man-gör-guide."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.auth import require_user
from app.database import Project, Team, User
from app.deps import (
    get_db,
    get_editor,
    get_project_or_404,
    new_csrf_token,
    project_owner_key,
    request_origin,
    require_edit_access,
    resolve_workspace,
    set_csrf_cookie,
    templates,
    user_workspaces,
    verify_csrf_form,
    verify_csrf_header,
    visible_projects_clause,
)
from app.services.backup import forget_job as forget_backup_job
from app.services.presets import default_branding, sanitize_languages
from app.services.presets import default_config as default_preset_config
from app.services.bundle import forget_job as forget_export_job
from app.services.bundle import job_status as export_job_status
from app.services.project_files import (
    _natural_key,
    default_map,
    default_tour,
    delete_project_files,
    ensure_project_structure,
    last_modified,
    list_scenes,
    map_image_path,
    project_dir,
    read_tour,
    rename_project_files,
    slugify,
    tour_lock,
    write_map,
    write_tour,
)
from app.services import history
from app.services import settings as site_settings
from app.services import storage
from app.services.tiling import forget_job as forget_tile_job
from app.services.tiling import job_status as tile_job_status
from app.services.tiling import project_tile_state

router = APIRouter()


class LanguagesPayload(BaseModel):
    """Body för POST /projects/{slug}/languages - rör ENBART default.languages."""

    languages: list[str] = []


@router.get("/link-targets")
def link_targets(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Turer användaren kan länka en cross-tour-hotspot till (egna + teamets, designval D).
    Klienten exkluderar den aktuella turen själv."""
    rows = db.query(Project).filter(visible_projects_clause(user)).order_by(Project.name).all()
    return JSONResponse({"tours": [{"slug": p.slug, "name": p.name} for p in rows]})


@router.get("/projects/{slug}/scene-ids")
def scene_ids(
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> JSONResponse:
    """Målturens scen-id + titlar för scen-dropdownen i cross-tour-väljaren."""
    scenes = read_tour(slug).get("scenes", {})
    out = []
    for sid, s in scenes.items():
        title = s.get("title")
        if isinstance(title, dict):  # i18n -> första icke-tomma
            title = next((v for v in title.values() if v), "")
        out.append({"id": sid, "title": title or ""})
    out.sort(key=lambda x: _natural_key(x["id"]))
    return JSONResponse({"scenes": out})


@router.get("/", response_class=HTMLResponse)
def landing(request: Request) -> HTMLResponse:
    """Publik landningssida (ingen auth). Editorn bor på /editor. Inloggade ser
    samma sida men med 'Till editorn' som primär-CTA (via request.session i mallen)."""
    return templates.TemplateResponse(request, "landing.html", {})


@router.get("/editor", response_class=HTMLResponse)
def editor_home(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> HTMLResponse:
    # Egna turer + teamets turer (om användaren har team). Andras/andra teams
    # turer nås via Admin -> Användare. Team-lös -> bara egna (None-guardad).
    projects = (
        db.query(Project)
        .filter(visible_projects_clause(user))
        .order_by(Project.created_at.desc())
        .all()
    )
    tile_states = {p.slug: project_tile_state(p.slug) for p in projects}
    # Arbetsyte-flikar (vänster i /editor): UNION av användarens ytor (user_workspaces) och
    # de ytor som FAKTISKT finns bland de synliga turerna. Fällan (advisor): en tur kan höra
    # till en yta användaren saknar flik för (t.ex. can_personal=False-medlems gamla solo-tur,
    # eller en tur skapad i ett team man sedan lämnat) -> den måste ändå få en flik, annars är
    # den oåtkomlig. team_id -> namn hämtas per distinkt team bland turerna (inte antaget).
    workspaces = user_workspaces(db, user)
    tour_team_ids = {p.team_id for p in projects if p.team_id is not None}
    team_names = {t.id: t.name for t in db.query(Team).filter(Team.id.in_(tour_team_ids)).all()} \
        if tour_team_ids else {}
    ws_tabs, seen_ws = [], set()
    for w in workspaces:
        ws_tabs.append({"key": w["key"], "label": w["label"], "team_id": w["team_id"]})
        seen_ws.add(w["key"])
    for p in projects:
        # Personlig yta nycklas på ägar-id (str(owner_id)) - SAMMA nyckel som user_workspaces
        # (str(user.id)); annars blir det en dubblett "Personlig"-flik för can_personal-användare.
        # Solo-turer man ser ägs alltid av en själv (visible_projects_clause) -> owner_id == user.id.
        key = f"team-{p.team_id}" if p.team_id is not None else str(p.owner_id)
        if key not in seen_ws:
            ws_tabs.append({"key": key, "team_id": p.team_id,
                            "label": team_names.get(p.team_id, "Team") if p.team_id else "Personlig"})
            seen_ws.add(key)
    # Per tur: senast ändrad (mtime) + ändrad av (team-turer, ur historik-attributionen).
    import datetime as _dt
    stale_cutoff = _dt.datetime.utcnow() - _dt.timedelta(seconds=config.CHECKOUT_STALE_SEC)
    # Skapar-namn ("skapad av X") + namn på den som håller ett FÄRSKT redigeringslås
    # (checkout) är båda User-uppslag - samla ID:na och slå upp i EN query i stället
    # för en `checkout.current_holder`-query (db.get(User, ...)) per tur (N+1).
    other_owner_ids = {p.owner_id for p in projects if p.team_id is not None and p.owner_id != user.id}
    holder_ids = {
        p.checked_out_by for p in projects
        if p.team_id is not None and p.checked_out_by is not None
        and p.checked_out_at is not None and p.checked_out_at >= stale_cutoff
    }
    user_names = {}
    wanted_ids = other_owner_ids | holder_ids
    if wanted_ids:
        user_names = {u.id: (u.name or u.email)
                      for u in db.query(User).filter(User.id.in_(wanted_ids)).all()}
    meta = {}
    for p in projects:
        mt = last_modified(p.slug)
        editor = history.pending_editor(project_dir(p.slug)) if p.team_id is not None else None
        # Redigeringslås: vem (om någon) har turen utcheckad just nu. Replikerar
        # checkout.current_holder (bara team-turer, stale-timeout mot stale_cutoff)
        # inline mot den batchade User-uppslagningen ovan.
        holder = None
        if p.team_id is not None and p.checked_out_by is not None \
                and p.checked_out_at is not None and p.checked_out_at >= stale_cutoff:
            holder = {"id": p.checked_out_by, "name": user_names.get(p.checked_out_by, "?")}
        # Kort-vyns tumnagel: turens första scen (preview, snurrbar vid hover) ->
        # kartbild -> tom. first_scene = None om ingen scen.
        tour = read_tour(p.slug)
        first_scene = (tour.get("default", {}) or {}).get("firstScene") or None
        if first_scene and first_scene not in (tour.get("scenes") or {}):
            first_scene = None
        has_map = map_image_path(p.slug).exists()
        if first_scene:
            thumb = f"/projects/{p.slug}/previews/{first_scene}.jpg"
        elif has_map:
            thumb = f"/projects/{p.slug}/map.png"
        else:
            thumb = None
        meta[p.slug] = {
            "modified": _dt.datetime.fromtimestamp(mt) if mt else None,
            "editor": (editor or {}).get("name"),
            "first_scene": first_scene,
            "thumb": thumb,
            # bara andras team-turer
            "creator": user_names.get(p.owner_id) if p.team_id is not None and p.owner_id != user.id else None,
            "locked_by": holder["name"] if holder else None,
            "locked_by_me": bool(holder and holder["id"] == user.id),
        }
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "index.html",
        {
            "projects": projects,
            "tile_states": tile_states,
            "project_meta": meta,
            "current_user": user,
            "csrf_token": token,
            "guide_text": site_settings.get_workflow_text(),
            "workspaces": workspaces,
            "ws_tabs": ws_tabs,
            "team_name": (db.get(Team, user.team_id).name if user.team_id else None),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects")
async def create_project(
    request: Request,
    db: Session = Depends(get_db),
    name: str = Form(...),
    scope: str = Form(None),
    user: User = Depends(require_user),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Namn krävs")

    # Yta (arbetsyte-modellen): team-tur eller personlig. scope=None -> default (teamet
    # om medlem, annars personlig). Ogiltig/otillåten yta avvisas (t.ex. personlig när
    # can_personal=False) - lita aldrig på klientens värde.
    team_id, ok = resolve_workspace(db, user, scope)
    if not ok:
        raise HTTPException(status_code=400, detail="Ogiltig arbetsyta")

    # Unik slug: den läs-sedan-skriv-kollen nedan är bara en snabb gissning, inte
    # garantin - två samtidiga POST med samma namn kan båda passera den och krocka
    # på UNIK-constrainten. IntegrityError-retryn nedan är den faktiska garantin:
    # vid krock rullas sessionen tillbaka (det gamla Project-objektet är då ogiltigt
    # -> ett NYTT skapas) och nästa lediga slug söks upp igen.
    base_slug = slugify(name)
    suffix = 2
    slug = base_slug
    for _attempt in range(5):
        while db.query(Project).filter(Project.slug == slug).first() is not None:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        # owner_id bevaras alltid som "skapad av"; team_id avgör ytan (None = personlig).
        project = Project(slug=slug, name=name, owner_id=user.id, team_id=team_id)
        db.add(project)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            suffix += 1
            slug = f"{base_slug}-{suffix}"
    else:
        raise HTTPException(status_code=409, detail="Kunde inte skapa turen, försök igen")

    ensure_project_structure(slug)
    tour = default_tour()
    # Ny tur ärver standard-förinställningarna i TURENS yta (team_id) - en personlig
    # tur ärver personliga presets, en team-tur teamets. Tema + branding var för sig.
    preset = default_preset_config(db, user.id, team_id)
    if preset:
        tour.setdefault("default", {}).update(preset)
    brand = default_branding(db, user.id, team_id)
    if brand:
        tour.setdefault("default", {})["branding"] = brand
    write_tour(slug, tour, editor=editor)
    write_map(slug, default_map(), editor=editor)

    return RedirectResponse(url=f"/projects/{slug}", status_code=302)


@router.post("/projects/{slug}/delete")
async def delete_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Radera en hel tur: DB-rad + projektmappen + ev. in-memory-jobb."""
    owner_id = project.owner_id
    acted_on_other = user.is_admin and owner_id != user.id

    db.delete(project)
    db.commit()

    forget_tile_job(slug)
    forget_export_job(slug)
    forget_backup_job(slug)
    delete_project_files(slug)
    storage.invalidate(project_dir(slug))  # frigör kvot-utrymme direkt (cachen släppte annars i TTL)

    # Admin som raderar en annans tur -> tillbaka till den användarens turlista.
    dest = f"/admin/users/{owner_id}/projects" if acted_on_other else "/editor"
    return RedirectResponse(url=dest, status_code=303)


def _share_url(request: Request, token: str) -> str:
    return f"{request_origin(request)}/s/{token}"


def _wants_json(request: Request) -> bool:
    return "application/json" in request.headers.get("accept", "")


@router.post("/projects/{slug}/share")
async def share_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    _csrf: None = Depends(verify_csrf_form),
):
    """Aktivera publik delning: skapa en oigissbar token om ingen finns. JS-anrop
    (Accept: application/json) får länken tillbaka och uppdaterar rutan utan omladdning;
    vanlig formulärpost (utan JS) faller tillbaka på redirect."""
    if not project.share_token:
        project.share_token = secrets.token_urlsafe(16)
        db.commit()
    if _wants_json(request):
        return JSONResponse({"share_url": _share_url(request, project.share_token)})
    return RedirectResponse(url=f"/projects/{slug}/preview", status_code=303)


@router.post("/projects/{slug}/unshare")
async def unshare_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_form),
):
    """Sluta dela: nolla token -> gamla /s/{token}-länken slutar fungera direkt."""
    project.share_token = None
    db.commit()
    if _wants_json(request):
        return JSONResponse({"share_url": None})
    return RedirectResponse(url=f"/projects/{slug}/preview", status_code=303)


@router.post("/projects/{slug}/rename")
async def rename_project(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    name: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Byt turens visningsnamn (påverkar inte slug/adress)."""
    name = name.strip()
    if name:
        project.name = name
        db.commit()
    return RedirectResponse(url=f"/projects/{slug}", status_code=303)


def _job_running(slug: str) -> bool:
    for status in (tile_job_status(slug), export_job_status(slug)):
        if status and status.get("status") == "running":
            return True
    return False


@router.post("/projects/{slug}/rename-slug")
async def rename_slug(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),  # gate: ägare eller admin
    new_slug: str = Form(...),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Byt turens slug: mappnamn + DB-rad + glöm jobb på gamla slugen. Bokmärkta
    /view-länkar och redan byggda bundlar bryts - varnas för i UI:t."""
    new_slug = slugify(new_slug)
    if new_slug == slug:
        return RedirectResponse(url=f"/projects/{slug}", status_code=303)
    if db.query(Project).filter(Project.slug == new_slug).first() is not None:
        return RedirectResponse(
            url=f"/projects/{slug}?slug_error=Slugen+%C3%A4r+upptagen", status_code=303
        )
    if _job_running(slug):
        return RedirectResponse(
            url=f"/projects/{slug}?slug_error=V%C3%A4nta+tills+tiling%2Fexport+%C3%A4r+klar",
            status_code=303,
        )

    rename_project_files(slug, new_slug)  # flyttar mappen (guardad)
    project.slug = new_slug
    db.commit()
    forget_tile_job(slug)  # in-memory-status nycklad på gamla slugen
    forget_export_job(slug)
    forget_backup_job(slug)
    storage.invalidate(project_dir(slug))      # gamla mappens stale cache-nyckel
    storage.invalidate(project_dir(new_slug))  # nya mappens storlek räknas färskt
    return RedirectResponse(url=f"/projects/{new_slug}", status_code=303)


@router.get("/projects/{slug}", response_class=HTMLResponse)
def project_home(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
    project: Project = Depends(get_project_or_404),
) -> HTMLResponse:
    """Steg 1: ladda upp bilder + karta och hantera scenlistan."""
    scenes = list_scenes(slug)
    tiling_done = project_tile_state(slug).get("status") == "done"
    tour = read_tour(slug)
    token = new_csrf_token()
    # Flytt mellan ytor: dropdown över användarens ytor (bara vid >1), samt status för
    # en ev. väntande utflytts-begäran (team -> personlig, godkänns av team-admin).
    workspaces = user_workspaces(db, user)
    move_requester = db.get(User, project.move_requested_by) if project.move_requested_by else None
    response = templates.TemplateResponse(
        request,
        "upload.html",
        {
            "project": project,
            "scenes": scenes,
            "tiling_done": tiling_done,
            "has_map_image": map_image_path(slug).exists(),
            "csrf_token": token,
            "slug_error": request.query_params.get("slug_error"),
            "move_error": request.query_params.get("move_error"),
            "languages": tour.get("default", {}).get("languages") or ["sv"],
            "is_multilingual": len(tour.get("default", {}).get("languages") or []) > 1,
            "workspaces": workspaces,
            "current_ws_key": project_owner_key(project),
            "move_requester": move_requester,
            "move_is_mine": project.move_requested_by == user.id,
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/projects/{slug}/languages")
def save_languages(
    slug: str,
    payload: LanguagesPayload,
    project: Project = Depends(require_edit_access),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_header),
) -> dict:
    """Spara ENBART turens språkval (uppladdningssteget) - rör inget annat
    fält i default-blocket."""
    with tour_lock:
        tour = read_tour(slug)
        default = tour.setdefault("default", {})
        default["languages"] = sanitize_languages(payload.languages)
        write_tour(slug, tour, editor=editor)
    return {"ok": True}
