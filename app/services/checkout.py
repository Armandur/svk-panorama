"""Redigeringslås (check-out/check-in) för TEAM-turer.

När en teammedlem redigerar en tur checkas den ut -> andra kan bara titta. Skydd
mot att två medlemmar skriver över varandra (sista-skrivning-vinner). Solo-turer
(team_id NULL, en enda åtkomst) låses inte.

**Atomärt lås:** acquire är EN villkorad UPDATE + rowcount-koll - aldrig
läs-sedan-skriv i Python (då kan två samtidiga acquire båda "se fritt" och båda
vinna). Stale-timeout (`CHECKOUT_STALE_SEC`) släpper ett övergivet lås (klient som
slutade skicka heartbeat). Alla tidsstämplar är naiva UTC (`datetime.utcnow`),
samma klocka som created_at - blanda aldrig in lokal tid i stale-jämförelsen."""
from __future__ import annotations

import datetime
from typing import Any

from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from app import config
from app.database import Project, User


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


def _stale_cutoff() -> datetime.datetime:
    return _now() - datetime.timedelta(seconds=config.CHECKOUT_STALE_SEC)


def try_acquire(db: Session, project_id: int, user_id: int) -> bool:
    """Ta eller förnya låset ATOMÄRT om det är fritt, redan mitt, eller stale.
    Returnerar True om jag håller det efteråt. rowcount==1 = jag vann."""
    stmt = (
        update(Project)
        .where(Project.id == project_id)
        .where(or_(
            Project.checked_out_by.is_(None),
            Project.checked_out_by == user_id,
            Project.checked_out_at < _stale_cutoff(),
        ))
        .values(checked_out_by=user_id, checked_out_at=_now())
    )
    res = db.execute(stmt)
    db.commit()
    return res.rowcount == 1


def release(db: Session, project_id: int, user_id: int, *, force: bool = False) -> bool:
    """Släpp låset. Utan force bara om jag håller det; med force oavsett (team-admin/
    super-admin tvingar incheck). Returnerar True om något släpptes."""
    stmt = update(Project).where(Project.id == project_id)
    if not force:
        stmt = stmt.where(Project.checked_out_by == user_id)
    res = db.execute(stmt.values(checked_out_by=None, checked_out_at=None))
    db.commit()
    return res.rowcount == 1


def holds_fresh(project: Project, user_id: int) -> bool:
    """Håller `user_id` ett FÄRSKT (ej stale) lås på turen? Skriv-guarden kräver
    detta - en skrivning tillåts BARA om skrivaren håller låset."""
    return (
        project.checked_out_by == user_id
        and project.checked_out_at is not None
        and project.checked_out_at >= _stale_cutoff()
    )


def current_holder(db: Session, project: Project) -> dict[str, Any] | None:
    """{id, name} för den som håller ett FÄRSKT lås, annars None (fritt/stale)."""
    if project.checked_out_by is None or project.checked_out_at is None:
        return None
    if project.checked_out_at < _stale_cutoff():
        return None
    u = db.get(User, project.checked_out_by)
    return {"id": project.checked_out_by, "name": (u.name or u.email) if u else "?"}
