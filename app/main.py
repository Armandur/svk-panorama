"""App-uppstart: FastAPI-instans, lifespan, statiska mounts, routrar."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.staticfiles import StaticFiles

from app import config
from app.database import init_db
from app.routes import export, plan, preview, previews, projects, scenes, tiling, uploads, viewer


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="SVK Panorama", lifespan=lifespan)


@app.middleware("http")
async def no_cache_static(request, call_next):
    """Statiska CSS/JS ska alltid revalideras så att ändringar syns utan
    hård-uppdatering (lokalt utvecklingsverktyg)."""
    response = await call_next(request)
    if request.url.path.startswith(("/static", "/js")):
        response.headers["Cache-Control"] = "no-cache"
    return response


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
