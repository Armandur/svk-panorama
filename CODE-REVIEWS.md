# Kodgranskningar

Nyast först. Varje fynd markerat åtgärdat/avfärdat med commit-ref.

## 2026-07-12 - Granskning av produktionshärdning (commit 3e6f9e2)

Oberoende Fable-subagent granskade härdnings-blocket (S3-S5: map.json-lås, proxy-IP +
rate limiting, lösenordspolicy + bild-megapixelguard). S4 bekräftades korrekt/komplett
(alla write_map/write_tour delar `tour_lock`); accept-invite räknar bara angreppssignal;
policyn täcker alla lösenordssättande vägar. Två reella fynd åtgärdade (commit e180514):

- **[ÅTGÄRDAT e180514] HÖG - X-Forwarded-For-spoofing.** `client_ip` tog FÖRSTA XFF-posten;
  bakom en append:ande proxy är den klient-satt -> angripare kan variera XFF per request och
  sprida brute force över oändligt många nycklar, kringgå login-gränsen. Fix: ta SISTA posten
  (proxyns appendade klient-IP; modellen är EN betrodd reverse proxy).
- **[ÅTGÄRDAT e180514] MEDEL-HÖG - import hoppade megapixel-guarden.** `_extract` magic-kollade
  men körde inte dimensionskoll; en liten-fil/enorma-mått-bomb (repro: 20000x20000 PNG, 1,2 MB
  -> 400 MP) i ett arkiv kunde avkodas fullt vid preview/tiling (PIL:s globala backstop kastar
  bara över 2x taket). Fix: `_check_extracted_image` (header-läst megapixel-tak) per importerad
  bild + per-fil-storlekstak i `_validate_members`.
- **[LÅG, ej åtgärdat separat]** avatar-uppladdning kör inte dimensionskollen explicit men
  fångar PIL-fel brett (egen kontobild, begränsad påverkan) - noteras.

## 2026-07-12 - Granskning av branding + mall-bibliotek (diff caeaf41..a706a21)

Oberoende Fable-subagent (eget kontext) granskade hela funktionsblocket: branding-
overlay, branding-/tema-mallar, EasyMDE, mall-biblioteket (`/mallar` + väljar-modal +
skapa/redigera) och overlay-CSS-konsistens. Fokus: XSS, auth/ägarskap (IDOR), route-
ordning, validering, korrekthet. **Inga kritiska/höga/medel-fynd** - ägarskapsfiltrering
(`owner_id` på alla `_list`/`_save`/`_delete`/`_set_default`/update), `require_user` +
`verify_csrf_header` på muterande routes, DOMPurify vid varje `innerHTML`, och media-ref-
skanning (`_media_refs`/`_relativize` täcker `branding.content`) bekräftades korrekta. Två
låg-fynd åtgärdade:

- **[ÅTGÄRDAT f26a431] LÅG (UX) `update_branding` slog ihop hittades-inte och tom content
  till samma 400.** Fix: 404 för saknad mall, 400 (ValueError) för tom content - klienten
  kan skilja fallen; `preset-library.js` surfacar serverns `detail` i toast.
- **[ÅTGÄRDAT f26a431] LÅG (korrekthet) Namn-baserad upsert ("Spara som mall") + rename-
  by-id utan kollisionskoll kunde vid självförvållat dubblettnamn skriva över fel rad.**
  Fix: `_guard_name_clash` avvisar namnbyte som krockar med annan mall (ValueError -> 400),
  så namn förblir unika per ägare och upserten blir entydig.

## 2026-07-12 - Sessionsgranskning (diff 1ecce63..HEAD, 39 commits)

Tre parallella oberoende Fable-subagenter (eget kontext) granskade hela sessionens
diff: säkerhet, backend-korrekthet, frontend-korrekthet. Fokus: nya
backup/import + presets + mediebibliotek v3 + startriktning + scen-hotspot-rendering.
Alla bekräftade allvarliga fynd åtgärdade.

- **[ÅTGÄRDAT 06582ce] KRITISK (säkerhet) Zip-import validerade inte filtyp -> stored
  XSS via capability-URL:er.** En riggad `media/x.html`/`.svg` i en projekt-zip hamnade
  i mediepoolen och serverades `text/html` same-origin via de auth-fria `/media/`- och
  publika `/s/`-URL:erna; med den JS-läsbara CSRF-cookien = sessionskapning av den som
  klickar (inkl. admin). Fix: filtyp-whitelist + magic-koll (`_validate_members`/
  `_extract`) - `.jpg`/`.png` med HTML-innehåll avvisas.
- **[ÅTGÄRDAT 06582ce] HÖG (backend) Import lämnade spök-DB-rad vid fel.** DB-raden
  commit:ades före extrahering; ett fel mitt i lämnade en tur pekande på halvskriven mapp,
  och icke-ValueError blev 500. Fix: try/except runt rad+extrahering -> rollback (radera
  rad + rmtree) + rent 400.
- **[ÅTGÄRDAT 06582ce] MEDEL (säkerhet) Ingen storleks-/zip-bomb-gräns på import.** Fix:
  tak på uppladdad (komprimerad) + total uppackad storlek (`SVK_MAX_BACKUP_MB=3000`).
- **[ÅTGÄRDAT d22268a] HÖG (frontend) "Släng alla ändringar" reverterade inte
  startriktning (yaw/pitch)** -> ett kasserat värde kunde tyst sparas senare. Fix:
  discard() återställer nu ya/pi + cfg. Verifierat: Sätt 90° -> Släng -> tillbaka till sparade.
- **[ÅTGÄRDAT d22268a] MEDEL (frontend) Batch-massradering läckte in i bild-VÄLJAREN.**
  Kryssrutor + "Ta bort markerade" i modalen där man plockar EN bild. Fix: gate:a selection
  på `!opts.onPick`.
- **[ÅTGÄRDAT f202512] MEDEL (backend) `ensure_thumb` ej atomisk** -> race kunde ge
  permanent trasig cachad tumnagel. Fix: temp + `os.replace`.
- **[ÅTGÄRDAT f202512] MEDEL (backend) readiness/export varnade inte om RADERAD refererad
  poolbild** -> tyst trasig bild i publicerad tur. Fix: readiness() varnar.
- **[ÅTGÄRDAT d22268a] LÅG (frontend) Slider fastnade i drag-läge utan `pointercancel`.**
- **[SENARELAGT] LÅG (frontend) tour-preview.js klonar inte hotspots** (bryter det
  dokumenterade klon-kontraktet). Ej akut - `tour-preview.js` serialiserar aldrig
  `tour.scenes` till servern (bara `default`/presets). Förebyggande fix (kör hotspots
  genom klon-mönstret som scene.js) skjuten för att inte riskera preview-regression nu.
- **[AVFÄRDAT] LÅG Medieimport återanvänder exportörens filnamn** (blind overwrite):
  48-bitars hex-prefix -> kollision praktiskt omöjlig; re-import är idempotent.
- **[AVFÄRDAT] LÅG/INFO** `ensure_thumb`/`generate_preview` saknar explicit
  decompression-bomb-hantering (fångas av brett `except`), och `setInterval` för
  view-indikatorn rensas aldrig (ofarligt i MPA - dör med sidan).
- **[VERIFIERAT RENT]** preset-sanering + ägar-scoping, CSRF-täckning på alla nya
  muterande endpoints, media-ägarskap + traversal-guards, XSS (escapeHTML + DOMPurify,
  belowLabel via textContent), invite-fixen, djuplänknings-prioritet, reciprok-fixen,
  delsträngs-slug-omskrivning, `display_name` hex-strippning.

Verifiering: 101 backend-tester gröna (nya: filtyp-whitelist, saknad-poolbild). Kritiska
fixarna verifierade end-to-end (riggad `.html`/`.jpg` -> 400 + rollback; discard-revert;
väljare utan batch; atomisk thumb). Ny todo i ROADMAP: version/schema-kompatibilitet för
turer & arkiv.

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
- **[ÅTGÄRDAT 3e6f9e2 + e180514] S3 (MEDEL)** rate limiting bara på login + fel IP bakom
  proxy. Fix: `ratelimit.client_ip` (config.TRUST_PROXY, tar SISTA XFF-posten efter
  granskningsfynd - första är spoofbar), login + accept-invite rate-limitas per riktig IP.
- **[ÅTGÄRDAT 3e6f9e2] S4 (MEDEL)** race på map.json. Fix: plan.py `save_map` validering +
  `write_map` under delade `tour_lock` (granskning bekräftade att alla write_map/write_tour-
  punkter delar samma lås).
- **[ÅTGÄRDAT 3e6f9e2 + e180514] S5 (LÅG)** lösenordspolicy + bild-guard. Fix: delad
  `auth.password_error` (>=8, ej bara siffror, blocklist) i accept-invite/profil/admin;
  `validate_image_dimensions` (megapixel-tak) på ALLA uppladdningar OCH projekt-import
  (`_check_extracted_image`) + per-fil-tak + global `Image.MAX_IMAGE_PIXELS`. Default
  admin/admin-bytet MEDVETET kvar till produktionssättning (Rasmus).
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
