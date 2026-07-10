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
- [ ] **FastAPI-app** med kart-först planeringsvy: ladda upp bilder + karta,
      placera numrerade punkter, länka scener. Flytta graf-UI hit (planeringen
      hör hemma på kartan, skilt från scenvyn).
- [ ] Flytta kalibrering + generering till appens scenvy.
- [ ] Inbyggd hur-man-gör-guide (se `WORKFLOW.md`).

## Fas 2 - Bundle & viewer

- [ ] En templatead viewer istället for 13 nästan identiska HTML-filer.
- [ ] "Exportera bundle" = zip med tiles + JSON + viewer + vendored pannellum +
      hosting-instruktioner. Detta är self-host-produkten.

## Fas 3 - SaaS-lager (senare)

- [ ] Auth, multi-tenant, objektlagring, jobbkö för tiling, hosting.
