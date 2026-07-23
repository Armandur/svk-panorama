"""Global in-process jobbkö: EN delad FIFO-kö + N daemon-worker-trådar - den
GLOBALA samtidighetsgränsen för tunga bakgrundsjobb (tiling per scen, export,
backup). Ersätter tidigare separata `threading.Thread(...).start()` per
jobbtyp/tur - då gav M turer x tile_concurrency samtidiga Docker-processer,
utan tak. Nu delar ALLA tre jobbtyper samma N-stora pool (N = SVK_JOB_WORKERS).

Workers startas LAT vid första `submit()` (ingen lifespan-koppling behövs).
Varje worker plockar ETT item i taget och kör `fn()` synkront -> som mest N
tunga jobb totalt, oavsett hur många turer/jobbtyper som startat samtidigt.

Ett centralt register (job_id -> {kind, slug, scene_id, status, ts}) hålls för
en framtida jobb-översikt (Fas 2-UI); dagens klienter pollar OFÖRÄNDRAT
respektive tjänsts egna `_jobs[slug]`-dict (tiling.py/bundle.py/backup.py) -
`fn` ansvarar SJÄLV för att uppdatera den. jobqueue vet inget om domänen.

VIKTIGT (deadlock): `fn` FÅR ALDRIG blockera på ett annat jobb i samma kö
(t.ex. ett export-jobb som väntar på att en tiling-scen ska bli klar) - alla
submits är fire-and-forget. En worker som blockerar äter en av N-platserna
permanent."""
from __future__ import annotations

import itertools
import queue as _queue_mod
import threading
import time
from typing import Any, Callable

from app import config

_queue: "_queue_mod.Queue[tuple[str, Callable[[], None]]]" = _queue_mod.Queue()
_registry: dict[str, dict[str, Any]] = {}
_registry_lock = threading.Lock()
_id_seq = itertools.count(1)

_MAX_TERMINAL = 200  # tak för klara (done/error) poster i registret; äldsta gallras

_workers_lock = threading.Lock()
_workers_started = False


def _prune_locked() -> None:
    # Antar _registry_lock hålls. Behåll som mest _MAX_TERMINAL done/error-poster
    # (äldsta efter ts droppas); queued/running rörs aldrig.
    terminal = [(jid, v) for jid, v in _registry.items() if v["status"] in ("done", "error")]
    if len(terminal) > _MAX_TERMINAL:
        terminal.sort(key=lambda kv: kv[1]["ts"])  # äldst först
        for jid, _ in terminal[: len(terminal) - _MAX_TERMINAL]:
            _registry.pop(jid, None)


def _worker() -> None:
    while True:
        job_id, fn = _queue.get()
        try:
            with _registry_lock:
                info = _registry.get(job_id)
                if info is not None:
                    info["status"] = "running"
            fn()
            with _registry_lock:
                info = _registry.get(job_id)
                if info is not None:
                    info["status"] = "done"
                    _prune_locked()
        except Exception:  # noqa: BLE001 - en worker får ALDRIG dö, annars krymper poolen
            with _registry_lock:
                info = _registry.get(job_id)
                if info is not None:
                    info["status"] = "error"
                    _prune_locked()
        finally:
            _queue.task_done()


def _ensure_workers() -> None:
    global _workers_started
    with _workers_lock:
        if _workers_started:
            return
        n = max(1, int(config.JOB_WORKERS))
        for i in range(n):
            threading.Thread(target=_worker, name=f"jobqueue-worker-{i}", daemon=True).start()
        _workers_started = True


def submit(
    fn: Callable[[], None],
    *,
    kind: str,
    slug: str,
    scene_id: str | None = None,
    label: str | None = None,
) -> str:
    """Lägg `fn` (tar inga argument - bind med lambda/closure i anroparen) i den
    globala kön. Fire-and-forget: felhantering INUTI fn är anroparens ansvar
    (skriv job["status"]/job["error"] i domänens egen _jobs[slug] som förut) -
    jobqueue kraschsäkrar bara sitt eget register, inte anroparens jobbtillstånd."""
    _ensure_workers()
    job_id = f"{kind}-{next(_id_seq)}"
    with _registry_lock:
        _registry[job_id] = {
            "kind": kind,
            "slug": slug,
            "scene_id": scene_id,
            "label": label,
            "status": "queued",
            "ts": time.time(),
        }
    _queue.put((job_id, fn))
    return job_id


def all_jobs() -> dict[str, dict[str, Any]]:
    """Ögonblicksbild av registret (Fas 2-UI; testbarhet)."""
    with _registry_lock:
        return {k: dict(v) for k, v in _registry.items()}


def _reset_for_tests() -> None:
    """TEST-ONLY: tvinga fram en FÄRSK kö + omstart av workers med aktuellt
    `config.JOB_WORKERS` (t.ex. efter att testet ändrat workerantalet). Redan
    startade worker-trådar (om några) hänger kvar blockerade på den gamla,
    nu övergivna kön - ofarligt: de är daemon-trådar och testprocessen är
    kortlivad. Döps med `_`-prefix för att markera att den inte är publikt API."""
    global _queue, _workers_started
    _queue = _queue_mod.Queue()
    with _registry_lock:
        _registry.clear()
    with _workers_lock:
        _workers_started = False
