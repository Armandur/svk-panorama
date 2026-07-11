# Roadmap

Mål: göra det lätt för andra att skapa egna avancerade Pannellum-turer.
Riktning: **self-host-först** (editor + exporterbar statisk bundle), SaaS som
senare fas ovanpå samma kärna. Kartan är enda sanningskällan för geometri.

## Fas 0 - Grund (klar)

- [x] Multires tile-pipeline (`tools/tile_tour.py`) - ~26x snabbare initial
      laddning, non-destruktiv `.tiled.json`.
- [x] Git-hygien (bilder/tiles skyddade, radslutsbrus stoppat).
- [x] Fixade bekräftade editor-buggar (minnesläcka i kartklick, ReferenceError,
      död kod, fel flagga, J/K-typo, trasiga domkyrkan-sökvägar).

## Fas 1 - Editor-kärna (pågår)

- [x] Kartbaserad geometri-motor (`js/geo.js` + `tools/geo.test.js`) - härleder
      hotspot-yaw/targetYaw ur kartposition + en nordoffset per scen.
- [x] Graf-editor-prototyp (`js/graph-editor.js`) - dra länkar på kartan,
      kalibrera, auto-generera. Mekaniken validerad.
- [x] **FastAPI-app** (`app/`) med tvåstegs-flöde: steg 1 uppladdning (async
      med progress, för-genererade previews, ta bort/ersätta), steg 2 kart-först
      planeringsvy (placera, riktade länkar enväg/tvåväg med pilar, zoom/pan,
      hover-preview med inställningar, autospar, dirty-skydd, beredskapskoll,
      hjälp-modal).
- [x] **Scenhantering** (route `/projects/{slug}/scenes`): kalibrering av
      nordoffset per scen (sikta + klicka på granne), auto-generering av hotspots
      med riktningsstöd, scennamn (visas i vyn), hårkors, full upplösning-toggle,
      dirty-skydd, hjälp-modal.
- [x] Mer scenhantering: **info-, URL- och scen-hotspots** via en modal (håll
      I/U/H eller knappar; sikta hårkorset, släpp -> modal). Scen-hotspots: välj
      målscen (med roterande preview), enkel/dubbelriktad (härleds från om en
      länk tillbaka finns), targetYaw (auto/manuell/generera-om), samt en alltid
      synlig "Scen X"-etikett i editorn (tour-datans text är valfri tooltip).
      Manuella hotspots bevaras av auto-generera. Flytta/redigera/ta bort i lista.
      Scennamn, horisont-upprätning (roll, 0,25-steg), full upplösning-toggle.
      Delad Inställningar-modal (preview snurr/riktning/vagg) i alla steg.
- [x] **Hotspot-interaktion pass 2**: färgad ring på närmaste hotspot (rAF-loop),
      greppa & flytta närmaste med Space (släpp = släpp på hårkorset). Live-
      följning vid håll I/U/H sker via pending-markör i mitten. Behöver
      webbläsartest (interaktion, ej verifierbar headless).
- [x] Inbyggd hur-man-gör-guide finns i vyernas hjälp-modaler + `WORKFLOW.md`.

## Fas 2 - Bundle & viewer

- [ ] **Integrera multires-tiling i appen.** Pipelinen finns i
      `tools/tile_tour.py` (Fas 0) men körs inte från appen än. Kör tiling som
      ett jobb på de uppladdade bilderna och låt den publicerade turen använda
      multires (`type: multires`) istället for hela equirektangulära JPG:er, för
      snabb laddning. Se pannellums generate.py-docs (multires).
- [ ] En templatead viewer istället for 13 nästan identiska HTML-filer.
- [x] **Förhandsvisa hela turen + turinställningar** (route `/preview`): inbäddad
      multires-viewer med kartan, globala default-inställningar (autorotate,
      fördröjning, scen-fade, startscen), scenbläddring och val av kartstorlek
      (sparas som `default.mapSize`, respekteras av runtime-vieweren).
- [x] **Teman**: valbara typsnitt (system-font-stackar) och färger på kartprickar,
      aktiv scen och länklinjer. Sparas i `tour.default.theme`, appliceras av
      runtime-vieweren via CSS-variabler; länklinjer ritas mellan scener på kartan.
- [x] **"Exportera bundle"** (route `/export`, `app/services/bundle.py`): async-
      jobb bygger en självbärande zip (index.html + vendored pannellum + viewer +
      tiles + map.png + originalbilder för otilade scener + README). Relativa
      sökvägar -> fungerar oavsett underkatalog, utan server-kod. Verifierad
      fristående via `python -m http.server`. Self-host-produkten.

## Admin/inställningar (senare)

- [ ] Admin-gränssnitt för att justera inställningar utan omstart. Mönster:
      **env sätter default, admin-override vinner** (kräver en settings-store,
      t.ex. DB-tabell/JSON). Inställningar: bas-URL (`SVK_BASE_URL`, redan
      config-styrd - för export/delningslänkar), tiling-parallellitet
      (`SVK_TILE_CONCURRENCY`), tile-kvalitet, uppladdnings-parallellitet,
      previewstorlek m.m.
- [ ] Ev. finare tiling-progress via filräkning (räkna face*.tif 0-6 under
      nona-fasen + tile-jpg mot förväntat antal) i stället för bara faser.

## Fas 3 - Multi-tenant self-host (single-host Docker)

Modell (beslutat 2026-07-11): SaaS = self-host via Docker på Unraid, ev. senare
Hetzner via docker-compose. **Ingen** objektlagring/S3 (lokal disk på volym),
**ingen** jobbkö (in-process räcker för en instans), **ingen** multi-instans.
Kvarvarande arbete är i praktiken auth + multi-tenancy.

- [x] **Skiva 1: auth + projekt-ägarskap** (commit 5f86954). Sluten inbjudan,
      bcrypt-login, signerad session, `User` + `owner_id`, Alembic, ägar-gate.
- [ ] **Skiva 2: admin-UI + inbjudningsflöde** - lista/skapa användare, generera
      inbjudningslänk (signerad token) så inbjudna sätter eget lösenord.
- [ ] Gata `/projects`-static-mounten (råfiler nås idag utan ägar-koll - låg risk
      på sluten värd, men bör stängas för äkta isolering).
- [ ] Ev. Postgres via docker-compose när/om det behövs (SQLAlchemy-grunden klar).
