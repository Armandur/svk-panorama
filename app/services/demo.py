"""Demo-team: ett team folk kan testa editorn i utan att röra riktig data.

Byggs tomt; super-admin fyller på innehåll och "låser" det (`capture_seed`) till en
gitignorad guld-katalog (`config.DEMO_SEED_DIR`). `reset_demo` återställer teamet till
den låsta seeden - schemalagt nattligt (systemd-timer -> reset-endpoint) + manuellt.

SÄKERHET (destruktiv, oövervakad reset):
- Bulk-radering scopas ALLTID på ett POSITIVT team-id (`_require_positive_id`). En
  `team_id IS NULL`-fråga hade raderat alla team-lösa turer i systemet -> abortera hellre.
- reset körs IN-PROCESS (endpoint) så den kan `forget_job`/`storage.invalidate` och ta
  `tour_lock` runt rmtree+copy (ingen kollision med en aktiv demo-redigerare).
- Konton nycklas på en FAST lista (force by email), inte teamets nuvarande medlemmar
  (en medlem kan ha lämnat/ändrats). Demo-konton är alltid members, aldrig team_admin.
- Copy-back wipe:ar HELA projektmappen (delete_project_files) -> inget `_history`/`_jobs.log`
  läcker; nya Project-rader får `share_token=None` så demo-publicerade /s-länkar dör.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app import config
from app.auth import hash_password
from app.database import TEAM_ROLE_MEMBER, BrandingPreset, Project, Team, ThemePreset, User
from app.services import media, storage
from app.services.backup import forget_job as forget_backup
from app.services.bundle import forget_job as forget_export
from app.services.project_files import delete_project_files, project_dir, tour_lock
from app.services.tiling import forget_job as forget_tile

DEMO_TEAM_SLUG = "demo"
DEMO_TEAM_NAME = "Demo"
# Publika demo-testkonton (members, kända lösenord). Utöka listan vid behov.
DEMO_ACCOUNTS = [
    {"email": "demo", "name": "Demo-testare", "password": "demo"},
    {"email": "demo2", "name": "Demo-testare 2", "password": "demo"},
]
# Gold-filer per tur (regenererbart/efemärt utelämnas: previews, _history, _jobs.log, _export).
_GOLD = ("tour.json", "map.json", "map.png")
_GOLD_DIRS = ("images", "tiles")


def demo_team(db: Session) -> Team | None:
    return db.query(Team).filter(Team.slug == DEMO_TEAM_SLUG).first()


def _require_positive_id(team: Team | None) -> int:
    """Advisor-guard mot IS-NULL-bulkradering: en giltig positiv int-id eller abort."""
    if team is None or not isinstance(team.id, int) or team.id <= 0:
        raise ValueError("Demo-teamet är inte korrekt initialiserat - avbryter (skydd mot bulkradering).")
    return team.id


def ensure_demo(db: Session) -> Team:
    """Idempotent: skapa demo-teamet + demo-konton om de saknas och FORCE:a kontona till
    känt läge (lösenord/team/roll=member/can_personal=False) - oavsett nuvarande state."""
    team = demo_team(db)
    if team is None:
        team = Team(name=DEMO_TEAM_NAME, slug=DEMO_TEAM_SLUG)
        db.add(team)
        db.commit()
    elif team.name != DEMO_TEAM_NAME:
        team.name = DEMO_TEAM_NAME
        db.commit()
    tid = _require_positive_id(team)
    for acc in DEMO_ACCOUNTS:
        u = db.query(User).filter(User.email == acc["email"]).first()
        if u is None:
            u = User(email=acc["email"])
            db.add(u)
        u.name = acc["name"]
        u.password_hash = hash_password(acc["password"])
        u.team_id = tid
        u.team_role = TEAM_ROLE_MEMBER  # aldrig team_admin (skulle kunna radera/döpa om teamet)
        u.can_personal = False          # bara demo-teamet, inga personliga turer
        u.is_admin = False
        u.active = True
    db.commit()
    return team


def _copy_gold(src: Path, dst: Path) -> None:
    """Kopiera EN turs gold-filer (utan efemära/historik-delar) src -> dst."""
    dst.mkdir(parents=True, exist_ok=True)
    for name in _GOLD:
        if (src / name).exists():
            shutil.copy2(src / name, dst / name)
    for d in _GOLD_DIRS:
        if (src / d).is_dir():
            shutil.copytree(src / d, dst / d, dirs_exist_ok=True)


def _dump_presets(db: Session, tid: int) -> dict:
    def rows(model):
        return [{"name": p.name, "config": p.config, "is_default": p.is_default}
                for p in db.query(model).filter(model.team_id == tid).all()]
    return {"theme": rows(ThemePreset), "branding": rows(BrandingPreset)}


def _restore_presets(db: Session, tid: int, owner_id: int, dumped: dict) -> None:
    db.query(ThemePreset).filter(ThemePreset.team_id == tid).delete(synchronize_session=False)
    db.query(BrandingPreset).filter(BrandingPreset.team_id == tid).delete(synchronize_session=False)
    for r in dumped.get("theme", []):
        db.add(ThemePreset(owner_id=owner_id, team_id=tid, name=r["name"], config=r["config"], is_default=r["is_default"]))
    for r in dumped.get("branding", []):
        db.add(BrandingPreset(owner_id=owner_id, team_id=tid, name=r["name"], config=r["config"], is_default=r["is_default"]))
    db.commit()


def _manifest_path() -> Path:
    return config.DEMO_SEED_DIR / "manifest.json"


def _read_manifest() -> dict:
    p = _manifest_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def has_seed() -> bool:
    return _manifest_path().exists()


def capture_seed(db: Session) -> int:
    """"Lås": spara demo-teamets NUVARANDE state som guld-seed (manifest + gold-filer +
    media-pool + team-presets). Skriver om hela DEMO_SEED_DIR. Returnerar antal turer."""
    team = ensure_demo(db)
    tid = _require_positive_id(team)
    seed = config.DEMO_SEED_DIR
    if seed.exists():
        shutil.rmtree(seed)
    (seed / "projects").mkdir(parents=True)

    tours = db.query(Project).filter(Project.team_id == tid).all()
    for p in tours:
        _copy_gold(project_dir(p.slug), seed / "projects" / p.slug)

    src_media = media.owner_dir(f"team-{tid}")
    if src_media.exists():
        shutil.copytree(src_media, seed / "media")

    manifest = {
        "team_name": team.name,
        "tours": [{"slug": p.slug, "name": p.name, "owner_id": p.owner_id} for p in tours],
        "presets": _dump_presets(db, tid),
    }
    _manifest_path().write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(tours)


def _delete_demo_tour(db: Session, p: Project) -> None:
    for forget in (forget_tile, forget_export, forget_backup):
        forget(p.slug)
    delete_project_files(p.slug)
    storage.invalidate(project_dir(p.slug))
    db.delete(p)


def reset_demo(db: Session) -> dict:
    """Återställ demo-teamet till den låsta seeden (idempotent, säker). Ingen seed ->
    bara tomt utgångsläge (team + konton, inga turer). Returnerar en summering."""
    team = ensure_demo(db)
    tid = _require_positive_id(team)  # ALDRIG radera utan positivt id
    manifest = _read_manifest()
    owner_id = db.query(User).filter(User.email == DEMO_ACCOUNTS[0]["email"]).first().id

    # 1. Radera ALLA turer i demo-teamet (scopat på positivt tid) - seed-turerna
    #    kopieras tillbaka, resten (demo-användarnas skapelser) ska bort.
    existing = db.query(Project).filter(Project.team_id == tid).all()
    removed = len(existing)
    for p in existing:
        with tour_lock:
            _delete_demo_tour(db, p)
    db.commit()

    # 2. Kopiera tillbaka seed-turerna (fast slug, team-ägd, share_token nollad).
    restored = 0
    for t in manifest.get("tours", []):
        slug = t["slug"]
        with tour_lock:
            delete_project_files(slug)  # ren mapp
            _copy_gold(config.DEMO_SEED_DIR / "projects" / slug, project_dir(slug))
        db.add(Project(slug=slug, name=t["name"], owner_id=t.get("owner_id") or owner_id,
                       team_id=tid, share_token=None))
        storage.invalidate(project_dir(slug))
        restored += 1
    db.commit()

    # 3. Media-pool: rensa + kopiera tillbaka.
    pool = media.owner_dir(f"team-{tid}")
    shutil.rmtree(pool, ignore_errors=True)
    seed_media = config.DEMO_SEED_DIR / "media"
    if seed_media.exists():
        shutil.copytree(seed_media, pool)
    storage.invalidate(pool)

    # 4. Team-presets: rensa + återställ.
    _restore_presets(db, tid, owner_id, manifest.get("presets", {}))

    return {"team_id": tid, "removed": removed, "restored": restored, "had_seed": has_seed()}
