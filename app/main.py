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
    auth,
    export,
    plan,
    preview,
    previews,
    projects,
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
    if exc.status_code == 401 and wants_html:
        return RedirectResponse(url=f"/login?next={request.url.path}", status_code=303)
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
app.include_router(projects.router)
app.include_router(uploads.router)
app.include_router(plan.router)
app.include_router(previews.router)
app.include_router(scenes.router)
app.include_router(tiling.router)
app.include_router(preview.router)
app.include_router(export.router)
app.include_router(viewer.router)

# Egen statik (CSS/JS för editorn).
app.mount("/static", StaticFiles(directory=str(config.REPO_ROOT / "app" / "static")), name="static")

# Repo-rotens js/ - återanvänds av senare steg (geo.js m.fl.).
app.mount("/js", StaticFiles(directory=str(config.REPO_ROOT / "js")), name="repo-js")

# Projektfiler (panoraman + kartbild) - måste finnas innan mount vid uppstart.
config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/projects", StaticFiles(directory=str(config.PROJECTS_DIR)), name="projects")
