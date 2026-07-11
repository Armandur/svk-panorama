# CLAUDE.md - svk-panorama

Kodbasbeskrivning för Claude. Virtuella 360-turer av kyrkor/kyrkogårdar med
Pannellum. Målet är att göra det lätt för andra att bygga egna avancerade turer:
en **editor** (FastAPI-app under `app/`) som producerar en **self-host-bundle**
(statisk zip). Riktning: self-host-först, SaaS som senare fas. Se `ROADMAP.md`
för faser och `WORKFLOW.md` för fotografens arbetsgång.

## Stack

- **Backend:** Python 3.12 + FastAPI (uvicorn), SQLAlchemy 2 + SQLite, Jinja2.
- **Frontend:** vanilla JS + HTML + CSS, ingen bundler. Pico CSS (`static/vendor/`)
  + `tokens.css`. Filer laddas via `<script>`-taggar.
- **Panorama:** Pannellum (vendored i `app/static/vendor/`, aldrig CDN).
- **Tiling:** pannellums `generate.py` via Docker-imagen `pannellum-multires`.
- Beroenden i `requirements.txt`. Körs via `.venv` (uv).

## Köra

```
SVK_PORT=<port> .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port <port>
```

Ingen `--reload` som standard -> starta om vid Python/mall-ändringar. CSS/JS
serveras från disk med `Cache-Control: no-cache` (syns utan omstart). Verifiera i
browser via hostnamn (`http://ubuntu-ai:PORT`), inte localhost.

## Två separata delar i repot

- **`app/`** - den nya editorn (allt aktivt arbete sker här). Projektdata i
  gitignorade `projects/<slug>/`.
- **`js/`, `css/`, `<xx>/*.html`** - LEGACY: de ~13 gamla produktionsturerna
  (t.ex. `ha/hakg.html` + `js/app.js` + `js/map.js`). Separata från editorn, inte
  migrerade. Rör bara vid uttrycklig begäran. `js/geo.js` återanvänds dock av
  editorn (kartgeometri).

## app/-struktur

```
app/
  main.py            # app, lifespan, static-mounts, router-registrering
  config.py          # konstanter + env-vars (se nedan)
  database.py        # Project-modell + init_db()
  deps.py            # get_db, templates, CSRF (dubbel-cookie), get_project_or_404
  schemas.py         # Pydantic (map-payload)
  routes/            # en fil per domän
    projects.py      # /, /projects (skapa), /projects/{slug} (uppladdning), /delete, /rename-slug
    uploads.py       # POST bilder/kartbild (per-fil, tour.json under asyncio-lås)
    plan.py          # /plan (placering + länkning på kartan) + spara map.json
    scenes.py        # /scenes (kalibrera + hotspots) + spara tour.json
    previews.py      # nedskalade hover-previews (lat genererade)
    tiling.py        # POST /tile-job, GET status, GET /tile-jobs (bulk)
    preview.py       # /preview (förhandsvisa + turinställningar) + /tour-settings
    export.py        # /export (bygg bundle), status, download
    viewer.py        # /view (inloggad runtime-viewer, multires-merge)
    public.py        # /s/{token} publik delad viewer + /s/{token}/{path} assets (ingen auth)
  services/
    project_files.py # filsystemslager: slug, mappar, tour.json/map.json, previews
    tiling.py        # trådat tiling-jobb + manifest + apply_multires()
    bundle.py        # trådat export-jobb: bygger självbärande zip
  templates/         # Jinja2. base.html + steg-mallar + _partials
  static/            # CSS/JS (se nedan) + vendor/ (pannellum, pico)
```

## Editorns arbetsflöde (steg)

`/projects/{slug}` (uppladdning) -> `/plan` (placera + länka på kartan) ->
`/scenes` (kalibrera nordoffset + hotspots) -> `/preview` (turinställningar +
förhandsvisning) -> `/export` (bundle). Tiling startas automatiskt i bakgrunden
efter uppladdning och spåras per tour på huvudmenyn (`/`) och uppladdningssidan.

## Datamodell och sanningskälla

- **`tour.json`** (per projekt) är ren **equirektangulär sanningskälla** -
  scener, hotspots, `default`-block (autoRotate, sceneFadeDuration, firstScene,
  mapSize, theme). Samma format som Pannellum konsumerar.
- **`map.json`** - `scenes[].position{x,y}` (naturliga kartpixlar) + `edges`.
- **Multires läggs på FÖRST vid visning/export** via `apply_multires()` (mergar
  `tiles/manifest.json` in i turen). Så hotspot-ändringar kräver aldrig om-tiling.
- **Kartprickar positioneras i procent** av kartbildens naturliga storlek
  (`x/naturalWidth`) -> upplösningsoberoende. Samma konvention överallt.

### projects/<slug>/ (gitignorat)
```
tour.json  map.json  map.png
images/<id>.jpg         # equirektangulära original
previews/<id>.jpg       # nedskalade hover-previews (lata)
tiles/<id>/...          # multires-kakel
tiles/manifest.json     # multiRes-block per scen
_export/<slug>.zip      # byggd bundle
```

## Bakgrundsjobb (tiling + export)

Båda kör i daemon-trådar med in-memory statusdict per slug, pollade av
status-endpoints. Tiling: `services/tiling.py`, parallellt (`TILE_CONCURRENCY`,
default 2, nona är enkeltrådat), progress härledd ur **skrivna filer** (räknar
`face*.tif` under kubfasen + tile-jpg mot förväntat antal från `generate.py`:s
cube/level-matte). Manifest-skrivning under `_manifest_lock`. Export:
`services/bundle.py`, progress = filer/totalt.

## Bundle-export (self-host-produkten)

`bundle.py` bygger en zip med `index.html` (mallen `bundle_index.html`) +
vendored pannellum + `viewer.js/css` + `tiles/` + `map.png` + originalbilder för
otilade scener + README. **Alla sökvägar relativiseras** (`multiRes.basePath ->
tiles/<id>`, `panorama -> images/<fil>`, assets utan `/static`), så bundlen
fungerar i valfri underkatalog utan server-kod. Verifieras med
`python -m http.server`.

## Runtime-viewern (viewer.js/css)

Path-agnostisk: läser inbäddad `tour`/`map` (JSON-script-taggar), bygger
pannellum, lägger till kartöverlägg (klickbara prickar, aktiv scen markerad).
Applicerar `tour.default.theme` via CSS-variabler (`--tour-font/--dot-color/
--current-dot-color`) + `mapSize` (`data-size` på `#map-container`).
**Länklinjer ritas INTE i turen** - det är en bygghjälp bara i plan-vyn.

## static/-JS (editorn)

- `utils.js` - `apiFetch` (CSRF-header), `showToast`, `escapeHtml`.
- `confirm-modal.js` - stylad bekräftelsedialog som ersätter native `confirm()`.
  `window.confirmDialog(msg, {danger,confirmText}) -> Promise<boolean>` + drop-in för
  `<form data-confirm="..." [data-confirm-danger] [data-confirm-ok="..."]>` (fångar
  submit, frågar, skickar vid ja). Laddas globalt i base.html. Använd detta - inte
  `confirm()`.
- `plan.js` - kartplacering/länkning (zoom/pan, dra länkar, pilar).
- `scene.js` - scenvyn: kalibrering, hotspots, upplösningsväljare (preview/
  multires/full), klickbar+resizebar minikarta.
- `tour-preview.js` - `/preview`: pannellum + turinställningar (live autorotate),
  startscen-väljare (kartmodal + hover-preview), tema.
- `upload.js` - parallell per-fil-uppladdning + previews, startar tiling.
- `tile-status.js` / `index.js` - tiling-status på hemsida / huvudmeny.
- `export.js` - bundle-export-progress.
- `preview.js` (`ScenePreview`) + `settings.js` - delad hover-preview + dess
  inställningar (snurr/riktning/vagg i localStorage). Används av scen- och
  preview-vyn.
- `avatar-crop.js` - `window.initAvatarCrop({modal, openBtn, onOpen})`, generaliserad
  crop-modal (canvas, pan/zoom/rotera -> 256px PNG). Läser POST/DELETE-url ur
  modalens `data-post-url`/`data-delete-url`, slår upp inre element per klass i
  roten -> flera modaler kan samexistera. Mallen `_avatar_modal.html` är
  parameteriserad (defaults = egen profil).
- `account.js` - kontokortets utfällning + kopplar egen avatar-modal till
  `initAvatarCrop`. `admin-user.js` - kopplar admin-avatar-modalen (target-user) på
  `/admin/users/{id}`. `admin-users.js` - batch-markering + åtgärdsrad på
  `/admin/users`.
- `form-validate.js` - inline fältvalidering för lösenordspar (`<form data-pw-form>`
  med `[data-pw-new]`/`[data-pw-confirm]`): röd outline (`aria-invalid`) + `.field-hint`
  vid fältet, servern validerar som fallback. UX-mönster för all fältvalidering.

## Auth + admin (routes/auth.py, admin.py, profile.py)

Sluten inbjudan, session bär `uid`. `User.active` (bool): spärrat konto nekas i
`auth._user_from_session` (session ogiltig) + vid login. `require_admin` gate:ar
`/admin/*`. Admin-detaljsidan `/admin/users/{id}` gör profiländringar på
användarens vägnar (namn/lösenord-override/avatar/active/is_admin, self-guards mot
att spärra/demota sig själv). Batch: `POST /admin/users/batch` (reset_password/
disable/enable/delete). Admin-avatar-routes speglar profile.py (`_process_avatar`
importeras därifrån). Pre-produktion: schemaändring (t.ex. `active`) = radera
svk.db + starta om.

## Publik delning (public.py)

Turer kan delas oautentiserat via en oigissbar `Project.share_token`. `/s/{token}`
renderar samma `viewer.html` som inloggade `/view` men med `asset_base` = `/s/{token}/`
och tour-paths omskrivna dit; `/s/{token}/{path}` serverar råa filer (läs-only,
traversal-guard). Skapa/sluta-dela på preview-steget. Nolla token -> länken dör.

## Inställningar & tjänstenamn (services/settings.py)

Super-admin-konfig som DB-override ovanpå env-default (`Setting`-nyckel/värde-tabell,
`Text`, in-process-cache). Tjänstenamnet (`SVK_SITE_NAME` default) exponeras som
Jinja-globalen `site_name` (brand + titlar), redigeras på `/admin/settings`.
Arbetsgångstexten (`workflow_text`, default = `WORKFLOW.md`) redigeras på
`/admin/settings/texts` med EasyMDE. Mönster för framtida admin-override:bara
inställningar (jfr `TILE_CONCURRENCY`/`BASE_URL`).

## Markdown (static/markdown.js + vendored libs)

`window.renderMarkdown(md)` = marked -> DOMPurify-sanerad HTML (kräver att
`vendor/marked` + `vendor/dompurify` laddats). Redigering via `vendor/easymde`
(EasyMDE, `previewRender` = renderMarkdown) - toolbar-ikoner via `vendor/fontawesome`
(FA 4.7). Renderad markdown stylas med `.markdown-body`. Används av arbetsgångstexten
idag; info-hotspots (rich text) enligt ROADMAP-fas 2-4.

## Env-vars (config.py)

`SVK_PORT` (8002), `SVK_HOST`, `SVK_PROJECTS_DIR` (projects), `SVK_DB_FILE`
(svk.db), `SVK_SECRET_KEY` (annars per-start), `SVK_MAX_PANORAMA_MB` (80),
`SVK_MAX_MAP_MB` (20), `SVK_PREVIEW_MAX_WIDTH` (2048), `SVK_PREVIEW_QUALITY`
(82), `SVK_TILE_CONCURRENCY` (2), `SVK_BASE_URL` (tom; för framtida export/
delningslänkar). `TILE_CONCURRENCY` läses per jobbstart -> justerbart utan
omstart (tänkt admin-UI).

## Fällor att känna till

- **Pannellum-DOM som klon:** `tour` är sanningskälla, ge pannellum KLONER av
  hotspots - annars smutsar DOM-referenser ner datan och bryter JSON vid spara.
- **Pannellum CSS-höjdfälla:** `pannellum.css` laddas EFTER `app.css`, så
  `.pnlm-container{height/width:100%}` slår klass-selektorer med samma
  specificitet. Preview-boxar måste stylas med **ID-selektor** (t.ex.
  `#start-preview`, `#hs-scene-preview`), inte klass, annars kollapsar de.
- **Docker-tiling obuffrat behövs inte** för progress (den härleds ur filer),
  men Docker-imagen `pannellum-multires` måste finnas på värden.
- **Per-slug-isolering:** tiles/manifest/jobb nycklas alltid på slug -> turer med
  samma filnamn krockar aldrig.

## Testning

- `tests/backend_test.py` - plain-assert-tester (ingen pytest) för ren
  backend-logik: tiling-mattematik, multires-merge, bundle-relativisering
  (path-säkerhet), färg-/slug-validering. Kör: `.venv/bin/python tests/backend_test.py`.
- `tools/geo.test.js` - node-tester för kartgeometrin (`js/geo.js`).
- Ingen browser? Verifiera JS-tunga vyer med Playwright via shot-venvet
  (`~/.local/share/shot-venv/bin/python`) - det KAN driva filväljare
  (`set_input_files`); obscura/shot kan inte.

## Dokumentation

`README.md` (vad/kör/deploy), `ROADMAP.md` (faser), `WORKFLOW.md` (fotografens
arbetsgång). Uppdatera denna fil när app-strukturen ändras.
