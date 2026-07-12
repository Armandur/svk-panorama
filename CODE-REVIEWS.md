# Kodgranskningar

Nyast först. Varje fynd markerat åtgärdat/avfärdat med commit-ref.

## 2026-07-12 - Helhetsgranskning (säkerhet, UI/UX, produkt)

Tre oberoende Fable-subagenter (eget kontext) granskade hela `app/` efter
mediebibliotek v2. Säkerhetsspåret gick igenom auth/CSRF/traversal/injection/
concurrency; UI/UX-spåret hela editorflödet; produktspåret föreslog funktioner.
Två verifierade säkerhetsfynd åtgärdade; övrigt loggat nedan/på ROADMAP.

- **[ÅTGÄRDAT 383ef84] S1 (KRITISK) Stored XSS via pannellum `escapeHTML`.**
  Scen-titel och text på scen/URL-hotspots renderades oescapat (`title.innerHTML=
  D(...)`, `escapeHTML` aldrig satt). `<img onerror=...>` i en titel kördes i alla
  som visade turen - inkl. publik /s och en admin som öppnar användarens tur
  (JS-läsbar CSRF-cookie -> självupphöjning). Fix: `escapeHTML: true` TOP-LEVEL
  (inte i default-blocket - propagerar ej) i viewer.js/tour-preview.js/scene.js.
  Info-hotspots opåverkade (egen DOMPurify-väg). Verifierat: payload kördes före,
  escapas efter (Playwright, /view + /scenes + /preview).
- **[ÅTGÄRDAT 0ae6257] S2 (HÖG) Invite-token kunde kapa aktivt konto.**
  `accept-invite` krävde inte `password_hash is None` -> läckt men giltig invite
  (7 dygn) kunde sätta nytt lösenord på aktivt konto. Fix: guard i GET+POST.
  Verifierat live: aktivt kontos token avvisas, lösenord oförändrat.
- **[SENARELAGT -> produktionshärdning] S3 (MEDEL)** rate limiting bara på login;
  `request.client.host` blir fel bakom proxy (ingen XFF-parsing).
- **[SENARELAGT] S4 (MEDEL)** race på map.json (plan.py:s `write_map` utanför
  `tour_lock`) - "last write wins", ingen korruption (atomisk skrivning). Låg risk
  i enanvändarläge.
- **[SENARELAGT -> produktion] S5 (LÅG)** lösenordspolicy (bara >=8), ingen
  pixelgräns på bilder utöver MB-tak, default admin/admin.
- **[VERIFIERAT RENT] Ingen fynd:** traversal-guards (media/public/assets),
  CSRF-täckning (alla muterande POST/DELETE utom medvetet /logout), auth-gates +
  self-guards, `_safe_suffix` i mediepoolen, markdown-XSS (info-hotspots via
  DOMPurify), hex/tema-validering, bundle-relativisering, tour.json-concurrency.

UI/UX-fynd (åtgärdas efter behov, ej blockerande): mobil-sidopanel utan
max-height, saknad fokusfälla/ARIA på `.help-modal`, små touch-mål, saknad
spinner vid mediebibliotek-upp, inline-validering bara på lösenordspar, stavfel
"pa servern" (upload.js). **OBS:** projektet är desktop-först (se minne), så rent
mobila fynd är låg prioritet. Produktförslag (bundle saknar originalbilder,
export-readiness-validering, djuplänkning, projekt-backup/import, temamallar)
förda till beslut/ROADMAP.

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
