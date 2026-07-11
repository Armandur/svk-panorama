"""Multires-tiling som async-jobb: starta tiling och polla status."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.database import Project
from app.deps import get_project_or_404, verify_csrf_header
from app.services import tiling

router = APIRouter()


def _state(slug: str) -> dict[str, Any]:
    """Nuläge: pågående/klart jobb + hur många scener som redan har tiles."""
    job = tiling.job_status(slug)
    manifest = tiling.read_manifest(slug)
    return {
        "job": job,
        "tiled": len(manifest),
        "tileable": len(tiling.tileable_scenes(slug)),
    }


@router.post("/projects/{slug}/tile-job")
def start_tile_job(
    slug: str,
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> dict[str, Any]:
    tiling.start_job(slug)
    return _state(slug)


@router.get("/projects/{slug}/tile-job/status")
def tile_job_status(
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> dict[str, Any]:
    return _state(slug)
