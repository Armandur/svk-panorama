# Kodgranskningar

Nyast först. Varje fynd markerat åtgärdat/avfärdat med commit-ref.

## 2026-07-11 - Fas 2 (viewer, tiling, parallellism, bundle, teman)

Oberoende granskning (Claude-subagent, eget kontext) av `git diff 7252b14..HEAD`
(~24 commits). Fokus: trådade jobb, concurrency på filskrivning, path-säkerhet,
JS-livscykel. Sex äkta fynd, alla åtgärdade i **bd5fb8c**. Path-hanteringen var
verifierat ren (sanerade filnamn -> ingen traversal i zip/disk).

- **[ÅTGÄRDAT bd5fb8c] #1 (HÖG) `write_manifest` ej atomisk -> JSONDecodeError
  under aktiv tiling.** `write_text` truncerar innan skrivning; pollande läsare
  (status/view/preview/scenes) kunde läsa en tom fil -> 500. Fix: atomisk
  skrivning (temp-fil + `os.replace`) för manifest.json OCH tour.json/map.json.
- **[ÅTGÄRDAT bd5fb8c] #2 (HÖG) `drop_scene_tiles` utan lås -> lost update mot
  tiling.** Läs-modifiera-skriv av manifestet utan `_manifest_lock` racade
  tiling-trådarna. Fix: samma lås runt manifest-RMW.
- **[ÅTGÄRDAT bd5fb8c] #3 (MEDEL-HÖG) `/tile-jobs` itererar levande `_jobs` ->
  RuntimeError vid samtidig jobbstart.** Fix: `all_jobs()` returnerar en
  ögonblicksbild (`dict(_jobs)`) under `_start_lock`.
- **[ÅTGÄRDAT bd5fb8c] #4 (MEDEL) rmtree-race - omuppladdning av scen medan dess
  tiling pågår.** Fix: `drop_scene_tiles` rör inte tile-katalogen medan ett jobb
  kör (nästa tiling rmtree:ar den ändå före omgenerering).
- **[ÅTGÄRDAT bd5fb8c] #5 (MEDEL) `_tour_lock` skyddade bara uppladdning.**
  Radering/scen-spar/turinställningar skrev tour.json olåst -> lost-update mot
  parallell uppladdning. Fix: delat `tour_lock` (threading, i project_files) runt
  RMW i alla muterande routes.
- **[ÅTGÄRDAT bd5fb8c] #6 (LÅG-MEDEL) watcher-tråd i `_run_docker` städas bara på
  happy path.** Fix: `stop.set()` + `join` i `finally` så tråden stoppas även om
  stdout-läsningen kastar.
- **[AVFÄRDAT] Lågt: `bundle._collect` `rglob` kan kasta om en tile-katalog tas
  bort mitt under export.** Fångas redan av `except Exception` i `_build` och
  rapporteras som exportfel (ingen krasch, självläkande vid ny export). Inte värt
  extra komplexitet.

Verifiering: 34 backend-tester gröna (inkl. nya atomic-write- och
relativiseringstester); tiling körd end-to-end med samtidig bulk-polling utan fel.
