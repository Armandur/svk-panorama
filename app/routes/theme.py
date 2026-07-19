"""Tema-förhandsvisning: en dev-/designyta som visar alla vanliga komponenter med
appens tema (Pico + tokens.css), så man kan syna accent/knappar i ljust och mörkt
läge. Inte del av det publika flödet - kräver inloggning."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.auth import require_user
from app.database import User
from app.deps import templates

router = APIRouter()


@router.get("/theme-preview", response_class=HTMLResponse)
def theme_preview(request: Request, user: User = Depends(require_user)):
    return templates.TemplateResponse(request, "theme_preview.html", {})
