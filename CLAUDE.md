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
    projects.py      # / (publik landningssida), /editor (inloggad projekt-lista), /projects (skapa), /projects/{slug} (uppladdning), /delete, /rename-slug
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
    translate.py     # Översätt-steget: gap-scan + guidad granulär översättningsspar (flerspråkigt)
    history.py       # /history versionslista + /history/restore (återställ tidigare version)
  services/
    project_files.py # filsystemslager: slug, mappar, tour.json/map.json, previews
    tiling.py        # trådat tiling-jobb + manifest + apply_multires()
    bundle.py        # trådat export-jobb: bygger självbärande zip
    backup.py        # projekt-backup: exportera/importera REDIGERBAR projekt-zip
    presets.py       # tema-/inställningsförinställningar (list/save/delete/default + sanering)
    media.py         # delad mediepool: lagring, metadata (PIL), usage-scan
    storage.py       # diskanvändning per projekt/användare (admin-översikt, os.walk)
    history.py       # versionshistorik: snapshot tour+map vid varje write (unified tidslinje)
    historydiff.py   # semantisk diff mellan två versioner (scener/hotspots/språk/tema/karta)
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

## Schemaversion & kompatibilitet (config.SCHEMA_VERSION)

Policy: **additiv-först.** Nya fält i `tour.json`/`map.json`/`project.json` är
valfria med defaultar och okända fält ignoreras vid läsning (`.get(..., default)`),
så `SCHEMA_VERSION` bumpas BARA vid en BRYTANDE ändring. `tour.json` stämplas med
`schemaVersion` vid varje `write_tour` (även äldre turer versioneras när de sparas
om); backup-manifestet (`project.json`) skriver samma `version`. **Import gate:ar**
(`backup._check_archive_version`): ett arkiv med högre version än verktyget stödjer
AVVISAS med tydligt meddelande ("skapad med en nyare version"); äldre/samma/saknad
godtas (defaultar fyller nya fält). Vid en framtida brytande ändring: bumpa
`SCHEMA_VERSION`, lägg ev. en migrate-funktion som körs vid import/läsning, och
uppdatera denna sektion.

## Versionshistorik / ångra (services/history.py, routes/history.py)

Autospar skriver direkt över `tour.json`/`map.json` utan historik. Historiken ger
"återställ tidigare version". **Unified tidslinje:** varje `write_tour`/`write_map`
hakar in `history.snapshot(project_dir)` som arkiverar NUVARANDE (pre-overwrite)
`tour.json` + `map.json` IHOP till `projects/<slug>/_history/<epoch_ms>/`. Båda
snapshottas alltid tillsammans (tour.scenes <-> map.scenes är kopplade) -> restore
skriver båda ihop, desync omöjlig. En version taggad vid T = läget som GÄLLDE FRAM
TILL T (ersattes vid T); UI:t säger "Gällde till ..." (ärlig pre-overwrite-semantik).

- **DEADLOCK-regel:** `snapshot()` körs INUTI write_tour/write_map, som ofta anropas
  medan `project_files.tour_lock` redan hålls. Den tar därför ALDRIG tour_lock - bara
  sitt eget `history._history_lock` (ordning: tour_lock -> _history_lock, aldrig
  omvänt). Ren fil-I/O; importerar inte project_files (tar projektmappsökväg, deriverar
  filnamnen `_FILES` själv -> ingen cirkel med write_tour-hooken).
- **Coalesce + dedup:** hoppa ny snapshot om nyaste < `HISTORY_COALESCE_SEC` (20s;
  redigerings-burst -> en snapshot) eller om pre-write-innehållet == nyaste versionen.
- **Retention:** behåll en version om index < `HISTORY_MAX` (50) ELLER ålder <
  `HISTORY_FLOOR_DAYS` (7). Golvet skyddar "före sessionen"-snapshotten som ett rent
  antalstak annars vräker. Konstanter i config.py (`SVK_HISTORY_*`-override).
- **Restore** (`POST /history/restore`, form + CSRF, under tour_lock): force-snapshotta
  nuläget FÖRST (reversibelt oavsett coalesce), läs vald version, skriv båda via
  `write_tour(..., snapshot=False)` + `write_map(..., snapshot=False)`. `snapshot=False`
  hoppar hooken så det inkonsistenta mellanläget (ny tour + gammal map mellan de två
  skrivningarna) inte arkiveras - korrektheten hänger INTE på coalesce-konstanten.
- **UI** (`GET /history`, `history.html` + `static/history.js`): tidslinje nyast först
  ("Gällde till" abs+rel tid formaterad klient-side i besökarens tidszon, scenantal/
  språk/storlek-hint, Återställ per rad med `data-confirm`). Nåbar via "Versionshistorik"
  i `_step_nav`-menyn (ej ett steg). `restored=1` visar ångra-hint.
- **Semantisk diff** (`services/historydiff.py`, `GET /history/{version}/diff`): rå
  JSON-textdiff blir brusig för strukturerad data -> `historydiff.diff(old, new)` jämför
  på ENTITETSNIVÅ och returnerar en NÄSTLAD nod-modell. Grupper: Scener/Språk/Tema/
  Branding/Inställningar/Karta. **Hierarki scen > hotspot > fält:** en ändrad scen är en
  `collapsible`-nod (accordion) med `children` = scenfält-ändringar (titel/startriktning/
  kalibrering, gammalt→nytt) + en `section`-nod "Hotspots"; varje ändrad hotspot har egna
  `children` med FÄLTNIVÅ-diff (text/brödtext/placering/målscen/URL/språk, gammalt→nytt).
  Nod = `{kind: added|removed|changed|section, text, children?, collapsible?}`. Ren funktion,
  i18n-medveten (`_text_summary`), matchar scener/hotspots på id, `_fmt(None)="–"`.
  Varje versionsrad har en `<details>` som lat-laddar diffen. **Jämförelsebas via
  `?base=`:** `previous` (default) = mot kronologiskt FÖREGÅENDE version ("vad detta spar
  ändrade", `history.previous_version`, äldsta raden saknar diff); `current` = mot NULÄGET
  (diff-riktning nuläge→version, dvs "vad en återställning skulle ändra": + = läggs
  tillbaka, - = tas bort). En växel överst i historiken (`.hist-basetoggle`) byter base
  för alla rader live (history.js nollar `data-loaded`, laddar om öppna, uppdaterar
  summary-texten). I `current`-läge får även äldsta raden en diff; identisk-mot-nuläget
  ger "redan aktiv". `history.js` renderar rekursivt: grupper = öppna accordions, scener =
  kollapsade accordions (håller långa diffar hanterbara), section-rubriker + färgrader
  grönt +/rött −/gult ~ (`diff-add/del/chg`), nästlade listor indenteras.
- **Attribution ("ändrad av"):** varje snapshot får en `meta.json` = `{by, name}` för vem
  som SKAPADE det arkiverade läget. Pre-overwrite gör det subtilt: den som skapade ett läge
  är den FÖREGÅENDE spararen, inte den som arkiverar det. Löses med
  `_history/_pending.json` = vem som skapade nuläget: `snapshot()` kopierar `_pending` till
  arkivets `meta.json` FÖRE write-vägen avancerar `_pending` till aktuell sparare. INVARIANT:
  `set_pending_editor` körs vid VARJE spar (även coalesce/dedup-skip), aldrig hoppas över -
  ett systemutlöst spar sätter `{by:None, name:None}` (okänd) i stället för att lämna kvar
  förra spararen (annars felattribueras nästa arkivering). Editor byggs ur den autentiserade
  User:n via `deps.get_editor` (dependency, inte session) och trådas som `editor=` till
  write_tour/write_map (+ remove_scene) från ALLA muterande routes (scenes/plan/preview/
  translate/uploads/projects/history-restore). `list_versions` exponerar `editor`; historik-
  vyn visar "Ändrad av X". Additivt - äldre versioner utan meta visar ingen attribution.
- **Exkludering:** `_history/` ligger under gitignorade `projects/<slug>/`. backup.py
  (whitelist-enumerering) och bundle.py (`_collect`) globar inte brett -> följer inte med
  i arkiv/export. storage.py `os.walk` räknar det mot projektstorlek (minor, ok).
  `_pending.json` (fil, ej siffermapp) och `meta.json` (ej i `_FILES`) rörs inte av
  `_versions`/`read_version`/`_same_content`.

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
**Typsnitt:** systemstackar (sans/serif/mono/humanist) + två vendorade webbtypsnitt
`dmsans`/`spectral` (self-hostad woff2 i `static/vendor/fonts/`, `fonts.css`, latin-
subset, OFL). Font-family-stacken definieras i EN `FONTS`-map replikerad i viewer.js/
tour-preview.js/preset-library.js; validering i `presets._FONTS`. `bundle.py` kopierar
fonts.css+woff2 så exporten är självbärande (verifierat offline). Lägg nytt typsnitt =
uppdatera alla tre FONTS-mappar + `_FONTS` + selects + ev. woff2 i vendor/fonts.
**Länklinjer ritas INTE i turen** - det är en bygghjälp bara i plan-vyn.
**Branding-overlay:** `tour.default.branding={content(markdown),size,position}`
renderas som ett `.tour-branding`-överlägg via delad `renderBrandingInto` (markdown.js;
sanerad MD, externa länkar target=_blank, storleks-/positionsklass). Redigeras på
preview-steget (textarea + "Infoga bild" ur mediebiblioteket), återanvänds via egen
**branding-mall** (BrandingPreset, se nedan) - INTE tema-preseten. Följer med i
bundle/backup (`_media_refs` skannar branding.content). Runtime = fixed + egen
fullskärms-omflyttning; preview = absolut i panorama-wrap.

## Flerspråkighet (i18n)

Turer kan visas på flera språk. **Datamodell: inline locale-map, additiv union.**
Ett textfält (hotspot `text`/`body`, scen `title`, `default.branding.content`) är
antingen en **ren sträng** (monospråkigt / default-språk / äldre turer) eller
`{kod: text}` (t.ex. `{sv:"...", en:"..."}`). Turens språk: `tour.default.languages`
(ordnad lista, **först = default**; saknas -> `["sv"]`). Språk: sv/en/de/fi/no/da
(`config.LANGUAGES` <-> `window.LANG_NAMES` i markdown.js - håll i synk).
**Additivt -> ingen SCHEMA_VERSION-bump** (monospråkiga turer förblir rena strängar).

- **Resolver (markdown.js):** `window.resolveText(value, lang, langs)` - sträng =
  default; objekt -> valt språk, fallback default -> första icke-tomma -> "".
  `window.uiStr(key, lang)` lokaliserar UI-chrome (map/closeMap/scene/readMore/...).
  `attachHsTooltips(hotSpots, sceneNames, lang, langs)` och `renderBrandingInto(el,
  branding, lang, langs)` tar nu språk; `sceneNames`-värden ska vara REDAN resolverade.
- **Runtime-viewern (viewer.js):** väljer språk (`?lang=` -> localStorage `tour_lang`
  -> `navigator.language` -> `langs[0]`), resolverar hotspots/branding/scentitlar,
  språkväljare (`.lang-toggle`, bara vid >=2 språk) som **bygger om pannellum**
  (djupkopierar config -> re-attach räcker inte) och återställer scen/vy. **Pannellums
  inbyggda titel-ruta** läser `scene.title` rakt av -> viewer.js/tour-preview.js
  skriver in den RESOLVERADE strängen i `tour.scenes[id].title` inför bygget (läser
  ur en orörd `origTitle`-kopia) så det inte blir `[object Object]`.
- **Editorn:** turens språk väljs på preview-steget (kryssrutor -> `languages`);
  scen-/preview-vyn visar per-språk-fält (flikar) för hotspot-text, scentitel och
  branding BARA vid >1 språk (annars oförändrat). Scenvyn läser `tour.default.languages`
  vid sidladdning -> sätt språk på preview FÖRST, sedan syns per-språk-fälten i scenvyn.
- **Backend:** `presets.sanitize_i18n_text`/`sanitize_languages`/`sanitize_branding`
  (str|dict) + `set_i18n_lang(value, lang, text, default_lang)` (granulär spar) +
  `i18n_text_values(value)` (alla språksträngar); `SceneUpdate.title` +
  `TourSettings.brandingContent` är `str|dict`. `i18n_text_values` -> `bundle.py`/
  `backup.py` `_media_refs`/`_relativize` + `media.py` usage-scan itererar ALLA varianter
  (annars trasiga poolbilder i icke-defaultspråk). `services/i18n.py`: `og_description(name,
  lang)` (6 språk) + `tour_default_lang(tour)`, används av viewer.py/public.py/bundle.py.
- **Flaggor + editor-dropdown:** `markdown.js` har `FLAG_SVGS`/`LANG_FLAG`/`langFlag`
  (vendorade flag-icons-SVG:er som data-URI:er - renderar likadant på alla enheter,
  Windows saknar flagg-emoji). Viewern har flagg-språkväljare (infälld=flagga, utfälld=
  flagga+namn) längs vänsterkanten under pannellums kontroller. `static/lang-dropdown.js`
  (`mountLangDropdown(container, {langs,current,onPick,showName})`) = återanvändbar editor-
  dropdown (branding-editorn, scentitel, hotspot-modal, /mallar). Turens språk väljs på
  preview-steget med bockrutor + **drag-and-drop-ordning** (först = default).
- **Översätt-steg (routes/translate.py, translate.html/js):** eget flödessteg MELLAN
  Scener och Preview (översätt först, förhandsvisa sedan), syns bara vid >1 språk (annars redirect). Listar LUCKOR (fält med källspråk
  `languages[0]` men saknad målspråk), guidat: klick laddar scen + riktar kamera mot
  hotspoten, källtext (skrivskyddad) bredvid EasyMDE-målfält, spar via granulär endpoint
  `POST /projects/{slug}/translate` (`set_i18n_lang`). `bundle.missing_translations(tour)`
  matar readiness-varning inför export/delning. Steget gate:as på `is_multilingual`
  (skickas i context av routes som renderar `_step_nav.html`).
- **Språk-specifika hotspots:** en hotspot kan ha `langs` (lista koder; saknas/tom =
  alla språk). `hotspotInLang(hs,lang)` (markdown.js) + `i18n.hotspot_in_lang` (Python).
  Viewer/preview filtrerar per aktuellt språk (origHotSpots-kopia, bara vid >1 språk).
  Editor: "Visa på språk"-bockrutor i hotspot-modalen. Översätt/`missing_translations`
  hoppar över språk hotspoten inte finns på.
- **Placering av språkval:** turens språk (bockrutor + drag-ordning, först=default) väljs
  på UPPLADDNINGSsteget (`upload.html` + `lang-picker.js` + `upload-lang.js`, sparas via
  `POST /projects/{slug}/languages` som rör BARA `default.languages`) - inte på preview.

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
  förbättring (forms funkar utan JS via redirect). Renderar även **QR-kod**
  (vendorat `vendor/qrcode/qrcode.js`, MIT, `qrcode(0,'M').createDataURL` -> gif
  data-URL, nedladdningsbar) och en **embed-`<iframe>`-snutt** (kopiera-knapp) när
  turen delas - båda fylls både vid sidladdning (server-renderad länk finns) och
  vid skapa/sluta dela.
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

## Team & multi-tenancy (Fas 4.1, routes/teams.py)

Turer kan ägas av ett **team** i stället för en enskild användare. VALFRITT - en
solo-användare (`User.team_id` NULL) äger sina turer själv. Modeller (`database.py`):
`Team` (id/namn/slug/base_url), `User.team_id`+`team_role` (member|team_admin, skild
från globala `is_admin`=super-admin), `Project.team_id` (team-ägd; `owner_id` bevaras
som "skapad av"). Alla FK:er nullable -> **noll team = identiskt beteende** (acceptanstest).
Slug fortsatt globalt unik (per-team-slug + disk-namespace = Fas 4b).

- **Access-gate:** `deps.user_can_access_project(user, project)` (använd av `get_project_or_404`):
  super-admin ELLER (`project.team_id is not None and == user.team_id`) ELLER (team-lös tur
  och `owner_id == user.id`). ~25 routes ärver via gaten.
- **Listningar** (`editor_home`, `tile_jobs`, media-filter): `deps.visible_projects_clause(user)`
  = egna + teamets turer. **FÄLLA:** bygg team-klausulen BARA när `user.team_id is not None`
  - annars kompilerar `Project.team_id == None` till `IS NULL` och läcker alla team-lösa turer.
- **Session:** bär `team_id`/`team_role`, synkas i `_user_from_session` som `admin`-flaggan.
- **Delade resurser (media/presets) per team:** ägar-nyckeln är `User.owner_key`
  (`team-<id>` för team, `<user_id>` solo - team-prefix undviker id-krock på mediekatalog).
  Media: `media/<owner_key>/`, serve-routen validerar nyckelformat (`media.valid_owner_key`).
  `bundle/backup._MEDIA_REF_RE` matchar `team-<id>` och `_media_refs` behåller strängnyckeln.
  Presets: `team_id`-kolumn, all CRUD scopas via `presets._scope_clause` (team-match ELLER
  owner_id+team_id NULL). Entrypoints tar `user`.
- **Team-livscykel:** self-serve `POST /teams` (skaparen blir team_admin). `/team`-sida:
  medlemslista + (team-admin) bjud in (`POST /team/invite` -> vilande konto med team_id satt,
  ärvs vid accept-invite), promota/degradera roll, ta bort medlem. `require_team_admin`-gate.
- **Arbetsyte-modell (personliga turer i ett team):** Personlig + varje team är likvärdiga
  "ytor". `User.can_personal` (bool, default True self-serve / False för konton team-admin
  bjuder in) styr rätten till egna icke-team-turer; team-admin togglar per medlem. Skapa-tur
  har en scope-DROPDOWN (`deps.user_workspaces` -> Personlig/\<team\>, team=default) validerad
  av `resolve_workspace` (personlig avvisas 400 om can_personal=False). `Project.team_id` =
  None -> personlig, satt -> team.
- **Per-yta mediapool:** media följer TURENS yta, inte användarens primära. `deps.project_owner_key
  (project)` = `team-<id>`/`<owner_id>`. Media-endpoints tar `slug` (redigeringskontext, härleder
  turens yta via gate) eller `owner` (explicit, `user_may_use_workspace`-validerad); annars primär
  yta (`_pool_owner` i routes/media.py). **VIKTIGT:** ALLA klient-uppladdningar till /media/upload
  måste skicka `?slug=` (media-library.js `poolQ` + EasyMDE-uppladdarna i scene/tour-preview/
  translate) - annars hamnar bilden i primär pool. `/media`-sidan har en yta-växlare.
  Presets ärvs fortfarande per ANVÄNDARE (user.team_id), inte per turens yta - medveten asymmetri.
- **Solo→team opt-in:** kryssruta "ta med mina turer" vid skapa-team -> `teams._bring_solo_to_team`
  flyttar solo-turer (team_id), personliga poolen -> team-poolen, skriver om `/media/<id>/`-refs.
- **Redigeringslås (check-out/check-in, `services/checkout.py` + `routes/checkout.py`):** skydd mot
  att två teammedlemmar skriver över varandra. En TEAM-tur checkas ut när man öppnar ett redigerings-
  steg (`editor-lock.js` på upload/plan/scenes/preview/translate) -> andra ser läsläge. Solo-turer
  (team_id NULL) låses INTE. **Atomär acquire:** EN villkorad `UPDATE ... WHERE checked_out_by IS NULL
  OR = me OR checked_out_at < stale` + rowcount (aldrig läs-sedan-skriv). **Write-guard**
  (`deps.require_edit_access` på alla muterande edit-routes): en team-turs skrivning tillåts BARA om
  skrivaren HÅLLER ett färskt lås -> annars 409 (inte bara "ingen annan håller"). History-restore är
  undantag: blockeras bara om NÅGON ANNAN håller (engångsåtgärd). `Project.checked_out_by/at`, naiv
  UTC, `SVK_CHECKOUT_STALE_SEC` (180). Heartbeat 60s (upptäcker övertagande, varnar live), unload ->
  sendBeacon `/checkin` (form-CSRF, kan ej sätta header). Team-admin/super-admin **tvingar incheck**.
  Klienten är UX; servern (409) är garantin. VIKTIGT: nya muterande edit-routes måste ta
  `Depends(require_edit_access)` i stället för `get_project_or_404`.
- **Multi-team (framtid, EJ byggt):** en användare tillhör EXAKT ett team (`User.team_id`). Flera
  team kräver join-tabell -> arbetsyte-modellen är designad som en delmängd (dropdownen växer). ROADMAP.
- **Egna domäner (Fas 4.3, ej byggt):** `Team.base_url` -> `request_origin`, host-baserad
  tenant-middleware, proxy-headers, domänverifiering, Caddy on-demand TLS. Se ROADMAP.

## Auth + admin (routes/auth.py, admin.py, profile.py)

Sluten inbjudan, session bär `uid`. `User.active` (bool): spärrat konto nekas i
`auth._user_from_session` (session ogiltig) + vid login. `require_admin` gate:ar
`/admin/*`. Admin-detaljsidan `/admin/users/{id}` gör profiländringar på
användarens vägnar (namn/lösenord-override/avatar/active/is_admin, self-guards mot
att spärra/demota sig själv). Batch: `POST /admin/users/batch` (reset_password/
disable/enable/delete). Admin-avatar-routes speglar profile.py (`_process_avatar`
importeras därifrån). Pre-produktion: schemaändring (t.ex. `active`) = radera
svk.db + starta om.

**Diskanvändning (services/storage.py).** Mappstorlek per projekt/användare.
`project_sizes`/`media_sizes` skannar PROJECTS_DIR/MEDIA_DIR:s barn; `human_size`
exponeras som Jinja-global (`app/deps.py`). **TTL-cache:** `cached_dir_size`
memoiserar per mapp i en in-process dict (`SVK_STORAGE_CACHE_TTL`, default 60 s,
0=av) -> os.walk sker som mest en gång per TTL per mapp oavsett last (mätt ~600x
snabbare cache-hit). `invalidate(path=None)` tömmer. Ytor:
- **`/admin/storage`** (egen flik, `admin_storage.html`) - full drill-down:
  totaler (disk/hos användare/ospårat), per användare ett `<details>` med turer
  (störst först) + mediepool + total, och en **Ospårat**-sektion (mappar utan
  matchande DB-rad, t.ex. rester efter borttagna konton). Knappen **Räkna om**
  (`POST /admin/storage/refresh`) tömmer cachen.
- `/admin/users` - Lagring-kolumn per användare (at-a-glance) + länk till fliken.
- `/admin/users/{id}` - nedbrytning per tur + mediepool + totalt.
Fas 4: gruppera per team (owner_id -> team_id), samma skanning håller.

## Publik delning (public.py)

Turer kan delas oautentiserat via en oigissbar `Project.share_token`. `/s/{token}`
renderar samma `viewer.html` som inloggade `/view` men med `asset_base` = `/s/{token}/`
och tour-paths omskrivna dit; `/s/{token}/{path}` serverar råa filer (läs-only,
traversal-guard). Skapa/sluta-dela på preview-steget. Nolla token -> länken dör.
**Open Graph/Twitter Card-taggar:** `viewer.html` (och bundlens `bundle_index.html`)
har `og:title/description/image` + `twitter:card` så delningslänken får rik
förhandsvisning i Messenger/Slack m.fl. `og:image` = kartbilden (`map.png`); absolut
URL byggs i public.py/viewer.py ur `config.BASE_URL` eller `request.base_url`. Bundlen
använder relativ `og:image` (vet inte sin host).

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
(82), `SVK_TILE_CONCURRENCY` (2), `SVK_STORAGE_CACHE_TTL` (60; diskanvändnings-cachens
TTL i sek, 0=av), `SVK_HISTORY_MAX` (50), `SVK_HISTORY_FLOOR_DAYS` (7),
`SVK_HISTORY_COALESCE_SEC` (20; versionshistorikens retention/coalesce),
`SVK_BASE_URL` (tom; för framtida export/
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
