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

# Tjänstenamnet (super-admin-konfigurerbart) exponeras till alla mallar.
from app.services import settings as _settings  # noqa: E402 (undvik cirkel vid import-tid)

templates.env.globals["site_name"] = _settings.get_site_name
# Mediepoolens storleksgräns (MB) exponeras så UI:t kan visa den + förvalidera.
# Callable (inte fryst import-tid-värde) så super-admins DB-override syns direkt.
templates.env.globals["media_max_mb"] = lambda: _settings.get_int("max_map_mb")
# Läsbar byte-formattering (diskanvändning i admin-vyer).
from app.services import storage as _storage  # noqa: E402

templates.env.globals["human_size"] = _storage.human_size

CSRF_COOKIE_NAME = "csrf_token"

__all__ = ["get_db", "templates", "CSRF_COOKIE_NAME", "request_origin"]  # get_db re-exporteras här


# --- Host-baserad tenant-resolution (Fas 4.3) -----------------------------
# Publicerade turer ska kunna servas på ett teams egen domän (Team.base_url).
# Middleware i app/main.py slår upp request-Host mot ett Team och sätter
# request.state.team - noll-team-invariant: matchar inget (dagens normalfall,
# alla base_url NULL) -> team=None, beteendet oförändrat.


def _normalize_host(value: str | None) -> str:
    """Normaliserar en host för jämförelse: ta bort ev. scheme, lowercase,
    ta bort port och trailing slash/path. Används på BÅDE request-Host och
    lagrad Team.base_url innan jämförelse så de är jämförbara oavsett hur
    base_url skrevs in (med/utan schema, versaler, trailing slash)."""
    if not value:
        return ""
    host = value.strip().lower()
    if "://" in host:
        host = host.split("://", 1)[1]
    host = host.split("/", 1)[0]  # trailing path
    host = host.rsplit(":", 1)[0] if host.count(":") == 1 else host  # port (inte IPv6)
    return host


def team_for_host(db: Session, host: str | None):
    """Team vars base_url matchar host (normaliserat, case-/schema-okänsligt),
    annars None. Litet table -> laddar kandidater (icke-tom base_url) och
    matchar i Python i stället för SQL-normalisering."""
    from app.database import Team

    normalized = _normalize_host(host)
    if not normalized:
        return None
    candidates = db.query(Team).filter(Team.base_url.isnot(None), Team.base_url != "").all()
    for team in candidates:
        if _normalize_host(team.base_url) == normalized:
            return team
    return None


def current_team(request: Request):
    """Läser teamet som tenant-middlewaren slog upp ur Host-headern (Fas 4.3).
    None = ingen tenant-domän matchade (dagens normalfall)."""
    return getattr(request.state, "team", None)


def request_origin(request: Request) -> str:
    """Absolut origin (schema + host, utan avslutande /) för externa länkar:
    delningslänkar, OG-taggar, inbjudningslänkar. `SVK_BASE_URL` vinner om satt,
    annars härleds den ur requesten (Host + schema).

    SINGLE SEAM (Fas 4): när team kör på egna domäner ska detta bli per-team
    (`Team.base_url`) - byt HÄR så alla call sites följer med. Se ROADMAP
    "OG + absoluta URL:er i multi-tenant". Bakom reverse proxy (Caddy) krävs
    proxy-headers (`--proxy-headers` + X-Forwarded-Proto/Host) för att
    `request.base_url` ska ge korrekt https-schema och tenant-host."""
    return config.BASE_URL or str(request.base_url).rstrip("/")


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


def get_editor(user: User = Depends(require_user)) -> dict:
    """Attribution för versionshistoriken: vem som gör det aktuella sparet. Läser
    den autentiserade User:n (inte sessionen) - namnet snapshottas som det var vid
    spar-tid. Skickas som `editor=` till write_tour/write_map."""
    return {"by": user.id, "name": user.name or user.email}


def resource_owner_key(user: User) -> str:
    """Ägar-nyckel för delade resurser (mediepool). Se User.owner_key - en
    sanningskälla (team-<id> för team, annars <user_id>)."""
    return user.owner_key


def project_owner_key(project: Project) -> str:
    """Ytans mediapool-nyckel för en TUR: team-<id> för team-tur, annars ägarens
    personliga <owner_id>. Media följer turens yta (arbetsyte-modellen), inte
    användarens primära pool."""
    return f"team-{project.team_id}" if project.team_id is not None else str(project.owner_id)


QUOTA_MSG = "Teamet är över sin lagringskvot. Ta bort material eller be en admin höja kvoten."


def team_over_quota(db: Session, team_id: int | None) -> bool:
    """Hård kvot-grind: True om teamet ligger ÖVER sin lagringskvot (blockerar content-
    adderande åtgärder). None-team eller ingen kvot -> False. Läser SAMMA cachade skanning
    som mätaren -> färsk inom `SVK_STORAGE_CACHE_TTL`; write-vägarna invaliderar cachen så
    en radering frigör direkt. Grindar på TEAM (inte aktör) - även super-admins uppladdning
    i en team-tur växer teamets footprint."""
    if team_id is None:
        return False
    from app.database import Team
    from app.services import storage

    team = db.get(Team, team_id)
    if team is None or not team.storage_quota_bytes:
        return False
    slugs = [p.slug for p in db.query(Project).filter(Project.team_id == team_id).all()]
    # team_usage_direct summerar bara teamets egna mappar (per-mapp-cachade) i stället
    # för att skanna hela serverns storlekskarta vid varje grind-anrop (L8).
    usage = storage.team_usage_direct(slugs, team_id)
    return usage > team.storage_quota_bytes


def user_workspaces(db: Session, user: User) -> list[dict]:
    """Ytor användaren kan skapa turer i (och har egen mediapool för). Teamet först
    (=default vid skapande), sedan Personlig om tillåten. Single-team nu; listan
    växer vid multi-team. Varje: {key, scope: team|personal, label, team_id}."""
    out: list[dict] = []
    if user.team_id is not None:
        from app.database import Team

        team = db.get(Team, user.team_id)
        out.append({"key": f"team-{user.team_id}", "scope": "team",
                    "label": team.name if team else "Team", "team_id": user.team_id})
    if user.can_personal or user.team_id is None:
        out.append({"key": str(user.id), "scope": "personal", "label": "Personlig", "team_id": None})
    return out


def user_may_use_workspace(db: Session, user: User, key: str) -> bool:
    """Får användaren använda ytans mediapool (personlig eller teamets)? Validerar
    mot user_workspaces - en team-medlem utan can_personal når t.ex. inte sin
    personliga pool."""
    return any(w["key"] == key for w in user_workspaces(db, user))


def resolve_workspace(db: Session, user: User, key: str | None) -> tuple[int | None, bool]:
    """Mappa en vald ytanyckel -> (team_id, ok). team_id=None = personlig tur.
    ok=False om nyckeln inte är en av användarens tillåtna ytor. key=None -> första
    (default) ytan. Validerar mot user_workspaces (aldrig lita på klientens värde)."""
    workspaces = user_workspaces(db, user)
    if not workspaces:
        return (None, True)  # ingen yta (edge) -> personlig fallback
    if key is None:
        return (workspaces[0]["team_id"], True)
    for w in workspaces:
        if w["key"] == key:
            return (w["team_id"], True)
    return (None, False)


def visible_projects_clause(user: User):
    """SQLAlchemy-villkor för turer en användare SER i sina listor: sina egna
    (owner_id) + (om hen har team) teamets turer. FÄLLA (verifierad SQLAlchemy
    2.0.51): `Project.team_id == user.team_id` när user.team_id is None kompilerar
    till `team_id IS NULL` -> skulle returnera ALLA team-lösa turer i systemet
    (cross-user-läcka). Bygg därför team-klausulen BARA när user.team_id is not
    None. (Admin ser också bara egna+team här; hela systemet nås via admin-vyn.)"""
    from sqlalchemy import or_

    own = Project.owner_id == user.id
    if user.team_id is not None:
        return or_(own, Project.team_id == user.team_id)
    return own


def user_can_access_project(user: User, project: Project) -> bool:
    """Fas 4 3-vägs-ägarskap: super-admin ser allt; en team-tur nås av teamets
    medlemmar (team_id-match); en team-lös tur nås av sin ägare. Symmetriskt
    None-säkert - en team-lös användare (team_id None) matchar ALDRIG en team-tur,
    och en team-tur kräver att BÅDA team_id är satta och lika."""
    if user.is_admin:
        return True
    if project.team_id is not None:
        return project.team_id == user.team_id
    return project.owner_id == user.id


def get_project_or_404(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Project:
    """Kräver inloggning och att projektet ägs av användaren/teamet (eller admin).
    Returnerar 404 även vid fel ägare - läck inte att slugen finns."""
    project = db.query(Project).filter(Project.slug == slug).first()
    if project is None or not user_can_access_project(user, project):
        raise HTTPException(status_code=404, detail="Projektet hittades inte")
    return project


def require_edit_access(
    project: Project = Depends(get_project_or_404),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> Project:
    """Skriv-guard för redigeringslåset: en TEAM-turs skrivning tillåts BARA om
    skrivaren HÅLLER ett färskt lås (inte bara "ingen annan håller det") - annars
    409. Solo-turer (team_id NULL) låses inte. Läggs på alla muterande edit-routes."""
    from app.services import checkout

    if project.team_id is None:
        return project
    if checkout.holds_fresh(project, user.id):
        return project
    holder = checkout.current_holder(db, project)
    if holder:
        raise HTTPException(status_code=409, detail=f"Turen är utcheckad av {holder['name']}")
    raise HTTPException(status_code=409, detail="Checka ut turen innan du redigerar")
