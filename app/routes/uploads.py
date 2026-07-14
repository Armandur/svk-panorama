"""Uppladdning av panoramabilder och kartbild."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse

from app import config
from app.database import Project
from app.deps import get_editor, get_project_or_404, verify_csrf_form
from app.services.project_files import (
    clear_preview,
    ensure_project_structure,
    images_dir,
    map_image_path,
    merge_scene_into_tour,
    read_tour,
    remove_scene,
    safe_upload_name,
    scene_id_from_filename,
    tour_lock,
    validate_extension,
    validate_image_dimensions,
    validate_image_magic,
    validate_size,
    write_tour,
)
from app.services.tiling import drop_scene_tiles

router = APIRouter()


@router.post("/projects/{slug}/images")
async def upload_images(
    request: Request,
    slug: str,
    files: list[UploadFile] = File(...),
    project: Project = Depends(get_project_or_404),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_form),
):
    if not files:
        raise HTTPException(status_code=400, detail="Inga filer valda")

    ensure_project_structure(slug)
    scene_ids = []

    for upload in files:
        filename = safe_upload_name(upload.filename or "")
        validate_extension(filename, config.ALLOWED_PANORAMA_EXT)
        scene_id = scene_id_from_filename(filename)
        if not scene_id:
            raise HTTPException(status_code=400, detail=f"Ogiltigt filnamn: {filename}")

        content = await upload.read()
        validate_size(content, filename, config.MAX_PANORAMA_MB)
        validate_image_magic(content, filename)
        validate_image_dimensions(content, filename)

        dest = images_dir(slug) / filename
        dest.write_bytes(content)
        clear_preview(slug, scene_id)  # regenereras lat om bilden ersattes
        drop_scene_tiles(slug, scene_id)  # ev. tiles blir stale om bilden bytts

        panorama_url = f"/projects/{slug}/images/{filename}"
        # Per fil: delat lås runt läs-modifiera-skriv så parallella uppladdningar
        # (och samtidig radering/scen-spar i andra routes) inte skriver över
        # varandras scener. Kort synkron sektion, ingen await inuti.
        with tour_lock:
            tour = read_tour(slug)
            merge_scene_into_tour(tour, scene_id, panorama_url)
            write_tour(slug, tour, editor=editor)
        scene_ids.append(scene_id)

    # Fetch-anrop (async uppladdning i webbläsaren) får JSON med scen-id:n så
    # klienten kan för-generera previews med progress. Vanlig formulärpost
    # (utan JS) faller tillbaka på redirect.
    if "application/json" in request.headers.get("accept", ""):
        return JSONResponse({"scenes": scene_ids})
    return RedirectResponse(url=f"/projects/{slug}", status_code=302)


@router.post("/projects/{slug}/map-image")
async def upload_map_image(
    request: Request,
    slug: str,
    file: UploadFile = File(...),
    project: Project = Depends(get_project_or_404),
    _csrf: None = Depends(verify_csrf_form),
):
    filename = file.filename or ""
    validate_extension(filename, config.ALLOWED_MAP_EXT)
    content = await file.read()
    validate_size(content, filename, config.MAX_MAP_MB)
    validate_image_magic(content, filename)
    validate_image_dimensions(content, filename)

    ensure_project_structure(slug)
    map_image_path(slug).write_bytes(content)

    if "application/json" in request.headers.get("accept", ""):
        return JSONResponse({"ok": True})
    return RedirectResponse(url=f"/projects/{slug}", status_code=302)


@router.post("/projects/{slug}/images/{scene_id}/delete")
def delete_image(
    slug: str,
    scene_id: str,
    project: Project = Depends(get_project_or_404),
    editor: dict = Depends(get_editor),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    with tour_lock:
        remove_scene(slug, scene_id, editor=editor)
    drop_scene_tiles(slug, scene_id)
    return RedirectResponse(url=f"/projects/{slug}", status_code=302)
