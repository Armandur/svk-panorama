"""Projekt-backup: exportera en hel REDIGERBAR tur som zip (rådata) och importera
den i en annan instans. Skiljer sig från bundle.py (self-host VISNINGS-bundle) -
detta är källdata som återskapas som ett redigerbart projekt.

Arkiv: project.json (manifest) + tour.json + map.json + map.png + images/ +
tiles/ (+ manifest.json) + media/ (refererade poolbilder). Vid import kopieras
media in i importörens pool och referenserna i tour.json skrivs om till nya
owner_id; `/projects/<gammal-slug>/` skrivs om till den nya slugen."""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import zipfile
from pathlib import Path
from typing import Any

from app.database import Project
from app.services import media
from app.services.project_files import (
    ensure_project_structure,
    project_dir,
    slugify,
    tour_json_path,
)
from app.services.tiling import manifest_path as tiles_manifest_path

FORMAT = "svk-project"
VERSION = 1
_MEDIA_REF_RE = re.compile(r"/media/(\d+)/([A-Za-z0-9._-]+)")
# Tillåtna arcnames i arkivet (ingen absolut väg / ".." / konstiga tecken).
_SAFE_ARC_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
_STORED_EXT = {".jpg", ".jpeg", ".png", ".tif"}

_jobs: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def backup_dir(slug: str) -> Path:
    return project_dir(slug) / "_backup"


def zip_path(slug: str) -> Path:
    return backup_dir(slug) / f"{slug}-projekt.zip"


def forget_job(slug: str) -> None:
    with _lock:
        _jobs.pop(slug, None)


def _read_tour(slug: str) -> dict:
    p = tour_json_path(slug)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _media_refs(tour: dict) -> set[tuple[int, str]]:
    refs: set[tuple[int, str]] = set()
    for scene in tour.get("scenes", {}).values():
        for hs in scene.get("hotSpots", []):
            for key in ("text", "body"):
                v = hs.get(key)
                if isinstance(v, str):
                    for m in _MEDIA_REF_RE.finditer(v):
                        refs.add((int(m.group(1)), m.group(2)))
    return refs


def _collect(slug: str, tour: dict) -> list[tuple[str, Path]]:
    files: list[tuple[str, Path]] = []
    pd = project_dir(slug)
    for name in ("tour.json", "map.json", "map.png"):
        p = pd / name
        if p.exists():
            files.append((name, p))
    for sub in ("images", "tiles"):
        d = pd / sub
        if d.exists():
            for f in d.rglob("*"):
                if f.is_file():
                    files.append((sub + "/" + f.relative_to(d).as_posix(), f))
    # Refererade poolbilder (inte hela poolen) -> media/<namn>.
    for owner_id, mname in _media_refs(tour):
        src = media.resolve(owner_id, mname)
        if src is not None:
            files.append(("media/" + mname, src))
    return files


# --- Export ---------------------------------------------------------------
def _build(slug: str, name: str) -> None:
    job = _jobs[slug]
    try:
        tour = _read_tour(slug)
        manifest = {"format": FORMAT, "version": VERSION, "slug": slug, "name": name}
        files = _collect(slug, tour)
        job["total"] = len(files) + 1
        backup_dir(slug).mkdir(parents=True, exist_ok=True)
        tmp = zip_path(slug).with_suffix(".tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("project.json", json.dumps(manifest, ensure_ascii=False))
            job["done"] += 1
            for arc, path in files:
                ctype = zipfile.ZIP_STORED if path.suffix.lower() in _STORED_EXT else zipfile.ZIP_DEFLATED
                z.write(path, arc, compress_type=ctype)
                job["done"] += 1
        tmp.replace(zip_path(slug))
        job["status"] = "done"
    except Exception as exc:  # noqa: BLE001 - visa felet i UI:t
        job["status"] = "error"
        job["error"] = str(exc)


def start_export(slug: str, name: str) -> dict[str, Any]:
    with _lock:
        existing = _jobs.get(slug)
        if existing and existing["status"] == "running":
            return existing
        job = {"status": "running", "total": 0, "done": 0, "error": None}
        _jobs[slug] = job
    threading.Thread(target=_build, args=(slug, name), daemon=True).start()
    return job


def state(slug: str) -> dict[str, Any]:
    return {"job": _jobs.get(slug), "hasZip": zip_path(slug).exists()}


# --- Import ---------------------------------------------------------------
def _validate_members(zf: zipfile.ZipFile) -> None:
    """Zip-slip-skydd: alla arcnames måste vara relativa och ofarliga."""
    for info in zf.infolist():
        n = info.filename
        if n.endswith("/"):
            continue
        if n.startswith("/") or ".." in n.split("/") or not _SAFE_ARC_RE.match(n):
            raise ValueError(f"Osäker sökväg i arkivet: {n}")


def _unique_slug(db, base: str) -> str:
    slug = base or "importerad-tur"
    suffix = 2
    while db.query(Project).filter(Project.slug == slug).first() is not None:
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def import_project(src_zip: Path, user, db) -> Project:
    """Importera ett projektarkiv som ett nytt projekt ägt av `user`.
    Returnerar det skapade Project. Höjer ValueError vid ogiltigt/osäkert arkiv."""
    with zipfile.ZipFile(src_zip) as z:
        try:
            manifest = json.loads(z.read("project.json"))
        except KeyError:
            raise ValueError("Inte ett giltigt projektarkiv (saknar project.json).")
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Skadat projektarkiv (project.json går inte att läsa).")
        if manifest.get("format") != FORMAT:
            raise ValueError("Okänt arkivformat - inte ett svk-projektarkiv.")
        _validate_members(z)

        old_slug = str(manifest.get("slug") or "")
        name = (manifest.get("name") or old_slug or "Importerad tur").strip() or "Importerad tur"
        slug = _unique_slug(db, slugify(old_slug or name))

        project = Project(slug=slug, name=name, owner_id=user.id)
        db.add(project)
        db.commit()

        ensure_project_structure(slug)
        pd = project_dir(slug).resolve()
        pool = media.owner_dir(user.id)

        for info in z.infolist():
            n = info.filename
            if n.endswith("/") or n == "project.json":
                continue
            if n.startswith("media/"):
                mname = n[len("media/"):]
                if "/" in mname or not mname:
                    raise ValueError(f"Osäkert medienamn: {n}")
                pool.mkdir(parents=True, exist_ok=True)
                with z.open(info) as srcf, open(pool / mname, "wb") as dst:
                    shutil.copyfileobj(srcf, dst)
                continue
            target = (pd / n).resolve()
            if os.path.commonpath([str(pd), str(target)]) != str(pd):
                raise ValueError(f"Osäker sökväg i arkivet: {n}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as srcf, open(target, "wb") as dst:
                shutil.copyfileobj(srcf, dst)

    _rewrite_refs(slug, old_slug, user.id)
    return project


def _rewrite_refs(new_slug: str, old_slug: str, owner_id: int) -> None:
    """Skriv om `/projects/<gammal-slug>/` -> nya slugen och media-referensernas
    owner_id -> importörens, i tour.json + tiles/manifest.json."""
    for path in (tour_json_path(new_slug), tiles_manifest_path(new_slug)):
        if not path.exists():
            continue
        txt = path.read_text(encoding="utf-8")
        if old_slug:
            txt = txt.replace(f"/projects/{old_slug}/", f"/projects/{new_slug}/")
        txt = _MEDIA_REF_RE.sub(lambda m: f"/media/{owner_id}/{m.group(2)}", txt)
        path.write_text(txt, encoding="utf-8")
