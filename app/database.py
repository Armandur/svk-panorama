"""Projekt-index i SQLite. Endast metadata - geometri lagras i JSON-filer
i projektmappen (se app/services/project_files.py)."""
from __future__ import annotations

import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, LargeBinary, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app import config


class Base(DeclarativeBase):
    pass


# Team-roller (vid sidan av globala User.is_admin = super-admin).
TEAM_ROLE_MEMBER = "member"
TEAM_ROLE_ADMIN = "team_admin"


class Team(Base):
    """Organisation som äger turer och delar media/presets bland sina medlemmar
    (Fas 4). VALFRITT - en användare kan sakna team (team_id NULL) och äger då
    sina turer solo. `base_url` = teamets egna domän (Fas 4.3, tom tills satt)."""
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    base_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Domänverifiering (TASK-396): domän som väntar på TXT-verifiering + dess token.
    # base_url satt = verifierad+aktiv. Ingen separat verified-bool behövs.
    pending_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)
    domain_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Lagringskvot i byte (super-admin sätter). None = obegränsat. Mjuk gräns idag
    # (mätare + varning); en framtida hård guard läser samma storage.quota_status().
    storage_quota_bytes: Mapped[int | None] = mapped_column(nullable=True)
    # Team-ikon (PNG-blob, center-croppad som avatar), visas i /editor-arbetsyteflikarna.
    # Team-admin sätter den. None = ingen ikon (fallback: initial).
    icon: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )


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
    # Team-medlemskap (Fas 4). Nullable = solo-användare utan team. team_role är
    # member|team_admin (team-lokal roll, skild från globala is_admin/super-admin).
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    team_role: Mapped[str] = mapped_column(String(20), default=TEAM_ROLE_MEMBER, nullable=False)
    # Får användaren äga PERSONLIGA turer (utanför teamet)? Default True för self-serve;
    # konton en team-admin skapar sätts False (org äger allt de gör). Team-admin togglar.
    # Se arbetsyte-modellen (ROADMAP).
    can_personal: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )

    @property
    def owner_key(self) -> str:
        """Ägar-nyckel för delade resurser (mediepool): `team-<id>` om användaren
        har team (delad pool), annars `<user_id>`. Team-prefixet undviker att
        User.id och Team.id kolliderar på samma mediekatalog. En sanningskälla."""
        return f"team-{self.team_id}" if self.team_id is not None else str(self.id)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    # Ägare (multi-tenant). Nullable för bakåtkompatibilitet med tidiga projekt
    # som backfillas till bootstrap-admin.
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    # Team-ägd tur (Fas 4). None = solo-tur (ägs via owner_id). Är team_id satt äger
    # teamet turen och owner_id bevaras bara som "skapad av" (spårbarhet). Slug är
    # fortsatt GLOBALT unik (per-team-slug är Fas 4b).
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    # Redigeringslås (check-out/check-in, team-turer): vem som checkat ut turen för
    # redigering + när (för stale-timeout). None = incheckad. Se services/checkout.py.
    checked_out_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    checked_out_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    # Flyttbegäran (team -> personlig): en medlem begär att ta en teamtur UR teamet;
    # team-admin godkänner/avslår. `by` = begäraren (blir ny ägare vid godkännande),
    # `at` = när. Målet är implicit begärarens personliga yta (single-team). None =
    # ingen väntande begäran. Se routes/teams.py. Flytt IN till team kräver ingen
    # begäran (körs direkt) -> lagras aldrig här.
    move_requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    move_requested_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
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
    # Team-ägd preset (Fas 4, delas i teamet). None = personlig (owner_id). Scopas
    # via presets._scope_clause. owner_id bevaras som "skapad av".
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    config: Mapped[str] = mapped_column(Text)  # JSON
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)


class BrandingPreset(Base):
    """Namngiven branding-mall per ägare (logotyp/text som markdown + storlek +
    position). Skild från ThemePreset så org-identitet kan återanvändas oberoende
    av temat. `config` = JSON {content, size, position}. En kan vara `is_default`
    -> ärvs av nya turer (create_project)."""
    __tablename__ = "branding_presets"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # Team-ägd preset (Fas 4, delas i teamet). None = personlig (owner_id). Scopas
    # via presets._scope_clause. owner_id bevaras som "skapad av".
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
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
