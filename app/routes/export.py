"""Bundle-export: starta bygge, polla status, ladda ner zipen."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.database import Project
from app.deps import get_project_or_404, verify_csrf_header
from app.services import bundle

router = APIRouter()


@router.post("/projects/{slug}/export")
def start_export(
    slug: str,
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> dict[str, Any]:
    bundle.start_job(slug, project.name)
    return bundle.state(slug)


@router.get("/projects/{slug}/export/status")
def export_status(
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> dict[str, Any]:
    return bundle.state(slug)


@router.get("/projects/{slug}/export/download")
def export_download(
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> FileResponse:
    path = bundle.zip_path(slug)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Ingen bundle byggd ännu")
    return FileResponse(path, media_type="application/zip", filename=f"{slug}.zip")
