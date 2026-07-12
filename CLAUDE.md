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
- **Panorama:** Pannellum (vendored i `app/static/vendor/`, aldrig CDN). **Slå upp
  API/exempel i pannellums dokumentation** (https://pannellum.org/documentation/overview/)
  när du jobbar med hotspots, tooltips, config m.m. - t.ex. `createTooltipFunc`,
  `clickHandlerFunc`, `cssClass` (OBS: `cssClass` ERSÄTTER default-klasserna, ta med
  `pnlm-hotspot pnlm-info` själv). Gissa inte på pannellum-beteende, kolla docs.
- **Tiling:** pannellums `generate.py` via Docker-imagen `pannellum-multires`.
- Beroenden i `requirements.txt`. Körs via `.venv` (uv).

## Köra

```
SVK_PORT=<port> .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port <port>
```

Ingen `--reload` som standard -> starta om vid Python/mall-ändringar. CSS/JS
serveras från disk med `Cache-Control: no-cache` (syns utan omstart). Verifiera i
browser via hostnamn (`http://ubuntu-ai:PORT`), inte localhost.

**Verifiera alltid mot en aktuell egen instans - håll dig till EN port (8005).**
En redan körande instans kör ofta gammal kod (processen startades före dina
ändringar; Python/route-kod laddas inte om utan omstart) -> verifiera aldrig mot
den utan att först starta om den mot aktuell kod. Du har alltid rätt att döda
tidigare svk-panorama-instanser (även från tidigare sessioner) och starta om på
samma port. Mönster: `kill` gamla 8005-PID -> starta `SVK_PORT=8005
SVK_SECRET_KEY=$(cat .secret_key_dev) .venv/bin/uvicorn app.main:app --port 8005`
i bakgrunden (login admin/admin överlever mot delad svk.db) -> `svc update
svk-panorama-skiva3 --pid <ny>`. Starta om efter Python/mall-ändringar (CSS/JS
syns direkt). Okej att starta om mellan `/clear` - instansen är efemär.

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
    backup.py        # /backup (redigerbar projekt-zip) + /projects/import
    presets.py       # /presets tema-/inställningsförinställningar per ägare
    viewer.py        # /view (inloggad runtime-viewer, multires-merge)
    public.py        # /s/{token} publik delad viewer + /s/{token}/{path} assets (ingen auth)
    media.py         # /media delad mediepool per ägare (upload/list/delete + capability-serve)
  services/
    project_files.py # filsystemslager: slug, mappar, tour.json/map.json, previews
    tiling.py        # trådat tiling-jobb + manifest + apply_multires()
    bundle.py        # trådat export-jobb: bygger självbärande zip
    backup.py        # projekt-backup: exportera/importera REDIGERBAR projekt-zip
    presets.py       # tema-/inställningsförinställningar (list/save/delete/default + sanering)
    media.py         # delad mediepool: lagring, metadata (PIL), usage-scan
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

## Projekt-backup/import (services/backup.py, routes/backup.py)

Skilt från bundle-exporten (visnings-produkt): en **redigerbar** projekt-zip för
backup / att flytta en tur mellan instanser. Innehåller RÅDATA: `project.json`
(manifest: format `svk-project`, slug, name) + tour.json + map.json + map.png +
`images/` + `tiles/` (+ manifest) + `media/` (bara REFERERADE poolbilder).
Export: trådat jobb (som bundle), `POST /projects/{slug}/backup` + status/download,
knapp på preview-steget (`backup.js`). Import: `POST /projects/import` (uppladdning),
`import_project()` skapar nytt Project (unik slug), extraherar med **zip-slip-guard**
(`_validate_members` + commonpath), kopierar media in i importörens pool och skriver
om referenser: `/projects/<gammal-slug>/` -> nya slugen och `/media/<gammal-owner>/`
-> importörens owner_id (i tour.json + tiles/manifest.json). UI: import-knapp på
startsidan (`import-project.js`) -> redirect till nya turen. `_backup/`-zip i
projektmappen (gitignorad).

## Tema-förinställningar (ThemePreset, services/presets.py, routes/presets.py)

Namngivna tema-/inställnings-presets per ägare (`theme_presets`-tabell). `config`
= JSON-subset av `tour.default` (autoRotate, delays, sceneFade, mapSize,
theme{font,dotColor,currentColor}) - INTE firstScene. Saneras vid spar
(`sanitize_config`, hex/enum/clamp). En kan vara `is_default` -> **nya turer ärver
den** (create_project mergar `default_config()` in i tour.default). ThemePreset är
en ADDITIV ny tabell -> `create_all` skapar den utan att röra befintlig data (ingen
svk.db-blåsning behövdes, till skillnad från kolumn-ändringar). Branding ingår INTE
i tema-preseten (`sanitize_config` droppar den) - det är en egen mall:

**Branding-mallar (BrandingPreset, egen tabell).** Skild från ThemePreset så
org-identitet (logga) återanvänds oberoende av temat. `config` = JSON
{content,size,position} (`sanitize_branding`). Samma CRUD-mönster (list/save/
delete/set_default, generiska `_list/_save/_delete/_set_default/_default_row` i
presets.py delas av båda tabellerna). Endpoints `/branding-presets*` (routes/
presets.py). En kan vara `is_default` -> nya turer ärver den (`create_project`
lägger `default_branding()` på `tour.default.branding`, skilt från tema-arvet).
Additiv tabell -> `create_all` (ingen blåsning). Update-by-id: `update_preset`/
`update_branding_preset` + `POST /presets/{id}` och `/branding-presets/{id}`
(stödjer namnbyte, till skillnad från upsert-by-name-`save`).

**Mall-bibliotek (preset-library.js, /mallar).** Delad DRY-komponent (som
media-library.js) `mountPresetLibrary(container, opts)` driver BÅDA ytorna:
`window.initPresetManager` = `/mallar`-sidan (hantera: kort med förhandsvisning +
Redigera/Radera/★-standard; schematiska tema-kort med färgrutor/typsnittsprov/badges,
branding-kort med renderad overlay via `renderBrandingInto`), `window.openPresetLibrary
({onPickTheme,onPickBranding})` = väljar-modal på preview-steget (Använd applicerar +
stänger, ingen Redigera). Route `GET /mallar` (require_user, CSRF), nav-länk "Mallar".
Redigera öppnar edit-modal (tema: font/färger/autorotate/fade/kartstorlek; branding:
markdown + Infoga bild + storlek/position med live-preview) -> update-by-id. På
preview-steget: "Spara som mall..." (skapar/skriver över per namn) + "Bläddra mallar"
(öppnar väljaren); tour-preview.js delar apply-funktionerna mellan bläddra och spara.

## Runtime-viewern (viewer.js/css)

Path-agnostisk: läser inbäddad `tour`/`map` (JSON-script-taggar), bygger
pannellum, lägger till kartöverlägg (klickbara prickar, aktiv scen markerad).
Applicerar `tour.default.theme` via CSS-variabler (`--tour-font/--dot-color/
--current-dot-color`) + `mapSize` (`data-size` på `#map-container`).
**Länklinjer ritas INTE i turen** - det är en bygghjälp bara i plan-vyn.
**Branding-overlay:** `tour.default.branding={content(markdown),size,position}`
renderas som ett `.tour-branding`-överlägg via delad `renderBrandingInto` (markdown.js;
sanerad MD, externa länkar target=_blank, storleks-/positionsklass). Redigeras på
preview-steget (textarea + "Infoga bild" ur mediebiblioteket), återanvänds via egen
**branding-mall** (BrandingPreset, se nedan) - INTE tema-preseten. Följer med i
bundle/backup (`_media_refs` skannar branding.content). Runtime = fixed + egen
fullskärms-omflyttning; preview = absolut i panorama-wrap.

## static/-JS (editorn)

- `utils.js` - `apiFetch` (CSRF-header), `showToast`, `escapeHtml`.
- `confirm-modal.js` - stylad bekräftelsedialog som ersätter native `confirm()`.
  `window.confirmDialog(msg, {danger,confirmText}) -> Promise<boolean>` + drop-in för
  `<form data-confirm="..." [data-confirm-danger] [data-confirm-ok="..."]>` (fångar
  submit, frågar, skickar vid ja). Laddas globalt i base.html. Använd detta - inte
  `confirm()`.
- `modal-a11y.js` - tillgänglighet för alla `.help-modal`-overlayer (hjälp, hotspot,
  startscen, inställningar, mediebibliotek): sätter `role=dialog`/`aria-modal`, fokusfälla
  (Tab cyklar inuti) och fokusåterställning vid stängning. Aktiveras via en
  MutationObserver på modalens `hidden`-attribut - ingen ändring krävs i varje modals
  öppna-logik; dynamiskt byggda modaler fångas också. Laddas globalt i base.html.
- `media-library.js` - delad mediepool (`/media/*`). EN komponent `mountLibrary(container,
  opts)` driver BÅDA ytorna (DRY): `window.initMediaManager(el)` = `/media`-sidan (utan
  onPick), `window.openMediaLibrary(slug, onPick)` = samma komponent i ett modal-skal
  (väljare i scenhanteringen; onPick plockar url + stänger). Funktioner: flerfils-upp med
  progresslista + klient-storleksgräns (`window.MEDIA_MAX_MB`), filnamn + sök (fritext på
  filnamn + Discord-lik `tur:<slug>`-token med autocomplete, AND-filtrering), status-filter
  (alla/oanvända), tumnaglar i rutnätet (thumb-URL), kort-/listvy (localStorage `media_view`),
  batch-markering + `POST /media/batch-delete`, användnings-breadcrumbs. Bredd:
  `.media-modal .media-article` (0,2,0) slår `.help-modal article` -> `min(1400px,94vw)`.
- `media-lightbox.js` - `window.openLightbox(url, alt)`, fullstor bildförhandsvisning i
  en `.help-modal`-overlay (får modal-a11y). Laddas globalt i base.html.
- `plan.js` - kartplacering/länkning (zoom/pan, dra länkar, pilar).
- `scene.js` - scenvyn: kalibrering, hotspots, upplösningsväljare (preview/
  multires/full), klickbar+resizebar minikarta. EasyMDE-bilder -> `/media/upload`.
  **Startriktning (default yaw+pitch):** live yaw/pitch-indikator, överläggs-sliders
  i panoramat (horisontell yaw + vertikal pitch, driver vyn live), "Sätt till
  nuvarande vy" + "Till standard"/"Till 0/0". Lagras på `scene.yaw`/`scene.pitch`
  i tour.json (persisteras via SceneUpdate i scenes.py). Vieweren/`/preview` använder
  den vid kartklick/föreg-nästa/initial load (loadScene(id, pitch, yaw)); hotspot-
  navigering och deep-link-hash överstyr.
- `tour-preview.js` - `/preview`: pannellum + turinställningar (live autorotate),
  startscen-väljare (kartmodal + hover-preview), tema.
- `upload.js` - parallell per-fil-uppladdning + previews, startar tiling.
- `tile-status.js` / `index.js` - tiling-status på hemsida / huvudmeny.
- `export.js` - bundle-export-progress + readiness-varningar + opt-in originalbilder.
- `backup.js` - projekt-backup-progress (redigerbar zip) på preview-steget.
- (tema-presets) - preset-UI:t på preview-steget bor i `tour-preview.js` (läser/
  applicerar samma tema/inställnings-kontroller); API `/presets` (routes/presets.py).
- `import-project.js` - importera projekt-zip på startsidan -> redirect till nya turen.
- `share.js` - publik delningslänk på preview-steget: skapa/sluta dela async (fetch,
  JSON-svar) så länken dyker upp/försvinner i rutan utan omladdning. Progressiv
  förbättring (forms funkar utan JS via redirect).
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
och **hotspots**: `attachHsTooltips(hotSpots, sceneNames)` ger markdown-teaser via
pannellums `createTooltipFunc` (`mdHotspotTooltip`, teaser ovanför hotspoten):
info-hotspots (body -> expanderbart `openHsSheet`-ark via `clickHandlerFunc`),
scen-hotspots (teaser MD ovanför + "→ målscen"-etikett NEDANFÖR via `belowLabel`,
`sceneNames`-map ger målets titel) och URL-hotspots (MD-teaser). Alla vyer bygger
`sceneNames` och passar den (viewer.js/tour-preview.js/scene.js `cloneHs`). OBS:
`escapeHTML: true` globalt påverkar inte dessa (createTooltipFunc bygger egen DOM).
Hotspot-editorn (scene.js) kör EasyMDE i flikar (Teaser/Läs mer, expanderbar
härleds ur body-text). Bilder kommer ur **mediebiblioteket** (se nedan).

## Mediebibliotek (delad pool per ägare - routes/media.py + services/media.py)

Bilder till info-hotspots lagras i en **delad pool per ägare** (`User` nu, `Team`
i Fas 4), återanvändbar mellan projekt - INTE per projekt. Lagring platt under
`media/<owner_id>/<name>` (`config.MEDIA_DIR`, gitignorat); filnamn =
`token_hex(6)-<saniterat basnamn>` (oigissbart). Refereras i hotspot-markdown som
absoluta `/media/<owner_id>/<name>`. `GET /media/{owner_id}/{name}` serverar
**publikt per capability-URL** (ingen auth-grind, bara traversal-guard) så samma
URL funkar identiskt i editor, publika /s-vyn och bundlen UTAN omskrivning (till
skillnad från de gamla `/projects/<slug>/`-URL:erna). Grindade endpoints (require_user,
CSRF): `POST /media/upload`, `GET /media/list` (metadata: pixlar/storlek/mtime +
härledd `usage` genom att skanna ägarens tur-JSON efter URL:en), `POST /media/{name}/delete`.
`GET /media` = administrationssida (`media_library.html` + `initMediaManager` i
`media-library.js`). Bundlen: `_media_refs` samlar refererade (owner,name) INNAN
`_relativize` skriver om `/media/<owner>/<name>` -> `media/<name>`, `_collect`
kopierar bara de refererade poolbilderna. Usage härleds - ingen DB-tabell.

## Env-vars (config.py)

`SVK_PORT` (8002), `SVK_HOST`, `SVK_PROJECTS_DIR` (projects), `SVK_MEDIA_DIR`
(media), `SVK_DB_FILE`
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
