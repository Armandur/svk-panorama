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

- [x] **Ta bort enskild tur KLAR (2026-07-11).** `POST /projects/{slug}/delete`
      (`app/routes/projects.py`), gated med `get_project_or_404` (ägare eller admin)
      + CSRF. Raderar DB-raden + hela projektmappen (`delete_project_files` med
      traversal-guard) + glömmer in-memory tiling/export-jobb (`forget_job` i
      `services/tiling.py` + `bundle.py`). Radera-knapp på huvudmenyn (`index.html`)
      och på admins turlista (`admin_user_projects.html`); admin-radering av annans
      tur -> tillbaka till den användarens turlista. Bekräftelsedialog. Löser delvis
      "radera/överför turer innan man tar bort en ägande användare".

- [x] **Redigera slug KLAR (2026-07-11).** `POST /projects/{slug}/rename-slug`
      (`app/routes/projects.py`), gated med `get_project_or_404` + CSRF. Slugifierar
      ny slug, vägrar upptagen slug och pågående tiling/export (`_job_running`), byter
      mappnamn (`rename_project_files`, traversal-guard + vägrar om målet finns),
      uppdaterar DB-raden och glömmer jobb på gamla slugen (`forget_job`). Diskret
      utfällbar "Adress (slug)"-sektion på uppladdningssidan med varning om att
      bokmärkta /view-länkar och byggda bundlar bryts. Blir team-scopad unikhet när
      Fas 4 landar.

## Grundfunktioner (före Fas 4)

Luckor identifierade 2026-07-11 innan team-arbetet.

- [x] **Byt turens visningsnamn KLAR (2026-07-11).** `POST /projects/{slug}/rename`
      (gate + CSRF) uppdaterar `Project.name`. Fält i "Turinställningar"-sektionen på
      uppladdningssidan (bredvid slug-bytet).
- [x] **Rate limiting på login KLAR (2026-07-11).** In-memory fixed-window per IP
      (`app/services/ratelimit.py`, 10 misslyckade/15 min -> 429). Efemärt, inga
      IP-adresser persisteras. Nollställs vid lyckad login.
- [x] **Vänliga felsidor KLAR (2026-07-11).** HTTPException på sid-navigering
      renderar `error.html` (kod + meddelande + hem-länk) i stället för rå JSON;
      API/JSON-klienter får fortfarande JSON. 401 -> login, 403 -> hem som förut.
- [x] **Konfigurerbart tjänstenamn KLAR (2026-07-11).** Env-default (`SVK_SITE_NAME`)
      + DB-override (`Setting`-tabell, `app/services/settings.py`) redigerbar av
      super-admin på `/admin/settings`. Exponeras som Jinja-globalen `site_name` så
      alla mallar (brand + titlar) läser samma värde. DB-värdet vinner över env.
- [x] **Publik delningslänk för en tur KLAR (2026-07-11).** `Project.share_token`
      (oigissbar, `secrets.token_urlsafe`). Publika routes (`app/routes/public.py`):
      `/s/{token}` renderar vieweren utan auth, `/s/{token}/{path}` serverar
      läs-only assets med traversal-guard. Tour-paths skrivs om
      `/projects/{slug}/` -> `/s/{token}/` (viewer.html tar `asset_base`). Skapa/
      sluta-dela på preview-steget (`/projects/{slug}/share` + `/unshare`); länken dör
      direkt vid unshare. Bundle-export fortsatt "publicera för self-host".

## Buggar & UX-fixar (att ta)

Upptäckt 2026-07-11 under genomgång.

- [x] **Färgväljare-lib i stället för native `<input type="color">` KLAR (2026-07-11).**
      Vendorade **Coloris** (`static/vendor/coloris/`, ingen CDN). Tema-färgerna
      (`#theme-dot`/`#theme-current`) är nu Coloris-fält (hex, `data-coloris`), initieras
      i preview.html. Befintlig `input`-wiring och hex-utdata oförändrad (servern
      validerar `#rrggbb`). Endast editor-sida - påverkar inte bundle/runtime.
- [x] **Startscen-modalens kartprickar ritas inte FIXAT (2026-07-11).** Prickarna
      byggdes korrekt men var osynliga: `.preview-dot` hade `background: var(--dot-color)`
      utan fallback, och temavariablerna definieras bara på `.panorama-wrap` - start-
      modalen ligger utanför den. Lade fallback-värden (`var(--dot-color, #666666)` /
      `var(--current-dot-color, #8b0000)`) så prickar syns var som helst.
- [x] **Temats typsnitt ger ingen synlig effekt FIXAT (2026-07-11).** Pannellum
      sätter `font-family` på `.pnlm-container` och ALL text (titel, info, hotspot-
      tooltips) ärver därifrån - men både preview (app.css) och runtime (viewer.css)
      override:ade bara `.pnlm-title-box`/`author-box`, aldrig containern. Så temats
      typsnitt nådde aldrig tooltips (huvudtexten). Bytte båda till att override:a
      `.pnlm-container` med `!important`. Verifierat: font byts live sans->serif på
      containern; tooltips ärver. (För att SE det i previewen krävs synlig pannellum-
      text, dvs. hotspot-tooltip vid hover eller en titel.)

## Rich text & markdown (info-hotspots + redigerbara texter)

Beslutat 2026-07-11 (UX-genomgång). Mål: rikare formattering på info-hotspots och
återanvändbar markdown-rendering + redigering i hela appen.

**Bibliotek (alla självhostade i `static/vendor/`, ingen CDN):**
- **Rendering:** `marked` (md -> HTML) + **DOMPurify** (sanering, XSS-skydd - publika
  besökare och framtida andra tenants ser innehållet). En delad hjälpare
  `renderMarkdown(md) -> säker HTML`. Liten payload -> laddas även i viewer/bundle.
- **Redigering:** `EasyMDE` (toolbar + live-preview, CodeMirror). Laddas bara på
  editor-/admin-sidor, inte i publika viewern. Sätt `previewRender` till vår
  DOMPurify-sanerade renderare.

**Datamodell (info-hotspots):** markdown genomgående; en flagga styr presentationen,
inte innehållstypen. Fält: `teaser` (kort, visas i tooltip) + valfri `body` (lång
markdown) + `expandable` (bool). Bakåtkompatibelt: befintlig ren text = giltig
markdown. Ingen migration.

**Interaktion:** inline-läge = markdown i tooltip/popover (hover dator / tap mobil).
Expanderbart läge = teaser i tooltip, klick öppnar **fullskärms-ark** (panoramat
dimmat bakom, stängbart med X/Escape/backdrop, scrollbart, fullskärm på mobil).
Expanderbara hotspots får en affordans-ikon (t.ex. "+"). Pannellum:
`createTooltipFunc` (rendera md) + `clickHandlerFunc` (öppna arket).

Faser (minst till störst):

- [x] **1. Markdown-infra + redigerbar arbetsgångstext KLAR (2026-07-11).** Vendorade
      marked + DOMPurify + EasyMDE + FontAwesome 4.7 (EasyMDE:s toolbar-ikoner), allt
      självhostat i `static/vendor/`. Delad `static/markdown.js`
      (`window.renderMarkdown` = marked -> DOMPurify). Startsidans "Hur funkar det
      (arbetsgång)" renderas som markdown (`.markdown-body`). Redigerbar av super-admin
      på ny kategori `/admin/settings/texts` (`admin_texts.html`) med EasyMDE (preview
      via renderMarkdown); lagras i `Setting` (`workflow_text`, DB-override, default =
      `WORKFLOW.md` tills admin sparar). `Setting.value` -> `Text` (lång text).
- [x] **2. Markdown i info-hotspots (inline) KLAR (2026-07-12).** Info-hotspots
      renderas som sanerad markdown i tooltipen via pannellums `createTooltipFunc`
      (`markdown.js`: `mdHotspotTooltip` + `attachHsTooltips`, kopplas på kloner i
      scene.js/tour-preview.js/viewer.js). Hotspot-editorn: textarea + markdown-hint +
      live-preview. marked+DOMPurify+markdown.js laddas på scen/preview/viewer och
      inkluderas i bundlen (bundle.py). Gäller även publika /s-vyn. (EasyMDE i själva
      hotspot-modalen valdes bort - textarea+preview räcker och är lättare.)
- [x] **3. Expanderbara hotspots (läs mer) KLAR (2026-07-12).** Info-hotspots får
      `expandable` + `body` (markdown). `text` = teaser i tooltipen, klick öppnar ett
      fullskärms-ark (`markdown.js: openHsSheet`, dimmat panorama, stängs X/backdrop/
      Escape, responsivt) med renderad body. Affordans: "+"-märke via `cssClass`
      (`pnlm-hotspot pnlm-info hs-expandable`) + `clickHandlerFunc`. Editor: kryssruta
      "Expanderbar" (bara info-typ) + body-textarea med live-preview; save persisterar.
      Fungerar i scen/preview/runtime/bundle/publik /s.
- [ ] **4. Bilder i hotspot-body.** Ladda upp bilder i projektet (media-/
      attachments-mapp per tur), referera via markdown-bildsyntax. Måste inkluderas +
      relativiseras i bundle-exporten och nås via publika /s-routen. Enkel
      media-hantering i editorn (ladda upp -> få markdown-snutt att klistra in).

- [x] **Karta-knappen försvinner i pannellum-helskärm FIXAT (2026-07-12).**
      `viewer.js` flyttar kart-knappen + överlägget in i det fullskärmade elementet
      vid `fullscreenchange` (och tillbaka till body när man går ur) - robust oavsett
      vilket element pannellum fullskärmar. Gäller runtime-viewern + bundlen + publika
      /s-vyn. (Ej browser-testad i äkta helskärm - headless stödjer inte fullscreen.)

- [x] **Avstavning/radbrytning i små info-hotspot-rutor FIXAT (2026-07-12).** Löstes
      ihop med markdown fas 2: `.pnlm-tooltip span.hs-md` fick `word-break: normal`,
      `overflow-wrap: break-word`, `hyphens: none`, `max-width: 280px` och vänsterställd
      text (i app.css + viewer.css). Korta ord (t.ex. "Test123") bryts inte längre.

- [x] **Upplösningsväljare i preview-steget KLAR (2026-07-12).** Multires appliceras
      nu klient-side i `tour-preview.js` (defaultar multires) i stället för i
      `preview.py`, så rå tur + manifest bäddas in. "Vy"-sektion med väljare
      preview/multires/full i preview.html; byte bygger om vieweren (behåll scen/vy),
      scener utan tiles faller till preview. Fixade även att aktuell scen inte
      markerades på kartan förrän man bytte scen (`buildDots` kallar nu `markCurrent`).

- [ ] **Fler typsnitt i temat (särskilt DM Sans).** Idag är tema-typsnitten
      system-font-stackar (sans/serif/mono/humanist - inga font-filer, självbärande
      bundle). Lägg till fler val, framförallt **DM Sans**. OBS avvägning: riktiga
      webbtypsnitt kräver self-hostade `woff2`-filer (vendora, ingen CDN) som måste
      inkluderas i bundle-exporten och den publika /s-vyn - dvs. bundlen växer. Väg
      mot att behålla systemstackar som lätta default. Uppdatera `FONTS` i
      `tour-preview.js` + `viewer.css` + font-validering på servern.

- [ ] **Uppdatera WORKFLOW.md.** Verkar inaktuell och stundtals för teknisk för sin
      publik (fotografer) - t.ex. referenser till `js/geo.js` m.m. Skriv om till en
      användarnära arbetsgång (den renderas ju nu som markdown på startsidan och är
      redigerbar av super-admin). Skilj på fotografens steg-för-steg och de tekniska
      utvecklarnoterna (de senare hör hemma i CLAUDE.md, inte WORKFLOW.md).

## Fas 4 - Team & egna domäner (multi-tenancy nivå 2)

Bakgrund (2026-07-11): för att erbjuda editorn till andra behöver turer kunna ägas
av ett **team** (organisation), inte bara en enskild användare, och varje team vill
kunna köra på **egen domän/subdomän**. Målbild: super-admin (jag) sköter bara infra
(reverse proxy + TLS-baslinje); team-admin sköter sitt teams användare, turer och
domän själv. Fortsatt single-host Docker (inget S3/kö/multi-instans, jfr Fas 3).

- [ ] **Team-modell (nivå ovanpå User).** Ny `Team` (id, namn, slug, base_url,
      created_at). `User.team_id` (FK, **nullable**) + `User.team_role`
      (member|team_admin) vid sidan av globala `is_admin` (super-admin).
      **Beslutade produktval (2026-07-11):**
      - **Team är valfritt.** En enskild användare kan finnas helt utan team
        (`team_id=NULL`) och äger då sina turer själv (`Project.owner_id`,
        `team_id=NULL`). Inget tvingar in någon i ett team.
      - **Vem som helst kan starta ett team** (self-serve, inte bara super-admin).
        Skaparen blir `team_admin`. En användare tillhör ett team (enkelt FK; join-
        tabell för fler-team lämnas till framtiden om det behövs).
      - **Inom ett team delas allt** - alla medlemmar kan se OCH redigera alla
        teamets turer (ingen per-tur-rollgrind). Teamet äger turen via
        `Project.team_id`; `owner_id` behålls bara som "skapad av" (spårbarhet).
      Gaten i `get_project_or_404` blir: släpp igenom om super-admin ELLER (turen
      har team och `user.team_id == project.team_id`) ELLER (turen saknar team och
      `project.owner_id == user.id`). En användare kan alltså ha både personliga
      turer (team_id NULL) och teamturer samtidigt.
      Bootstrap: super-admin utan team; befintliga användare/turer förblir team-lösa
      vid migrering (personliga). Pre-produktion: blås DB + ev. engångsskript om/när
      disk-namespace ändras (se nästa punkt).
- [ ] **Team-scopad slug + disk-namespace.** Med team behöver slug bara vara unik
      PER TEAM (teamA och teamB kan båda ha `tour1`). Disklayout: teamturer under
      `projects/<team_slug>/<slug>/`, team-lösa (solo) turer kvar platt i
      `projects/<slug>/` (eller ett namespace för personliga). Solo-slugs förblir
      globalt unika; teamslugs unika inom teamet. Uppdatera alla path-helpers
      (`project_dir` m.fl.), jobb-dict-nycklar och `get_project_or_404` (team-gate).
      Stor refaktor - efter team-modellen. Låser upp "Redigera slug" ovan till att
      bli enklare (unikhet bara inom teamet för teamturer).
- [ ] **Team-admin-UI.** Team-admin hanterar sitt teams användare (bjud in/skapa/
      spärra/promota till team_admin - återanvänd Skiva 2-3-flödet men team-scopat),
      ser teamets alla turer och sätter teamets `base_url`. Super-admin får team-lista
      (skapa team, sätt/nolla domän, se alla). `require_team_admin`-gate analogt med
      `require_admin`.
- [ ] **Egna domäner per team.** `Team.base_url` används för alla genererings-/
      delningslänkar (ersätter globala `SVK_BASE_URL`) - invite-länkar, export, /view.
      Host-baserad tenant-resolution: middleware slår upp request-Host -> team så
      `kyrkanxyz.se/...` löser teamets innehåll. TLS/proxy: **Caddy on-demand TLS** +
      ask-endpoint (`GET /internal/tls-allowed?host=`) som svarar 200 bara om ett team
      claimat domänen -> cert utfärdas automatiskt, super-admin rör inte Caddy per
      kund (konfigureras en gång). Kund pekar DNS mot servern, team-admin lägger till
      domänen i appen. **Domänverifiering krävs** (TXT-record/verifieringstoken) innan
      en domän aktiveras - annars kan team A claima team B:s domän eller trigga
      cert-utfärdande för godtycklig host. Överväg wildcard-subdomän
      (`<team>.svk-panorama.se`) som nollkonfig-default före egna domäner.

- [ ] **Vid produktionssättning:** återinför Alembic (baslinje ur då-aktuella
      modeller), byt admin/admin mot riktiga creds, ev. Postgres via docker-compose.
      Pre-produktion: inga migrationer - schemaändring = radera svk.db + starta om
      (create_all + seed; projektmappar adopteras av admin).
