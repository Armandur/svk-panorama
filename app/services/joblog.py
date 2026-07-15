"""Persistent felllogg per projekt för bakgrundsjobb (tiling/export/backup).

In-memory-jobbstatus (`_jobs`-dictar) försvinner vid omstart -> den här filen
(`projects/<slug>/_jobs.log`) bevarar fel så användaren kan följa upp vad som gick
snett i efterhand. Append-only, ren fil-I/O under ett eget lås. Ligger under den
gitignorade projektmappen och börjar med `_` (som `_history`) -> följer naturligt
INTE med i backup/bundle (whitelist-enumerering)."""
from __future__ import annotations

import datetime
import threading
from pathlib import Path

from app.services.project_files import project_dir

_lock = threading.Lock()
_MAX_LINES = 500  # tak: äldsta rader trunkeras (loggen är error-only, låg volym)


def _log_path(slug: str) -> Path:
    return project_dir(slug) / "_jobs.log"


def append(slug: str, kind: str, message: str, level: str = "fel") -> None:
    """Lägg till en rad i projektets jobblogg. Fält TAB-separerade (meddelandet sist,
    ev. radbrytningar plattas till mellanslag) -> enkel att parsa i `read`. Filen kapas
    till de senaste `_MAX_LINES` raderna så den inte växer obegränsat."""
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    msg = " ".join(str(message).split())  # platta ut radbrytningar/whitespace
    line = f"{ts}\t{kind}\t{level}\t{msg}\n"
    with _lock:
        p = _log_path(slug)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(line)
        try:
            lines = p.read_text(encoding="utf-8").splitlines(keepends=True)
        except OSError:
            return
        if len(lines) > _MAX_LINES:
            p.write_text("".join(lines[-_MAX_LINES:]), encoding="utf-8")


def read(slug: str, limit: int = 200) -> list[dict]:
    """Loggraderna som dictar {time, kind, level, message}, NYAST FÖRST, max `limit`."""
    p = _log_path(slug)
    if not p.exists():
        return []
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for ln in lines[-limit:]:
        parts = ln.split("\t", 3)
        if len(parts) == 4:
            out.append({"time": parts[0], "kind": parts[1], "level": parts[2], "message": parts[3]})
    return list(reversed(out))
