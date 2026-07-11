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
- [ ] **Förhandsvisa hela turen** (med kartan) i editorn innan export, med val av
      kartstorlek för olika skärmstorlekar.
- [ ] **Teman**: valbara typsnitt, färger på kartprickar/linjer m.m.
- [ ] "Exportera bundle" = zip med tiles + JSON + viewer + vendored pannellum +
      hosting-instruktioner. Detta är self-host-produkten.

## Admin/inställningar (senare)

- [ ] Admin-gränssnitt för att justera bearbetningsinställningar utan omstart:
      tiling-parallellitet (`SVK_TILE_CONCURRENCY`, redan config-styrd), tile-
      kvalitet, uppladdnings-parallellitet, previewstorlek m.m.
- [ ] Ev. finare tiling-progress via filräkning (räkna face*.tif 0-6 under
      nona-fasen + tile-jpg mot förväntat antal) i stället för bara faser.

## Fas 3 - SaaS-lager (senare)

- [ ] Auth, multi-tenant, objektlagring, jobbkö för tiling, hosting.
