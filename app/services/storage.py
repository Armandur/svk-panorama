"""Diskanvändning per projekt/användare för admin-översikten.

Live-beräknad (os.walk) - ingen persistens. Tänkt för self-host-skala (ett fåtal
turer); cache:a om det blir tungt. Skannar de faktiska mapparna direkt under
PROJECTS_DIR/MEDIA_DIR, så även turer/media utan matchande DB-rad ("ospårat")
syns som en differens mot summan per användare."""
from __future__ import annotations

import os
from pathlib import Path

from app import config
from app.services.media import owner_dir
from app.services.project_files import project_dir


def dir_size(path: Path) -> int:
    """Rekursiv byte-summa av en mapp. 0 om den saknas."""
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
    return dir_size(project_dir(slug))


def media_size(owner_id: int) -> int:
    return dir_size(owner_dir(owner_id))


def project_sizes() -> dict[str, int]:
    """{slug: bytes} för varje mapp direkt under PROJECTS_DIR (inkl. ospårade)."""
    out: dict[str, int] = {}
    root = config.PROJECTS_DIR
    if root.exists():
        for child in root.iterdir():
            if child.is_dir():
                out[child.name] = dir_size(child)
    return out


def media_sizes() -> dict[int, int]:
    """{owner_id: bytes} för varje numerisk mapp under MEDIA_DIR."""
    out: dict[int, int] = {}
    root = config.MEDIA_DIR
    if root.exists():
        for child in root.iterdir():
            if child.is_dir() and child.name.isdigit():
                out[int(child.name)] = dir_size(child)
    return out
