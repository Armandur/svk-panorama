"""Projekt-backup: exportera en redigerbar tur som zip och importera den som ett
nytt projekt. Se services/backup.py för arkivformatet."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from app.auth import require_user
from app.database import Project, User, get_db
from app.deps import get_project_or_404, verify_csrf_header
from app.services import backup

router = APIRouter()


@router.post("/projects/{slug}/backup")
def start_backup(
    slug: str,
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> dict[str, Any]:
    backup.start_export(slug, project.name)
    return backup.state(slug)


@router.get("/projects/{slug}/backup/status")
def backup_status(
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> dict[str, Any]:
    return backup.state(slug)


@router.get("/projects/{slug}/backup/download")
def backup_download(
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> FileResponse:
    path = backup.zip_path(slug)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Ingen backup byggd ännu")
    return FileResponse(path, media_type="application/zip", filename=f"{slug}-projekt.zip")


@router.post("/projects/import")
async def import_backup(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_header),
) -> JSONResponse:
    """Importera ett projektarkiv (zip) som ett nytt projekt ägt av användaren."""
    tmp = Path(tempfile.mkstemp(suffix=".zip")[1])
    try:
        cap = backup.MAX_BACKUP_MB * 1024 * 1024
        size = 0
        with open(tmp, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > cap:
                    raise HTTPException(status_code=413, detail=f"Arkivet är för stort (max {backup.MAX_BACKUP_MB} MB).")
                out.write(chunk)
        try:
            project = backup.import_project(tmp, user, db)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return JSONResponse({"slug": project.slug, "name": project.name})
    finally:
        tmp.unlink(missing_ok=True)
