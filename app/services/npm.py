"""Auto-provisionering av Nginx Proxy Manager (NPM) proxy-host + Let's Encrypt-
cert för ett teams verifierade kunddomän (TASK-397, bygger på TASK-396:s
domänverifiering). Okonfigurerat (SVK_NPM_*/SVK_APP_FORWARD_* saknas) = no-op,
inget krashar.

VERIFIERAT NPM 2.15-API-flöde: auth via POST /tokens -> bearer-token, cert
skapas med TOM meta (NPM 2.15 avvisar letsencrypt_email/agree/dns_challenge som
okända fält), sedan proxy-host som pekar på cert-id. Idempotent: en befintlig
proxy-host för domänen återanvänds i stället för att dubblettskapas."""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from app import config

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    """True bara om alla NPM-relaterade env-vars är satta."""
    return bool(
        config.NPM_API_URL
        and config.NPM_API_USER
        and config.NPM_API_PASS
        and config.APP_FORWARD_HOST
        and config.APP_FORWARD_PORT
    )


def _api(method: str, path: str, token: str | None = None, body: dict | None = None, timeout: int = 120):
    """Anropa NPM:s REST-API. Returnerar (status_code, parsed_json_or_None).
    Fångar HTTPError och returnerar dess statuskod + ev. body i stället för att
    kasta - anroparen avgör vad som räknas som fel."""
    url = f"{config.NPM_API_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            parsed = json.loads(raw) if raw else None
            return resp.status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        return exc.code, parsed
    except Exception as exc:  # noqa: BLE001 - nätverksfel/timeout m.m. = fel, ej krasch
        logger.warning("NPM-API-anrop misslyckades (%s %s): %s", method, path, exc)
        return 0, None


def _token() -> str | None:
    status, data = _api(
        "POST", "/tokens", body={"identity": config.NPM_API_USER, "secret": config.NPM_API_PASS}
    )
    if status != 200 or not data or not data.get("token"):
        logger.warning("NPM-autentisering misslyckades (status %s)", status)
        return None
    return data["token"]


def _find_host(token: str, host: str) -> dict | None:
    status, data = _api("GET", "/nginx/proxy-hosts", token=token)
    if status != 200 or not isinstance(data, list):
        return None
    for entry in data:
        if host in (entry.get("domain_names") or []):
            return entry
    return None


def provision_domain(host: str) -> dict:
    """Skapa cert + proxy-host för `host` om saknas. Returnerar
    {"ok": bool, "skipped": bool, "error": str|None}. Idempotent - en redan
    befintlig proxy-host för domänen räknas som ok utan nyskapande."""
    if not is_configured():
        return {"ok": False, "skipped": True, "error": None}
    try:
        token = _token()
        if not token:
            return {"ok": False, "skipped": False, "error": "Kunde inte logga in mot NPM."}

        existing = _find_host(token, host)
        if existing is not None:
            return {"ok": True, "skipped": False, "error": None}

        cert_status, cert_data = _api(
            "POST",
            "/nginx/certificates",
            token=token,
            body={"provider": "letsencrypt", "domain_names": [host], "meta": {}},
            timeout=120,
        )
        if cert_status not in (200, 201) or not cert_data or not cert_data.get("id"):
            logger.warning("NPM-certskapande misslyckades för %s (status %s): %s", host, cert_status, cert_data)
            return {"ok": False, "skipped": False, "error": "Kunde inte utfärda TLS-certifikat."}
        cert_id = cert_data["id"]

        host_status, host_data = _api(
            "POST",
            "/nginx/proxy-hosts",
            token=token,
            body={
                "domain_names": [host],
                "forward_scheme": "http",
                "forward_host": config.APP_FORWARD_HOST,
                "forward_port": config.APP_FORWARD_PORT,
                "certificate_id": cert_id,
                "ssl_forced": True,
                "http2_support": True,
                "hsts_enabled": True,
                "block_exploits": True,
                "caching_enabled": False,
                "allow_websocket_upgrade": True,
                "access_list_id": 0,
                "advanced_config": "",
                "locations": [],
                "meta": {},
            },
        )
        if host_status not in (200, 201):
            logger.warning("NPM-proxyhost-skapande misslyckades för %s (status %s): %s", host, host_status, host_data)
            return {"ok": False, "skipped": False, "error": "Certifikat skapades men proxy-host kunde inte skapas."}
        return {"ok": True, "skipped": False, "error": None}
    except Exception as exc:  # noqa: BLE001 - provisionering får aldrig krascha requesten
        logger.warning("NPM-provisionering av %s misslyckades: %s", host, exc)
        return {"ok": False, "skipped": False, "error": "Ett oväntat fel inträffade vid provisionering."}


def deprovision_domain(host: str) -> dict:
    """Ta bort proxy-host för `host` (certet lämnas kvar - enklare/säkrare att
    inte städa cert vid varje clear). Returnerar samma form som provision_domain."""
    if not is_configured():
        return {"ok": False, "skipped": True, "error": None}
    try:
        token = _token()
        if not token:
            return {"ok": False, "skipped": False, "error": "Kunde inte logga in mot NPM."}
        existing = _find_host(token, host)
        if existing is None:
            return {"ok": True, "skipped": False, "error": None}
        status, _data = _api("DELETE", f"/nginx/proxy-hosts/{existing['id']}", token=token)
        if status not in (200, 201):
            logger.warning("NPM-borttagning av proxy-host för %s misslyckades (status %s)", host, status)
            return {"ok": False, "skipped": False, "error": "Kunde inte ta bort proxy-host."}
        return {"ok": True, "skipped": False, "error": None}
    except Exception as exc:  # noqa: BLE001
        logger.warning("NPM-deprovisionering av %s misslyckades: %s", host, exc)
        return {"ok": False, "skipped": False, "error": "Ett oväntat fel inträffade vid borttagning."}
