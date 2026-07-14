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
from app.services import media
from app.services.media import owner_dir
from app.services.project_files import project_dir

# key = str(path) -> (monotonic-tidsstämpel, storlek i byte)
_cache: dict[str, tuple[float, int]] = {}
_cache_lock = threading.Lock()


def dir_size(path: Path) -> int:
    """Rekursiv byte-summa av en mapp. 0 om den saknas. Oachad (rå walk)."""
    if not path.exists():
        return 0
    total = 0
    for root, _dirs, files in os.walk(path):
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
    (`<user_id>` eller `team-<id>`) som matchar User.owner_key."""
    out: dict[str, int] = {}
    root = config.MEDIA_DIR
    if root.exists():
        for child in root.iterdir():
            if child.is_dir() and media.valid_owner_key(child.name):
                out[child.name] = cached_dir_size(child)
    return out
