"""App-uppstart: FastAPI-instans, lifespan, statiska mounts, routrar."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles

from app import config
from app.database import init_db
from app.routes import (
    admin,
    assets,
    auth,
    export,
    plan,
    preview,
    previews,
    profile,
    projects,
    public,
    scenes,
    tiling,
    uploads,
    viewer,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="SVK Panorama", lifespan=lifespan)

# Signerad session-cookie (bär bara användarens id).
app.add_middleware(SessionMiddleware, secret_key=config.SECRET_KEY, same_site="lax")


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
app.include_router(profile.router)
app.include_router(projects.router)
app.include_router(uploads.router)
app.include_router(plan.router)
app.include_router(previews.router)
app.include_router(scenes.router)
app.include_router(tiling.router)
app.include_router(preview.router)
app.include_router(export.router)
app.include_router(viewer.router)
app.include_router(public.router)
# SIST: catch-all för råa projektfiler (ägar-koll). Måste ligga efter alla
# specifika /projects/{slug}/...-routes så de matchar först.
app.include_router(assets.router)

# Egen statik (CSS/JS för editorn) - öppen, inget känsligt.
app.mount("/static", StaticFiles(directory=str(config.REPO_ROOT / "app" / "static")), name="static")

# Repo-rotens js/ - återanvänds av editorn (geo.js m.fl.).
app.mount("/js", StaticFiles(directory=str(config.REPO_ROOT / "js")), name="repo-js")

config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
