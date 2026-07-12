"""Projekt-index i SQLite. Endast metadata - geometri lagras i JSON-filer
i projektmappen (se app/services/project_files.py)."""
from __future__ import annotations

import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, LargeBinary, String, Text, create_engine
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
    avatar: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)  # PNG, center-croppad
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Spärrat konto: sessionen nekas och login blockeras (se app/auth.py).
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
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
    # Oigissbar token för publik delning (/s/{token}). None = inte delad.
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


class ThemePreset(Base):
    """Namngiven tema-/inställningsförinställning per ägare (font, färger, kartstorlek,
    autorotate, fade). Återanvänds mellan turer. `config` = JSON-subset av
    tour.default (utan firstScene). En kan vara `is_default` -> ärvs av nya turer."""
    __tablename__ = "theme_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    config: Mapped[str] = mapped_column(Text)  # JSON
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)


class Setting(Base):
    """Enkel nyckel/värde-store för super-admin-inställningar (t.ex. tjänstenamn).
    Env ger default; en rad här override:ar. Läses via app/services/settings.py."""
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)  # kan vara lång (t.ex. arbetsgångstext)


engine = create_engine(
    config.DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    # Pre-produktion: inga migrationer. Vid schemaändring - radera svk.db och
    # starta om, så byggs schemat om och admin seedas ur env. Alembic återinförs
    # när vi produktionssätter (baslinje genereras då ur de slutliga modellerna).
    config.PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    _bootstrap_admin()


def _bootstrap_admin() -> None:
    """Säkerställ bootstrap-admin ur env (sluten inbjudan), adoptera projektmappar
    på disk som saknar DB-rad (t.ex. efter en DB-blåsning pre-produktion) och
    backfilla ägarlösa projekt - allt till admin."""
    if not config.ADMIN_EMAIL or not config.ADMIN_PASSWORD:
        return
    from app.auth import hash_password

    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == config.ADMIN_EMAIL).first()
        if admin is None and db.query(User).count() == 0:
            admin = User(
                email=config.ADMIN_EMAIL,
                password_hash=hash_password(config.ADMIN_PASSWORD),
                is_admin=True,
            )
            db.add(admin)
            db.commit()
        if admin is None:  # env-admin saknas men andra användare finns -> lämna
            return

        known = {slug for (slug,) in db.query(Project.slug).all()}
        for child in sorted(config.PROJECTS_DIR.glob("*/tour.json")):
            slug = child.parent.name
            if slug not in known:
                db.add(Project(slug=slug, name=slug, owner_id=admin.id))
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
