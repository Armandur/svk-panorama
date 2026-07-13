"""Playwright-drivning för systemdocs-generatorn: loggar in mot en körande
svk-panorama-instans och fångar riktiga skärmdumpar av editorns steg/vyer.

Körs under shot-venv (~/.local/share/shot-venv/bin/python) som har Playwright +
Chromium - INTE appens .venv. Därför: stdlib + playwright bara, inga app-importer,
ingen Jinja2. Pannellum är WebGL (swiftshader headless) -> vänta med wait_ms, inte
networkidle (en öppen render-loop settlar aldrig)."""
from __future__ import annotations

from playwright.sync_api import sync_playwright


def _login(page, base: str, email: str = "admin", password: str = "admin") -> None:
    """Logga in via formuläret (hidden csrf_token följer med i posten). Fältnamn
    email/password speglar routes/auth.py:login."""
    page.goto(base + "/login", wait_until="domcontentloaded")
    page.fill('input[name="email"]', email)
    page.fill('input[name="password"]', password)
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle")


class Session:
    """En inloggad browser-session. `capture()` navigerar + skärmdumpar en vy;
    `before`-callbacken kan öppna en modal/scrolla innan bilden tas."""

    def __init__(self, base: str, width: int = 1400, height: int = 900):
        self.base = base.rstrip("/")
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(args=["--no-sandbox"])
        self.ctx = self.browser.new_context(viewport={"width": width, "height": height})
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(30000)
        _login(self.page, self.base)

    def capture(self, path: str, wait_ms: int = 1500, before=None, full_page: bool = False,
                selector: str | None = None) -> bytes:
        self.page.goto(self.base + path, wait_until="load")
        self.page.wait_for_timeout(wait_ms)
        if before:
            before(self.page)
            self.page.wait_for_timeout(400)
        if selector:
            return self.page.locator(selector).screenshot()
        return self.page.screenshot(full_page=full_page)

    def close(self) -> None:
        self.browser.close()
        self._pw.stop()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
