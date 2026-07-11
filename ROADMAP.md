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

- [x] **Skiva 1: auth + projekt-ägarskap** (commits 5f86954, 9eed826). Sluten
      inbjudan, bcrypt-login, signerad session, `User` + `owner_id`, ägar-gate.
- [x] **Skiva 2: admin-UI + inbjudningsflöde** (commit 76f21e7). /admin/users:
      lista/skapa/ta bort användare, signerad inbjudningslänk (7 dygn) -> den
      inbjudne sätter eget lösenord (/accept-invite) + auto-login.
- [x] **Stäng static-lucka + Admin-meny + profilsida** (commit c259c8f). Öppna
      /projects-mounten ersatt av ägar-koll:ad fil-route; "Användare" under
      Admin-dropdown; /profile (namn + byt lösenord) per användare.
- [x] **Kontokort (M365) + avatar + admin-vy + admin ser egna** (commits b17af32,
      550131f, b536880, a30793c). Kontokort med utfällning, avatar (blob + interaktiv
      crop i `account.js`), `/admin` sidebar-vy, admin ser bara egna turer på index,
      andras via Användare -> `/admin/users/{id}/projects`.

- [x] **Skiva 3 KLAR (2026-07-11): admin-hantering av användare + batch-verktyg.**
      **A. Användardetaljsida** `/admin/users/{id}` (`admin_user_detail.html`): admin
      sätter namn, lösenord (override, inget nuvarande), byter/tar bort avatar och
      togglar active/is_admin - allt på användarens vägnar. Avatar-crop generaliserad:
      `_avatar_modal.html` parameteriserad (data-post-url/data-delete-url + klasser i
      stället för id:n), crop-logiken bruten ut ur `account.js` till factoryn
      `static/avatar-crop.js` (`window.initAvatarCrop({modal, openBtn, onOpen})`);
      `account.js` (egen profil) och `admin-user.js` (target-user) anropar den. Admin-
      avatar-routes speglar profile.py (`_process_avatar` importeras därifrån).
      **B. `active`-bool på User** - spärrat konto nekas i `auth._user_from_session`
      (session ogiltig) + login i `routes/auth.py`. Self-guard: kan inte spärra/
      demota sig själv.
      **C. Batch** på `/admin/users`: kryssrutor (`admin-users.js`) + åtgärdsrad ->
      `POST /admin/users/batch` (reset_password/disable/enable/delete), self- och
      ägar-guards, summeringsmeddelande. Listan länkar nu e-post till detaljsidan,
      visar Aktiv/Spärrad/Inbjuden-status.
      Promota/degradera admin + "skicka om inbjudan" (invite-länk på detaljsidan)
      ingår. Kvar som framtida förslag: överför ägarskap, last_login, sök/filtrera.

- [ ] ~~**Skiva 3: admin-hantering av användare + batch-verktyg.**~~ BÖRJA HÄR efter
      en clear (läs först minnet `svk-panorama-project.md` + denna fil; starta
      testinstans på ledig port `svc port`, login admin/admin).
      **A. Användardetaljsida** (utöka `/admin/users/{id}/projects` ELLER ny
      `/admin/users/{id}`): admin ska kunna göra allt användaren gör via sin
      Inställningar-knapp, PÅ användarens vägnar - byt namn, byt lösenord (utan att
      kräva nuvarande, admin overrider), byt/ta bort profilbild, + kommande
      inställningar. ÅTERANVÄND logiken i `app/routes/profile.py`
      (`_process_avatar`, `hash_password`, avatar-routes) men gör admin-varianter
      som tar `user_id` + `require_admin` i stället för `require_user`. Avatar-crop-
      UI:t finns i `account.js` + `_avatar_modal.html` - kan generaliseras till att
      posta mot en target-user-route.
      **B. Spärra/avaktivera konto:** lägg `active`/`disabled`-bool på `User`
      (`app/database.py`; pre-produktion = blås svk.db). Kontrollera i
      `app/auth.py` (`_user_from_session` + login i `routes/auth.py`) så en spärrad
      användare inte kan logga in / får sessionen nekad. Toggle i användardetaljen.
      **C. Batch-verktyg på `/admin/users`:** kryssrutor per rad + en åtgärdsrad
      (markera flera -> kör). Minst: tvinga lösenordsbyte/reset (nolla
      `password_hash` -> användaren måste sätta nytt via inbjudningslänk, ELLER en
      `must_change_password`-flagga som tvingar byte vid nästa login), inaktivera/
      aktivera, ta bort. Formulär postar valda id:n till en batch-endpoint i
      `app/routes/admin.py`.
      **Fler verktygsförslag:** promota/degradera admin (toggla `is_admin`, saknas i
      UI idag); "skicka om inbjudan" (länken visas redan för pending); överför
      ägarskap av en användares turer till annan (behövs innan man tar bort en
      användare som äger turer - delete-guarden blockerar idag); `last_login`-kolumn
      + kolumn i listan för aktivitetsöversikt; sök/filtrera användare när listan
      växer. Alla gated med `require_admin`, CSRF på POST.

- [ ] **Ta bort enskild tur.** Idag finns ingen funktion för användare/admin att
      radera en hel tur - bara enskilda scener på uppladdningssidan. Behövs: en
      radera-knapp (huvudmenyn per tur och/eller projektsidan) som tar bort DB-raden
      (`Project`) + projektmappen på disk (`projects/<slug>/` med bilder/tiles/
      export). Endpoint i `app/routes/projects.py`, gated med `get_project_or_404`
      (ägare eller admin) + CSRF, bekräftelsedialog. Admin ska kunna radera andras
      turer (nås via Användare -> turer). Städa även ev. pågående tiling/export-jobb
      för slugen. Löser dessutom delvis "överför/radera turer innan man tar bort en
      ägande användare" (se admin-verktygsförslagen ovan).

- [ ] **Vid produktionssättning:** återinför Alembic (baslinje ur då-aktuella
      modeller), byt admin/admin mot riktiga creds, ev. Postgres via docker-compose.
      Pre-produktion: inga migrationer - schemaändring = radera svk.db + starta om
      (create_all + seed; projektmappar adopteras av admin).
