"""Enkel in-memory rate limiter (fixed window per nyckel). Räcker för single-host
(jfr Fas 3-beslutet: in-process, ingen extern store). Efemär - inget persisteras,
inga IP-adresser loggas; räknarna lever bara i minnet och rensas löpande.

Används för att bromsa brute force mot login: räkna misslyckade försök per nyckel
(IP), blockera när taket nås inom fönstret, nollställ vid lyckad inloggning."""
from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_hits: dict[str, list[float]] = {}

WINDOW_SECONDS = 15 * 60
MAX_FAILURES = 10


def _prune(times: list[float], now: float) -> list[float]:
    return [t for t in times if now - t < WINDOW_SECONDS]


def too_many(key: str) -> bool:
    """True om nyckeln redan nått taket för misslyckade försök i fönstret."""
    now = time.monotonic()
    with _lock:
        times = _prune(_hits.get(key, []), now)
        _hits[key] = times
        return len(times) >= MAX_FAILURES


def record_failure(key: str) -> None:
    now = time.monotonic()
    with _lock:
        _hits[key] = _prune(_hits.get(key, []), now) + [now]


def reset(key: str) -> None:
    with _lock:
        _hits.pop(key, None)
