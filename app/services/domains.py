"""Domänverifiering (TASK-396): ett team måste bevisa ägarskap av en domän via
en DNS TXT-record INNAN den aktiveras som Team.base_url (tenant-resolution).
Utan detta kan ett team claima ett annat teams domän.

Flöde: request_domain() genererar en token -> teamet lägger
`_pano-verify.<domän>` TXT = token -> verify_domain() slår upp TXT:en, jämför
och (vid unik match) sätter base_url."""
from __future__ import annotations

import secrets

from sqlalchemy.orm import Session

from app.database import Team
from app.deps import _normalize_host

VERIFY_PREFIX = "_pano-verify."


def lookup_txt(name: str) -> list[str]:
    """Slå upp TXT-poster för `name`. Egen seam (modulnivå) så tester kan
    monkeypatcha den. Aldrig krasch - NXDOMAIN/timeout m.m. -> tom lista."""
    import dns.resolver

    try:
        answer = dns.resolver.resolve(name, "TXT")
    except Exception:  # noqa: BLE001 - alla DNS-fel (NXDOMAIN/timeout/...) = "inget svar"
        return []
    values: list[str] = []
    for rdata in answer:
        # TXT-strängar kan komma i flera delar (rdata.strings); slå ihop och
        # avkoda. rdata.to_text() ger citerad form, så bygg av strings direkt.
        parts = getattr(rdata, "strings", None)
        if parts:
            values.append(b"".join(parts).decode("utf-8", errors="replace"))
        else:
            values.append(str(rdata).strip('"'))
    return values


def request_domain(db: Session, team: Team, domain: str) -> str:
    """Registrera en domän som väntar på verifiering: normalisera, generera en
    ny token, spara på teamet. Returnerar token (visas som TXT-instruktion)."""
    normalized = _normalize_host(domain)
    if not normalized or "." not in normalized:
        raise ValueError("Ange en giltig domän, t.ex. exempel.se")
    token = secrets.token_hex(16)
    team.pending_domain = normalized
    team.domain_token = token
    db.commit()
    return token


def verify_domain(db: Session, team: Team) -> bool:
    """Slå upp `_pano-verify.<pending_domain>` TXT och jämför med sparad token.
    Vid match: kolla att ingen ANNAN team redan har domänen som aktiv base_url
    (unikhet) - om upptagen, returnera False utan att aktivera. Annars sätt
    base_url, nolla pending_domain/domain_token. Ingen match -> False."""
    if not team.pending_domain or not team.domain_token:
        return False
    txt_values = lookup_txt(f"{VERIFY_PREFIX}{team.pending_domain}")
    if team.domain_token not in txt_values:
        return False
    normalized = _normalize_host(team.pending_domain)
    taken = (
        db.query(Team)
        .filter(Team.id != team.id, Team.base_url.isnot(None), Team.base_url != "")
        .all()
    )
    if any(_normalize_host(other.base_url) == normalized for other in taken):
        return False
    team.base_url = normalized
    team.pending_domain = None
    team.domain_token = None
    db.commit()
    return True


def clear_domain(db: Session, team: Team) -> None:
    """Avaktivera domänen: nolla base_url + ev. väntande verifiering."""
    team.base_url = None
    team.pending_domain = None
    team.domain_token = None
    db.commit()
