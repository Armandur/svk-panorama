"""Multires-tiling som async-jobb: starta tiling och polla status."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_user
from app.database import Project, User, get_db
from app.deps import QUOTA_MSG, get_project_or_404, team_over_quota, verify_csrf_header, visible_projects_clause
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
    db: Session = Depends(get_db),
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_header),
) -> dict[str, Any]:
    # Tiling genererar kakel (växer lagringen) -> blockera team-turer över kvot.
    if team_over_quota(db, project.team_id):
        raise HTTPException(status_code=409, detail=QUOTA_MSG)
    tiling.start_job(slug)
    return _state(slug)


@router.get("/projects/{slug}/tile-job/status")
def tile_job_status(
    slug: str,
    project: Project = Depends(get_project_or_404),
) -> dict[str, Any]:
    return _state(slug)


@router.get("/tile-jobs")
def tile_jobs(
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> dict[str, Any]:
    """Bulk-status för in-memory-jobb (billig, för live-polling på listan och
    hemsidan). Bara användarens egna turer (admin ser alla)."""
    jobs = tiling.all_jobs()
    # Bara turer användaren ser i sin lista (egna + teamets) - matchar editor_home.
    owned = {slug for (slug,) in db.query(Project.slug).filter(visible_projects_clause(user)).all()}
    return {
        slug: {"status": j["status"], "done": j["done"], "total": j["total"]}
        for slug, j in jobs.items()
        if slug in owned
    }
