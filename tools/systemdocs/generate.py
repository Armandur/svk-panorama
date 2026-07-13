"""Systemdocs-generator: bygger EN self-contained HTML-sida (inline CSS + base64-
bäddade skärmdumpar) som visuellt dokumenterar svk-panorama - dels en
funktionsgenomgång av editor-flödet med riktiga skärmdumpar (från en körande
instans), dels en teknisk arkitekturöversikt. Dubblar som kollega-presentation.

Körs med shot-venv (har Playwright):
    ~/.local/share/shot-venv/bin/python tools/systemdocs/generate.py [--slug S] [--base URL] [--no-restart]

STDLIB + playwright bara (via capture.py) - ingen Jinja2, inga app-importer.
Steg 0 startar om instansen mot AKTUELL kod (annars gamla UI:t i skärmdumparna) -
kan hoppas med --no-restart om instansen redan är färsk."""
from __future__ import annotations

import argparse
import base64
import html
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from capture import Session  # noqa: E402
from content import ARCH, STEPS  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "tmp" / "systemdocs.html"
DEFAULT_BASE = "http://ubuntu-ai:8005"
DEFAULT_SLUG = "harnosands-domkyrka"


# ---------------------------------------------------------------- färskhet (steg 0)
def _pid_on_port(port: int) -> int | None:
    """PID för svk-panorama-uvicorn på porten (matchar cmdline så vi aldrig dödar
    fel process). None om ingen sådan hittas."""
    try:
        out = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        return None
    for line in out.splitlines():
        if f":{port} " not in line:
            continue
        # ...users:(("uvicorn",pid=1234,fd=..))
        for tok in line.split("pid="):
            if tok[:1].isdigit():
                pid = int(tok.split(",")[0])
                try:
                    cmd = pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode()
                except OSError:
                    continue
                if "app.main:app" in cmd:
                    return pid
    return None


def ensure_fresh_instance(base: str, port: int) -> subprocess.Popen | None:
    """Starta om svk-panorama på porten mot AKTUELL kod (Python laddas inte om utan
    omstart -> annars visar skärmdumparna gammalt UI). CLAUDE.md tillåter att döda
    svk-panorama på 8005. Returnerar Popen om vi startade en ny (annars None)."""
    secret_file = REPO_ROOT / ".secret_key_dev"
    venv_uvicorn = REPO_ROOT / ".venv" / "bin" / "uvicorn"
    if not venv_uvicorn.exists():
        print("  (hoppar restart: .venv/bin/uvicorn saknas)")
        return None
    old = _pid_on_port(port)
    if old:
        print(f"  dödar gammal instans pid {old}")
        subprocess.run(["kill", str(old)])
        time.sleep(1.5)
    env = {"PATH": "/usr/bin:/bin", "SVK_PORT": str(port)}
    if secret_file.exists():
        env["SVK_SECRET_KEY"] = secret_file.read_text().strip()
    log = open(REPO_ROOT / "dev.log", "ab")
    proc = subprocess.Popen(
        [str(venv_uvicorn), "app.main:app", "--host", "0.0.0.0", "--port", str(port)],
        cwd=str(REPO_ROOT), env=env, stdout=log, stderr=log,
    )
    # polla /login tills 200 (max ~15 s)
    for _ in range(30):
        try:
            with urllib.request.urlopen(base + "/login", timeout=2) as r:
                if r.status == 200:
                    print(f"  ny instans pid {proc.pid} uppe")
                    return proc
        except Exception:
            pass
        time.sleep(0.5)
    print("  VARNING: instansen svarade inte på /login inom tiden")
    return proc


# ---------------------------------------------------------------- HTML
def _img(png: bytes, alt: str) -> str:
    b64 = base64.b64encode(png).decode("ascii")
    # Ingen loading="lazy": bilderna är data-URI:er (ingen nätverkshämtning att skjuta
    # upp), och lazy hindrar under-fold-bilder från att renderas vid full-page-skärmdump/utskrift.
    return f'<img class="shot" src="data:image/png;base64,{b64}" alt="{html.escape(alt)}">'


_CSS = """
:root { color-scheme: light dark; --bg:#fff; --fg:#1c2128; --muted:#5a6472; --card:#f6f8fa; --border:#d0d7de; --accent:#8b0000; --code:#eef1f4; }
@media (prefers-color-scheme: dark){ :root{ --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --card:#161b22; --border:#30363d; --accent:#ff6b6b; --code:#1b2129; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width: 980px; margin: 0 auto; padding: 0 1.1rem 5rem; }
header.hero { padding: 2.6rem 0 1.6rem; border-bottom: 3px solid var(--accent); margin-bottom: 1.5rem; }
h1 { font-size: 2.1rem; margin: 0 0 .35rem; letter-spacing:-.01em; }
.sub { color: var(--muted); margin: 0; max-width: 60ch; }
.toc { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:1rem 1.2rem; margin:1.5rem 0; }
.toc h3 { margin:.1rem 0 .6rem; font-size:.85rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.toc ol { margin:0; padding-left:1.2rem; columns:2; column-gap:2rem; }
.toc a { color:inherit; text-decoration:none; } .toc a:hover { color:var(--accent); text-decoration:underline; }
.part-head { font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; color:var(--accent); margin:3rem 0 .2rem; font-weight:700; }
h2 { font-size:1.35rem; margin:.4rem 0 .5rem; scroll-margin-top:1rem; }
.step .desc, .arch .body { color:var(--fg); }
.step .desc { margin:.2rem 0 .8rem; max-width:70ch; }
figure { margin:.6rem 0 0; }
.shot { width:100%; height:auto; border:1px solid var(--border); border-radius:10px; display:block; box-shadow:0 1px 4px rgba(0,0,0,.08); }
figcaption { color:var(--muted); font-size:.85rem; margin-top:.45rem; font-family:ui-monospace,monospace; }
.arch { border-top:1px solid var(--border); padding-top:.4rem; margin-top:1.6rem; }
.arch .body { max-width:74ch; }
code { background:var(--code); padding:.08em .35em; border-radius:4px; font-size:.9em; font-family:ui-monospace,SFMono-Regular,monospace; }
ul { margin:.4rem 0; } li { margin:.15rem 0; }
footer { margin-top:4rem; padding-top:1.2rem; border-top:1px solid var(--border); color:var(--muted); font-size:.85rem; }
@media (max-width:640px){ .toc ol{columns:1;} h1{font-size:1.7rem;} }
"""


def _slugify_id(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")


def build_html(step_sections: list[tuple[str, str]], arch_sections: list[tuple[str, str]], meta: str) -> str:
    toc_items = "".join(
        f'<li><a href="#{_slugify_id(t)}">{html.escape(t)}</a></li>' for t, _ in step_sections + arch_sections
    )
    body = []
    body.append('<p class="part-head">Del 1 &middot; Funktionsgenomgång</p>')
    for title, sec in step_sections:
        body.append(sec)
    body.append('<p class="part-head">Del 2 &middot; Teknisk arkitektur</p>')
    for title, sec in arch_sections:
        body.append(sec)
    return (
        "<!doctype html><html lang=sv><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>svk-panorama - systemöversikt</title>"
        f"<style>{_CSS}</style></head><body><div class=wrap>"
        "<header class=hero><h1>svk-panorama</h1>"
        "<p class=sub>Systemöversikt och funktionsgenomgång - virtuella 360-turer av kyrkor och "
        "kyrkogårdar (Pannellum). Skärmdumparna nedan är fångade ur en körande instans.</p></header>"
        f'<nav class="toc"><h3>Innehåll</h3><ol>{toc_items}</ol></nav>'
        + "".join(body)
        + f"<footer>{meta}</footer>"
        "</div></body></html>"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default=DEFAULT_SLUG)
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--no-restart", action="store_true")
    args = ap.parse_args()

    port = int(args.base.rsplit(":", 1)[-1].split("/")[0]) if ":" in args.base.rsplit("/", 1)[-1] else 8005

    if not args.no_restart:
        print("Steg 0: säkerställer färsk instans (aktuell kod)...")
        ensure_fresh_instance(args.base, port)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    step_sections: list[tuple[str, str]] = []
    with Session(args.base) as s:
        for step in STEPS:
            path = step["path"].format(slug=args.slug)
            print(f"  fångar {step['key']}: {path}")
            try:
                png = s.capture(path, wait_ms=step.get("wait_ms", 1500))
            except Exception as exc:
                print(f"    VARNING: misslyckades ({exc}) - hoppar")
                continue
            sid = _slugify_id(step["title"])
            sec = (
                f'<section class="step"><h2 id="{sid}">{html.escape(step["title"])}</h2>'
                f'<p class="desc">{step["desc"]}</p>'
                f'<figure>{_img(png, step["title"])}'
                f'<figcaption>{step["caption"]}</figcaption></figure></section>'
            )
            step_sections.append((step["title"], sec))

    arch_sections: list[tuple[str, str]] = []
    for a in ARCH:
        sid = _slugify_id(a["title"])
        sec = (
            f'<section class="arch"><h2 id="{sid}">{html.escape(a["title"])}</h2>'
            f'<div class="body">{a["body"]}</div></section>'
        )
        arch_sections.append((a["title"], sec))

    meta = (
        f"Genererad ur en körande instans ({html.escape(args.base)}, tur "
        f"<code>{html.escape(args.slug)}</code>). Skärmdumparna speglar koden vid "
        "genereringstillfället; arkitekturtexten underhålls manuellt (tools/systemdocs/content.py)."
    )
    OUT.write_text(build_html(step_sections, arch_sections, meta), encoding="utf-8")
    print(f"skrev {OUT} ({OUT.stat().st_size // 1024} KB, {len(step_sections)} skärmdumpar)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
