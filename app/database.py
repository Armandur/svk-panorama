"""Projekt-index i SQLite. Endast metadata - geometri lagras i JSON-filer
i projektmappen (se app/services/project_files.py)."""
from __future__ import annotations

import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app import config


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    # Null tills en inbjuden användare satt sitt lösenord (sluten inbjudan).
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    # Ägare (multi-tenant). Nullable för bakåtkompatibilitet med tidiga projekt
    # som backfillas till bootstrap-admin.
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


engine = create_engine(
    config.DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    _run_migrations()
    _bootstrap_admin()


def _run_migrations() -> None:
    """Kör Alembic-migrationer till head. Adopterar en pre-Alembic-DB (bara
    `projects`, ingen alembic_version) genom att stampa baslinjen först."""
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect

    cfg = Config(str(config.REPO_ROOT / "alembic.ini"))
    tables = inspect(engine).get_table_names()
    if "projects" in tables and "alembic_version" not in tables:
        command.stamp(cfg, "0001_initial")
    command.upgrade(cfg, "head")


def _bootstrap_admin() -> None:
    """Skapa bootstrap-admin ur env om inga användare finns (sluten inbjudan),
    och backfilla ägarlösa projekt till den."""
    if not config.ADMIN_EMAIL or not config.ADMIN_PASSWORD:
        return
    from app.auth import hash_password

    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return
        admin = User(
            email=config.ADMIN_EMAIL,
            password_hash=hash_password(config.ADMIN_PASSWORD),
            is_admin=True,
        )
        db.add(admin)
        db.commit()
        db.query(Project).filter(Project.owner_id.is_(None)).update({"owner_id": admin.id})
        db.commit()
    finally:
        db.close()


def get_session() -> Session:
    return SessionLocal()


def get_db():
    """FastAPI-dependency: DB-session per request. Bor här (inte i deps) så både
    deps och auth kan importera utan cirkulär import; re-exporteras från deps."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
