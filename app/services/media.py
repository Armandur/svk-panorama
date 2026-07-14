"""Delad mediepool per ägare (mediebibliotek v2): bilder till info-hotspots
markdown, återanvändbara mellan projekt. Lagras platt under
`media/<owner>/<name>` och refereras med absoluta, oigissbara capability-URL:er
`/media/<owner>/<name>` som funkar identiskt i editorn, publika /s-vyn och den
exporterade bundlen (ingen URL-omskrivning behövs).

**Ägar-nyckel (`owner`, sträng):** `str(user_id)` för en solo-användare, eller
`team-<team_id>` för ett team (Fas 4 - delad pool inom teamet). Team-prefixet
undviker att User.id och Team.id kolliderar på samma numeriska katalog. Nyckeln
byggs av deps.resource_owner_key(user); serveringsrouten validerar formatet.

Ingen DB-tabell: metadata härleds ur filsystemet (stat + PIL) och användning
skannas ur ägarens tur-JSON vid behov."""
from __future__ import annotations

import os
import re
import secrets
from pathlib import Path
from typing import Any

from PIL import Image

from app import config
from app.services.presets import i18n_text_values
from app.services.project_files import read_tour

# Filnamnstecken vi tillåter i en poolreferens (matchar hex-prefix + saniterat
# basnamn). Används för usage-scan och bundle-relativisering.
_NAME_CHARS = r"[A-Za-z0-9._-]+"
_UNSAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")
# Lagrat namn = token_hex(6) + "-" + saniterat originalnamn. Strippa prefixet för
# ett läsbart visningsnamn (originalfilen, saniterad).
_HEX_PREFIX_RE = re.compile(r"^[0-9a-f]{12}-")

# Giltig ägar-nyckel: rena siffror (user-id) eller team-<siffror>. Serve-routen tar
# nyckeln ur URL:en -> validera mot traversal (`..`, snedstreck m.m.).
OWNER_KEY_RE = re.compile(r"^(team-)?[0-9]+$")


def valid_owner_key(owner: str) -> bool:
    return bool(OWNER_KEY_RE.match(owner))


def display_name(name: str) -> str:
    return _HEX_PREFIX_RE.sub("", name)


def _safe_suffix(orig_name: str) -> str:
    """Kosmetiskt, traversal-säkert basnamn för lagring. Till skillnad från
    project_files.safe_upload_name (som avvisar t.ex. mellanslag hårt för
    panorama-filer) SANERAR vi här godtyckliga namn - hex-prefixet i store()
    garanterar unikhet, så namnet är bara till för läsbarhet i biblioteket."""
    stem = Path(orig_name or "").name
    stem = _UNSAFE_RE.sub("-", stem).strip("-.")
    return stem or "bild"


def owner_dir(owner: str) -> Path:
    return config.MEDIA_DIR / owner


def media_url(owner: str, name: str) -> str:
    return f"/media/{owner}/{name}"


def store(owner: str, orig_name: str, content: bytes) -> str:
    """Spara innehåll i ägarens pool, returnera det oigissbara filnamnet."""
    d = owner_dir(owner)
    d.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(6) + "-" + _safe_suffix(orig_name)
    (d / name).write_bytes(content)
    return name


def resolve(owner: str, name: str) -> Path | None:
    """Traversal-säker upplösning: returnera filsökväg om `name` är en fil direkt
    i ägarens poolmapp, annars None. Ogiltig ägar-nyckel -> None."""
    if not valid_owner_key(owner):
        return None
    base = owner_dir(owner).resolve()
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


# Nedskalade tumnaglar (cachas på disk) så biblioteket inte laddar fullstora
# panorama i rutnätet. Ligger i en dold undermapp så list_pool inte listar dem.
THUMB_MAX = 480


def _thumb_dir(owner: str) -> Path:
    return owner_dir(owner) / ".thumbs"


def thumb_url(owner: str, name: str) -> str:
    return f"/media/{owner}/thumb/{name}"


def ensure_thumb(owner: str, name: str) -> Path | None:
    """Returnera (och generera vid behov) en JPEG-tumnagel för poolbilden.
    Poolnamn är unika/oföränderliga -> tumnageln blir aldrig stale. Faller
    tillbaka på originalet om PIL inte kan läsa bilden."""
    src = resolve(owner, name)
    if src is None:
        return None
    dst = _thumb_dir(owner) / (name + ".jpg")
    if dst.exists():
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    # Atomisk skrivning (temp + os.replace) så en samtidig läsare aldrig ser en
    # halvskriven tumnagel som sedan cachas permanent (dst.exists() kortsluter).
    tmp = dst.parent / (dst.name + "." + secrets.token_hex(4) + ".tmp")
    try:
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((THUMB_MAX, THUMB_MAX))
            im.save(tmp, "JPEG", quality=80)
        os.replace(tmp, dst)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        return src
    return dst


def list_pool(owner: str) -> list[dict[str, Any]]:
    """Ägarens poolbilder, nyast först, med metadata (pixlar/storlek/mtime)."""
    d = owner_dir(owner)
    items: list[dict[str, Any]] = []
    if d.exists():
        for f in sorted(d.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if f.is_file():
                st = f.stat()
                w, h = _dimensions(f)
                items.append({
                    "name": f.name,
                    "orig": display_name(f.name),
                    "url": media_url(owner, f.name),
                    "thumb": thumb_url(owner, f.name),
                    "size": st.st_size,
                    "width": w,
                    "height": h,
                    "mtime": st.st_mtime,
                })
    return items


def delete(owner: str, name: str) -> bool:
    target = resolve(owner, name)
    if target is None:
        return False
    target.unlink()
    thumb = _thumb_dir(owner) / (name + ".jpg")
    if thumb.exists():
        try:
            thumb.unlink()
        except OSError:
            pass
    return True


def scan_usage(owner: str, projects: list[tuple[str, str]]) -> dict[str, list[dict[str, Any]]]:
    """Härled var varje poolbild används, PER SCEN. `projects` = [(slug, project_name)].
    Räknar förekomster av `/media/<owner>/<fil>` i varje scens hotspot-text/body.
    Returnerar {filnamn: [{slug, project, scene_id, scene_title, count}]} - en post
    per (tur, scen) som refererar bilden, för breadcrumbs i biblioteket."""
    pattern = re.compile(re.escape(f"/media/{owner}/") + f"({_NAME_CHARS})")
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
                    for val in i18n_text_values(hs.get(key)):
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
