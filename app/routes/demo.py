"""Demo-team-administration: super-admin skapar/låser/återställer, en schemalagd
timer återställer nattligt via en token-autentiserad intern endpoint (in-process)."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app import config
from app.auth import require_admin
from app.database import Project, User, get_db
from app.deps import new_csrf_token, set_csrf_cookie, templates, verify_csrf_form
from app.services import demo

router = APIRouter()


@router.get("/admin/demo", response_class=HTMLResponse)
def demo_page(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> HTMLResponse:
    team = demo.demo_team(db)
    tours = db.query(Project).filter(Project.team_id == team.id).count() if team else 0
    members = db.query(User).filter(User.team_id == team.id).count() if team else 0
    token = new_csrf_token()
    response = templates.TemplateResponse(
        request,
        "admin_demo.html",
        {
            "active": "demo", "team": team, "tours": tours, "members": members,
            "has_seed": demo.has_seed(), "accounts": demo.DEMO_ACCOUNTS,
            "team_slug": demo.DEMO_TEAM_SLUG, "csrf_token": token,
            "msg": request.query_params.get("msg"),
            "error": request.query_params.get("error"),
        },
    )
    set_csrf_cookie(response, token)
    return response


@router.post("/admin/demo/reset")
async def demo_reset(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """Manuell återställning (super-admin). Skapar demo-teamet om det saknas."""
    try:
        r = demo.reset_demo(db)
    except ValueError as exc:
        return RedirectResponse(url=f"/admin/demo?error={quote(str(exc))}", status_code=303)
    msg = f"Demo återställd: {r['restored']} turer återlagda, {r['removed']} rensade."
    return RedirectResponse(url=f"/admin/demo?msg={quote(msg)}", status_code=303)


@router.post("/admin/demo/capture")
async def demo_capture(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    _csrf: None = Depends(verify_csrf_form),
) -> RedirectResponse:
    """"Lås" nuvarande demo-innehåll som guld-seed."""
    try:
        n = demo.capture_seed(db)
    except ValueError as exc:
        return RedirectResponse(url=f"/admin/demo?error={quote(str(exc))}", status_code=303)
    return RedirectResponse(url=f"/admin/demo?msg={quote(f'Seed låst: {n} turer sparade.')}", status_code=303)


@router.post("/internal/demo-reset")
async def demo_reset_internal(
    db: Session = Depends(get_db),
    x_demo_token: str = Header(None),
) -> JSONResponse:
    """Token-autentiserad reset för den schemalagda timern (in-process, ingen session/CSRF).
    Avstängd om SVK_DEMO_RESET_TOKEN är tom -> bara manuell reset."""
    if not config.DEMO_RESET_TOKEN or x_demo_token != config.DEMO_RESET_TOKEN:
        raise HTTPException(status_code=403, detail="Ogiltig token")
    return JSONResponse(demo.reset_demo(db))
