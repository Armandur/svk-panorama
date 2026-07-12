"""Delad mediepool per ägare (mediebibliotek v2): bilder till info-hotspots
markdown, återanvändbara mellan projekt. Lagras platt under
`media/<owner_id>/<name>` och refereras med absoluta, oigissbara capability-URL:er
`/media/<owner_id>/<name>` som funkar identiskt i editorn, publika /s-vyn och den
exporterade bundlen (ingen URL-omskrivning behövs). "Ägare" = User nu, Team i Fas 4.

Ingen DB-tabell: metadata härleds ur filsystemet (stat + PIL) och användning
skannas ur ägarens tur-JSON vid behov."""
from __future__ import annotations

import re
import secrets
from pathlib import Path
from typing import Any

from PIL import Image

from app import config
from app.services.project_files import read_tour

# Filnamnstecken vi tillåter i en poolreferens (matchar hex-prefix + saniterat
# basnamn). Används för usage-scan och bundle-relativisering.
_NAME_CHARS = r"[A-Za-z0-9._-]+"
_UNSAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_suffix(orig_name: str) -> str:
    """Kosmetiskt, traversal-säkert basnamn för lagring. Till skillnad från
    project_files.safe_upload_name (som avvisar t.ex. mellanslag hårt för
    panorama-filer) SANERAR vi här godtyckliga namn - hex-prefixet i store()
    garanterar unikhet, så namnet är bara till för läsbarhet i biblioteket."""
    stem = Path(orig_name or "").name
    stem = _UNSAFE_RE.sub("-", stem).strip("-.")
    return stem or "bild"


def owner_dir(owner_id: int) -> Path:
    return config.MEDIA_DIR / str(owner_id)


def media_url(owner_id: int, name: str) -> str:
    return f"/media/{owner_id}/{name}"


def store(owner_id: int, orig_name: str, content: bytes) -> str:
    """Spara innehåll i ägarens pool, returnera det oigissbara filnamnet."""
    d = owner_dir(owner_id)
    d.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(6) + "-" + _safe_suffix(orig_name)
    (d / name).write_bytes(content)
    return name


def resolve(owner_id: int, name: str) -> Path | None:
    """Traversal-säker upplösning: returnera filsökväg om `name` är en fil direkt
    i ägarens poolmapp, annars None."""
    base = owner_dir(owner_id).resolve()
    if not base.exists():
        return None
    target = (base / name).resolve()
    if target.parent != base or not target.is_file():
        return None
    return target


def _dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as im:
            return im.width, im.height
    except Exception:
        return None, None


def list_pool(owner_id: int) -> list[dict[str, Any]]:
    """Ägarens poolbilder, nyast först, med metadata (pixlar/storlek/mtime)."""
    d = owner_dir(owner_id)
    items: list[dict[str, Any]] = []
    if d.exists():
        for f in sorted(d.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if f.is_file():
                st = f.stat()
                w, h = _dimensions(f)
                items.append({
                    "name": f.name,
                    "url": media_url(owner_id, f.name),
                    "size": st.st_size,
                    "width": w,
                    "height": h,
                    "mtime": st.st_mtime,
                })
    return items


def delete(owner_id: int, name: str) -> bool:
    target = resolve(owner_id, name)
    if target is None:
        return False
    target.unlink()
    return True


def scan_usage(owner_id: int, projects: list[tuple[str, str]]) -> dict[str, list[dict[str, Any]]]:
    """Härled var varje poolbild används, PER SCEN. `projects` = [(slug, project_name)].
    Räknar förekomster av `/media/<owner_id>/<fil>` i varje scens hotspot-text/body.
    Returnerar {filnamn: [{slug, project, scene_id, scene_title, count}]} - en post
    per (tur, scen) som refererar bilden, för breadcrumbs i biblioteket."""
    pattern = re.compile(re.escape(f"/media/{owner_id}/") + f"({_NAME_CHARS})")
    usage: dict[str, list[dict[str, Any]]] = {}
    for slug, pname in projects:
        try:
            tour = read_tour(slug)
        except Exception:
            continue
        for scene_id, scene in tour.get("scenes", {}).items():
            counts: dict[str, int] = {}
            for hs in scene.get("hotSpots", []):
                for key in ("text", "body"):
                    val = hs.get(key)
                    if isinstance(val, str):
                        for m in pattern.finditer(val):
                            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
            for name, count in counts.items():
                usage.setdefault(name, []).append({
                    "slug": slug,
                    "project": pname,
                    "scene_id": scene_id,
                    "scene_title": scene.get("title") or "",
                    "count": count,
                })
    return usage
