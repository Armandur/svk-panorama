"""Versionshistorik för en tur: snapshotta tour.json + map.json ihop till en
unified tidslinje så en tidigare version kan återställas.

Designbeslut:
- **Unified versioner:** varje snapshot arkiverar BÅDE tour.json och map.json
  (de är kopplade - tour.scenes <-> map.scenes) till samma
  `projects/<slug>/_history/<epoch_ms>/`. Restore skriver båda ihop -> desync
  omöjlig.
- **Pre-overwrite:** `snapshot()` arkiverar det som ligger på disk INNAN en
  skrivning skriver över det. En version taggad vid tid T innehåller alltså det
  läge som GÄLLDE FRAM TILL T (ersattes vid T) - inte innehåll skapat vid T.
- **Ren fil-I/O, eget lås:** `snapshot()` anropas inuti write_tour/write_map som
  i sin tur ofta körs medan `project_files.tour_lock` redan hålls. Därför tar den
  ALDRIG tour_lock (skulle deadlocka) - bara sitt eget `_history_lock`. Den
  importerar inte project_files (ingen cirkel); den tar en projektmappsökväg och
  deriverar filnamnen själv.
"""
from __future__ import annotations

import json
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from app import config

# Filerna som utgör en versions unified state. Stabila namn -> history behöver
# inte importera project_files (undviker cirkel med write_tour-hooken).
_FILES = ("tour.json", "map.json")

# Serialiserar snapshot + prune så två samtidiga skrivningar inte krockar på
# samma epoch-mapp eller racer prune. Skilt från tour_lock (som snapshot aldrig
# tar) -> ingen deadlock; låsen tas alltid i ordningen tour_lock -> _history_lock.
_history_lock = threading.Lock()


def _history_dir(project_dir: Path) -> Path:
    return project_dir / "_history"


def _versions(hist: Path) -> list[int]:
    """Befintliga versioners epoch_ms, nyast först."""
    if not hist.is_dir():
        return []
    out = []
    for child in hist.iterdir():
        if child.is_dir() and child.name.isdigit():
            out.append(int(child.name))
    out.sort(reverse=True)
    return out


def _present_files(project_dir: Path) -> list[Path]:
    return [project_dir / name for name in _FILES if (project_dir / name).exists()]


def _same_content(version_dir: Path, present: list[Path]) -> bool:
    """True om `version_dir` har exakt samma filuppsättning och byte-innehåll som
    de nu befintliga filerna - då är en ny snapshot meningslös (dedup)."""
    live = {p.name for p in present}
    stored = {p.name for p in version_dir.iterdir() if p.is_file() and p.name in _FILES}
    if live != stored:
        return False
    for p in present:
        try:
            if (version_dir / p.name).read_bytes() != p.read_bytes():
                return False
        except OSError:
            return False
    return True


def _prune(hist: Path, versions_desc: list[int]) -> None:
    """Behåll en version om den är bland de HISTORY_MAX nyaste ELLER yngre än
    HISTORY_FLOOR_DAYS. Radera övriga (äldst)."""
    floor_ms = config.HISTORY_FLOOR_DAYS * 86_400_000
    now_ms = int(time.time() * 1000)
    for i, v in enumerate(versions_desc):
        if i < config.HISTORY_MAX or (now_ms - v) < floor_ms:
            continue
        shutil.rmtree(hist / str(v), ignore_errors=True)


def snapshot(project_dir: Path, *, force: bool = False) -> int | None:
    """Arkivera nuvarande tour.json+map.json (pre-overwrite) som en ny version.
    Returnerar versionens epoch_ms, eller None om ingen skapades (inget att
    arkivera / coalesce / dedup).

    force=True kringgår coalesce+dedup (används av restore som MÅSTE arkivera
    nuläget för att vara reversibelt oavsett hur nyligen något sparades)."""
    present = _present_files(project_dir)
    if not present:
        return None  # t.ex. en helt ny tur innan första write

    hist = _history_dir(project_dir)
    with _history_lock:
        versions = _versions(hist)
        now_ms = int(time.time() * 1000)
        if not force and versions:
            newest = versions[0]
            if (now_ms - newest) < config.HISTORY_COALESCE_SEC * 1000:
                return None  # coalesce: redigerings-burst -> en snapshot
            if _same_content(hist / str(newest), present):
                return None  # dedup: identiskt innehåll redan sparat

        # Undvik kollision om två snapshots hamnar på samma millisekund.
        while (hist / str(now_ms)).exists():
            now_ms += 1
        dest = hist / str(now_ms)
        dest.mkdir(parents=True, exist_ok=True)
        for p in present:
            shutil.copy2(p, dest / p.name)

        _prune(hist, [now_ms] + versions)
        return now_ms


def list_versions(project_dir: Path) -> list[dict[str, Any]]:
    """Versioner nyast först med hint-metadata för listvyn (scenantal, språk,
    storlek). Läser varje versions tour.json - billigt för ~HISTORY_MAX poster."""
    hist = _history_dir(project_dir)
    out: list[dict[str, Any]] = []
    for v in _versions(hist):
        d = hist / str(v)
        meta: dict[str, Any] = {"id": v, "epoch_ms": v, "scenes": None, "languages": [], "size": 0}
        # Hela blocket under try: en samtidig spar kan prune:a bort d mitt i skanningen
        # (FileNotFoundError) - hoppa den försvunna versionen i stället för att 500:a.
        try:
            tour_f = d / "tour.json"
            if tour_f.exists():
                tour = json.loads(tour_f.read_text(encoding="utf-8"))
                meta["scenes"] = len(tour.get("scenes", {}))
                meta["languages"] = tour.get("default", {}).get("languages") or []
            meta["size"] = sum(f.stat().st_size for f in d.iterdir() if f.is_file())
        except (OSError, ValueError):
            if not d.is_dir():
                continue  # versionen försvann (prune) -> uteslut helt
        out.append(meta)
    return out


def read_version(project_dir: Path, version_id: int) -> dict[str, dict[str, Any]]:
    """Läs en versions arkiverade filer. Returnerar {filnamn: data} bara för de
    filer som faktiskt fanns i snapshotten (en tidig snapshot kan sakna map.json).
    Kastar KeyError om versionen inte finns."""
    d = _history_dir(project_dir) / str(version_id)
    if not d.is_dir():
        raise KeyError(version_id)
    result: dict[str, dict[str, Any]] = {}
    for name in _FILES:
        f = d / name
        if f.exists():
            result[name] = json.loads(f.read_text(encoding="utf-8"))
    return result
