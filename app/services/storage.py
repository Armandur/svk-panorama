"""Diskanvändning per projekt/användare för admin-översikten.

Skannar de faktiska mapparna direkt under PROJECTS_DIR/MEDIA_DIR, så även
turer/media utan matchande DB-rad ("ospårat") syns som en differens mot summan
per användare.

**Cache:** os.walk över tiles-mappar är dyrt, och admin-vyerna kan träffas ofta.
Storleken per mapp memoiseras i en in-process TTL-cache (`SVK_STORAGE_CACHE_TTL`,
default 60 s) -> en walk sker som mest en gång per TTL per mapp, oavsett hur ofta
sidan laddas. Bounded staleness: siffror kan vara upp till TTL gamla efter en
uppladdning/tiling. `invalidate()` (och admin-knappen "Räkna om") tömmer cachen
för färska siffror på begäran. Single-instans-app -> in-process räcker (jfr Fas 3)."""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from app import config
from app.services.media import owner_dir
from app.services.project_files import project_dir

# key = str(path) -> (monotonic-tidsstämpel, storlek i byte)
_cache: dict[str, tuple[float, int]] = {}
_cache_lock = threading.Lock()


# Efemära/deriverade mappar som INTE ska räknas mot lagringen: byggda zip-artefakter
# (export/backup, egress/transient) + versionshistoriken. De ligger under projektroten
# men motsvarar inte turens "riktiga" footprint -> exkludera dem så en export inte
# dubblerar turen i kvoten (M7). Prunas per namn (de bor bara i projektroten).
_EPHEMERAL_DIRS = {"_export", "_backup", "_history"}


def dir_size(path: Path) -> int:
    """Rekursiv byte-summa av en mapp. 0 om den saknas. Oachad (rå walk). Efemära
    mappar (_export/_backup/_history) hoppas - de är deriverade artefakter, inte
    lagringsanvändning."""
    if not path.exists():
        return 0
    total = 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in _EPHEMERAL_DIRS]
        for f in files:
            try:
                total += os.stat(os.path.join(root, f)).st_size
            except OSError:
                pass  # fil kan ha försvunnit mellan walk och stat
    return total


def cached_dir_size(path: Path) -> int:
    """dir_size med TTL-memoisering per mapp (se modul-docstringen)."""
    ttl = config.STORAGE_CACHE_TTL
    if ttl <= 0:
        return dir_size(path)
    key = str(path)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None and now - hit[0] < ttl:
            return hit[1]
    # Walk utanför låset (kan vara långsam); en cache-miss-race betyder bara att
    # två anrop råkar walka samma mapp - redundant, inte fel.
    size = dir_size(path)
    with _cache_lock:
        _cache[key] = (time.monotonic(), size)
    return size


def invalidate(path: Path | None = None) -> None:
    """Töm hela cachen (path=None) eller bara en mapp."""
    with _cache_lock:
        if path is None:
            _cache.clear()
        else:
            _cache.pop(str(path), None)


def human_size(n: int) -> str:
    """Byte -> läsbar sträng (heltal upp t.o.m. KB, sedan 1 decimal)."""
    size = float(n)
    if size < 1024:
        return f"{int(size)} B"
    for unit in ("KB", "MB", "GB", "TB"):
        size /= 1024.0
        if size < 1024 or unit == "TB":
            dec = 0 if unit == "KB" else 1
            return f"{size:.{dec}f} {unit}"
    return f"{size:.1f} TB"


def project_size(slug: str) -> int:
    return cached_dir_size(project_dir(slug))


def media_size(owner: str) -> int:
    """`owner` = ägar-nyckel (User.owner_key): `<user_id>` eller `team-<id>`."""
    return cached_dir_size(owner_dir(owner))


def project_sizes() -> dict[str, int]:
    """{slug: bytes} för varje mapp direkt under PROJECTS_DIR (inkl. ospårade)."""
    out: dict[str, int] = {}
    root = config.PROJECTS_DIR
    if root.exists():
        for child in root.iterdir():
            if child.is_dir():
                out[child.name] = cached_dir_size(child)
    return out


def media_sizes() -> dict[str, int]:
    """{ägar-nyckel: bytes} för varje poolmapp under MEDIA_DIR. Nyckeln är en sträng
    (`<user_id>` eller `team-<id>`) som matchar User.owner_key. Mappar med ogiltigt
    namnformat tas MED (classify_storage klassar dem som ospårade) så disk_total inte
    underrapporterar (L7)."""
    out: dict[str, int] = {}
    root = config.MEDIA_DIR
    if root.exists():
        for child in root.iterdir():
            if child.is_dir():
                out[child.name] = cached_dir_size(child)
    return out


def team_usage_bytes(team_slugs, team_id: int, psizes: dict, msizes: dict) -> int:
    """Ett teams lagringsanvändning: dess turer + delade mediepool (`team-<id>`)."""
    return sum(psizes.get(s, 0) for s in team_slugs) + msizes.get(f"team-{team_id}", 0)


def team_usage_direct(team_slugs, team_id: int) -> int:
    """Som team_usage_bytes men summerar bara teamets egna mappar (per-mapp-cachad)
    i stället för att bygga hela serverns storlekskarta. För kvot-grinden i request-
    vägen (L8) - undviker att walka främmande teams data vid varje anrop."""
    return sum(project_size(s) for s in team_slugs) + media_size(f"team-{team_id}")


def quota_status(usage: int, quota: int | None) -> dict:
    """Kvot-status för mätare OCH en framtida hård guard. `quota` None/0 = obegränsat
    (over alltid False). `over` = usage > quota. `pct` = heltalsprocent (kan bli >100)."""
    if not quota:
        return {"usage": usage, "quota": None, "pct": None, "over": False}
    return {"usage": usage, "quota": quota, "pct": round(usage / quota * 100), "over": usage > quota}


def classify_storage(teams, users, projects, member_counts, psizes, msizes) -> dict:
    """Ren klassning för /admin/storage: fördela varje tur och mediepool i EXAKT en grupp
    (team eller solo-användare) så `tracked + untracked == disk_total`. Tar redan hämtad
    data (inga DB-/FS-anrop) -> deterministiskt testbar. `teams`/`users`/`projects` behöver
    attributen (id/name/slug), (id/name/email), (slug/name/team_id/owner_id).

    - Team-tur (team_id satt) -> teamet; solo-tur (team_id None, owner finns) -> ägaren.
    - Team-pool `team-<id>` -> teamet; personlig pool `<user_id>` -> användaren.
    - Ospårat = turmappar utan klassbar DB-rad + pooler utan matchande team/användare
      (t.ex. ett team vars medlemmar alla lämnat räknas ändå under teamet, INTE ospårat).
    Solo-grupper med noll footprint utelämnas ur listan (bidrar ändå 0 till tracked)."""
    team_tours: dict[int, list] = {}
    solo_tours: dict[int, list] = {}
    for p in projects:
        if p.team_id is not None:
            team_tours.setdefault(p.team_id, []).append(p)
        elif p.owner_id is not None:
            solo_tours.setdefault(p.owner_id, []).append(p)

    def _rows(plist):
        rows = [{"slug": p.slug, "name": p.name, "bytes": psizes.get(p.slug, 0)} for p in plist]
        rows.sort(key=lambda r: r["bytes"], reverse=True)
        return rows

    classified: set[str] = set()
    team_groups = []
    for t in teams:
        rows = _rows(team_tours.get(t.id, []))
        classified.update(r["slug"] for r in rows)
        pool = msizes.get(f"team-{t.id}", 0)
        team_groups.append({
            "id": t.id, "name": t.name, "slug": t.slug, "members": member_counts.get(t.id, 0),
            "tours": rows, "media": pool, "total": sum(r["bytes"] for r in rows) + pool,
        })
    team_groups.sort(key=lambda g: g["total"], reverse=True)

    solo_groups = []
    for u in users:
        rows = _rows(solo_tours.get(u.id, []))
        classified.update(r["slug"] for r in rows)  # klassa även 0-byte-turer (ej ospårat)
        pool = msizes.get(str(u.id), 0)
        total = sum(r["bytes"] for r in rows) + pool
        if total == 0:
            continue
        solo_groups.append({
            "id": u.id, "email": u.email, "name": u.name,
            "tours": rows, "media": pool, "total": total,
        })
    solo_groups.sort(key=lambda g: g["total"], reverse=True)

    valid_media = {f"team-{t.id}" for t in teams} | {str(u.id) for u in users}
    orphan_tours = sorted(
        [{"slug": s, "bytes": b} for s, b in psizes.items() if s not in classified],
        key=lambda o: o["bytes"], reverse=True)
    orphan_media = sorted(
        [{"owner_id": k, "bytes": b} for k, b in msizes.items() if k not in valid_media],
        key=lambda o: o["bytes"], reverse=True)
    tracked = sum(g["total"] for g in team_groups) + sum(g["total"] for g in solo_groups)
    disk_total = sum(psizes.values()) + sum(msizes.values())
    return {
        "team_groups": team_groups, "solo_groups": solo_groups,
        "orphan_tours": orphan_tours, "orphan_media": orphan_media,
        "tracked": tracked, "disk_total": disk_total, "untracked": max(0, disk_total - tracked),
    }
