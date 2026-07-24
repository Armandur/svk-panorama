"""App-uppstart: FastAPI-instans, lifespan, statiska mounts, routrar."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app import config, deps
from app.database import SessionLocal, init_db

logger = logging.getLogger(__name__)
from app.routes import (
    admin,
    assets,
    auth,
    backup,
    checkout,
    demo,
    export,
    history,
    media,
    plan,
    presets,
    preview,
    previews,
    profile,
    projects,
    public,
    scenes,
    teams,
    theme,
    tiling,
    translate,
    uploads,
    viewer,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Global backstop mot dekomprimeringsbomber i ALLA PIL-vägar (tiling, previews,
    # import) utöver upload-validerarna. PIL varnar över detta och kastar över 2x.
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = config.MAX_IMAGE_MEGAPIXELS * 1_000_000
    init_db()
    yield


app = FastAPI(title="SVK Panorama", lifespan=lifespan)


@app.middleware("http")
async def resolve_tenant(request: Request, call_next):
    """Host-baserad tenant-resolution (Fas 4.3): slår upp request-Host mot ett
    Team (Team.base_url) och sätter request.state.team - läs via deps.current_team.
    Noll-team-invariant: inget Team.base_url matchar (dagens normalfall, alla
    base_url NULL) -> team=None, beteendet oförändrat. Hoppar DB-slagningen för
    statiska tillgångar (undviker en DB-hit per CSS/JS-request). Tillagd FÖRE
    SessionMiddleware/ProxyHeadersMiddleware nedan -> hamnar innerst (Starlette
    wrappar sist tillagd ytterst) -> kör EFTER dem, precis före routrarna."""
    request.state.team = None
    if not request.url.path.startswith(("/static", "/js")):
        host = deps._normalize_host(request.url.hostname)
        if host:
            db = SessionLocal()
            try:
                request.state.team = deps.team_for_host(db, host)
            except Exception:
                logger.exception("Tenant-uppslag mot Host misslyckades (host=%s)", host)
                request.state.team = None
            finally:
                db.close()
    return await call_next(request)


# Signerad session-cookie (bär bara användarens id).
app.add_middleware(SessionMiddleware, secret_key=config.SECRET_KEY, same_site="lax")

# Bakom en TLS-terminerande reverse proxy (NPM/Caddy) rättar denna request.scope
# ["scheme"] + klient-IP ur X-Forwarded-Proto/-For INNAN routrar/deps.request_origin
# läser request.url/base_url - annars blir OG-taggar/delningslänkar http. Tillagd
# SIST -> sitter ytterst av user-middlewaren (Starlette wrappar sist tillagd ytterst),
# så korrigeringen sker före allt annat. trusted_hosts (config.TRUSTED_PROXIES)
# begränsar vilka avsändar-IP:er headern litas på (aldrig "*" i drift).
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=config.TRUSTED_PROXIES)


@app.exception_handler(StarletteHTTPException)
async def _auth_aware_http_exception(request: Request, exc: StarletteHTTPException):
    """401 på en sid-navigering -> skicka till /login (med next). Övriga fel och
    API-anrop (JSON) får vanligt JSON-svar."""
    wants_html = "text/html" in request.headers.get("accept", "")
    if wants_html and exc.status_code == 401:
        return RedirectResponse(url=f"/login?next={request.url.path}", status_code=303)
    if wants_html and exc.status_code == 403:
        # T.ex. en nyligen degraderad admin som klickar Admin - skicka hem
        # i stället för en rå felsida (nav-knappen synkas bort nästa request).
        return RedirectResponse(url="/", status_code=303)
    if wants_html:
        # Vänlig felsida för sid-navigeringar (404 m.fl.) i stället för rå JSON.
        from app.deps import templates as _templates

        messages = {
            404: "Sidan eller resursen hittades inte.",
            400: "Något med förfrågan var fel.",
            409: "Åtgärden krockade med rådande läge.",
        }
        return _templates.TemplateResponse(
            request,
            "error.html",
            {"code": exc.status_code, "message": messages.get(exc.status_code, exc.detail or "Ett fel inträffade.")},
            status_code=exc.status_code,
        )
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.middleware("http")
async def no_cache_static(request, call_next):
    """Statiska CSS/JS ska alltid revalideras så att ändringar syns utan
    hård-uppdatering (lokalt utvecklingsverktyg)."""
    response = await call_next(request)
    if request.url.path.startswith(("/static", "/js")):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(demo.router)
app.include_router(profile.router)
app.include_router(teams.router)
app.include_router(projects.router)
app.include_router(presets.router)
app.include_router(uploads.router)
app.include_router(plan.router)
app.include_router(previews.router)
app.include_router(scenes.router)
app.include_router(tiling.router)
app.include_router(preview.router)
app.include_router(translate.router)
app.include_router(history.router)
app.include_router(checkout.router)
app.include_router(export.router)
app.include_router(backup.router)
app.include_router(viewer.router)
app.include_router(public.router)
app.include_router(media.router)  # delad mediepool (före assets-catchall)
app.include_router(theme.router)
# SIST: catch-all för råa projektfiler (ägar-koll). Måste ligga efter alla
# specifika /projects/{slug}/...-routes så de matchar först.
app.include_router(assets.router)

# Egen statik (CSS/JS för editorn) - öppen, inget känsligt.
app.mount("/static", StaticFiles(directory=str(config.REPO_ROOT / "app" / "static")), name="static")

# Repo-rotens js/ - återanvänds av editorn (geo.js m.fl.).
app.mount("/js", StaticFiles(directory=str(config.REPO_ROOT / "js")), name="repo-js")

config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
