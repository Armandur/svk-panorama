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

- [ ] **Kalibreringsstatus ska visas i Kalibrera-kortet (Rasmus 2026-07-13).**
      "Kalibrerad (offset 88.39 grader)" sätts idag på `calibStateEl` (scene.js
      rad ~443) men hamnar fel - det ska visas inne i Kalibrera-kortet/-sektionen
      så man ser scenens aktuella nordoffset där. Flytta/rendera statusen i rätt kort.

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
- [x] **4. Bilder i info-hotspots KLAR (2026-07-12).** EasyMDE-editorn har
      bilduppladdning (upload-image-knapp + drag/paste) i BÅDA fälten (teaser + läs
      mer), oberoende av expanderbar. `POST /projects/{slug}/attachments` sparar till
      `projects/<slug>/attachments/` (validering + CSRF-header) och returnerar URL som
      infogas som markdown. Renderas i tooltip/ark/runtime; publika /s skriver om
      `/projects/<slug>/` -> `/s/{token}/` (befintlig JSON-replace). Bundle: attachments-
      mappen kopieras och bild-URL:erna relativiseras (`_relativize` + `_collect`).
      **Markdown-funktionen (fas 1-4) därmed KLAR.**
- [x] **Mediebibliotek v1 (per-projekt) KLAR (2026-07-12).** `media-library.js`
      (`window.openMediaLibrary`) + `GET /projects/{slug}/attachments` (lista) +
      `POST .../{name}/delete`. Knapp i hotspot-editorns EasyMDE-toolbar: bläddra
      miniatyrer, ladda upp, radera, välj (infogar markdown-bildlänk). Direktuppladdning
      via EasyMDE:s bild-knapp. **ERSÄTTS av delad pool nedan.**

- [x] **Mediebibliotek v2: DELAD POOL PER ÄGARE + administrationsvy KLAR (2026-07-12,
      commit 749dbad).** Egen /media-sida (nav-knapp). Spec nedan implementerad rakt av;
      backend + hela API-flödet (upload/serve/traversal/list-usage/delete) verifierat
      via curl, /media-sidan shot-verifierad. EasyMDE-picker-modalen (scene.js) inte
      driven end-to-end i browser men delar exakt samma fetch/render som den verifierade
      hanteringsvyn. `_safe_suffix` SANERAR uppladdningsnamn (inte hård avvisning som
      panorama-filer, hex-prefix ger unikhet). Testdata-attachments städade.
      Beslut 2026-07-12 (Rasmus valde pool framför per-projekt): flytta
      bilderna från per-projekt (`projects/<slug>/attachments/`) till en **pool per
      ägare**, återanvändbar mellan projekt, med metadata + härledd användning + filter,
      och en dedikerad administrationsvy. "Ägare" = `User` nu (Team i Fas 4).

      **Ingen migrering behövs (Rasmus 2026-07-12):** befintlig
      `projects/harnosands-domkyrka/attachments/9ae126dd-map.jpg` + dess referens i den
      turens tour.json är BARA TESTDATA - städa bort den (radera mappen + ta bort
      ev. hotspot-referens i tour.json) i stället för att migrera. Ren start på poolen.

      **Lagring:** `media/<owner_id>/<name>` under nytt `config.MEDIA_DIR`
      (`REPO_ROOT/media`, env `SVK_MEDIA_DIR`, gitignorat). owner_id = `User.id`.
      Filnamn: `secrets.token_hex(6) + "-" + safe_upload_name(orig)` (oigissbart).

      **URL + servering:** bilder refereras i hotspot-markdown som absolut
      `/media/<owner_id>/<name>`. Serva via `GET /media/{owner_id}/{name}` **publikt per
      oigissbar URL** (capability-URL, som share-token-modellen) - traversal-guard, men
      ingen auth-grind (annars funkar inte publika /s-vyn utan att känna till token per
      bild). Motivering: namnen är oigissbara, listning/hantering är auth-grindad, och
      bilderna är turinnehåll ämnat att visas. SÄKERHETSNOT: en bild som bara refereras i
      en privat (odelad) tur är ändå serverbar om någon har exakt URL - låg risk för beta.
      Fördel: funkar identiskt i editor + publik /s + bundle utan URL-omskrivning
      (till skillnad från `/projects/<slug>/`-URL:erna som public.py skriver om).

      **Endpoints (ny `routes/media.py`, registrera i main.py FÖRE assets-catchall):**
      - `POST /media/upload` (require_user, CSRF-header): spara till `media/<user.id>/`,
        returnera `{url, name, ...}`. Validera magic + storlek (jfr uploads.py).
      - `GET /media/list` (require_user): lista current users pool med metadata:
        `name, url, size` (stat), `width/height` (PIL `Image.open`), `mtime`
        (uppladdningsdatum), `usage` = härledd lista `[{slug, name, count}]`.
      - `POST /media/{name}/delete` (require_user, CSRF-header): radera ur
        `media/<user.id>/<name>`, traversal-guard.
      - `GET /media/{owner_id}/{name}`: FileResponse, traversal-guard, ingen auth
        (capability-URL). Admin/owner ser den; publik /s når den direkt.

      **Härledd användning (ingen DB-tabell):** skanna current users projekt
      (`Project.owner_id == user.id`) sina `tour.json` efter strängen
      `/media/<user_id>/<name>` i alla `hotSpots[].text` + `.body`. Bygg map
      `{name: [usages]}` en gång per list-anrop. Räkna även otillhörande = kan raderas.

      **Filtrering i biblioteket:** filter "Används i denna tur" / "Oanvända" / "Alla" /
      per projekt. `media-library.js` får en filter-rad; picker-läget kan förvälja
      current projekt. Behåll `openMediaLibrary(onPick)` men byt käll-URL till `/media/*`
      (slug behövs ej längre för listan; skicka current slug bara för filtret).

      **Administrationsvy:** egen route/sida (t.ex. `/media` eller sektion under Admin
      eller på projektsidan) med tabell/grid: miniatyr, pixelmått (WxH), lagringsstorlek,
      uppladdningsdatum, "används i" (klickbar lista). Radera med användnings-varning
      (confirmDialog). Ev. döp om. Återanvänd media-library.js-komponenten.

      **Bundle (`bundle.py`):** hotspot-markdown har nu `/media/<owner_id>/<name>`.
      I `_relativize`: skanna `hotSpots[].text/.body` efter `/media/<owner_id>/`-URL:er,
      byt till relativa `media/<name>`. I `_collect`: kopiera de REFERERADE poolbilderna
      (inte hela poolen) till `media/<name>` i zipen. (Ta bort gamla
      `attachments/`-hanteringen när migrering är klar.)

      **Repoint befintligt:** `scene.js` `uploadHsImage` + `mediaAction` -> `/media/*`.
      `media-library.js` -> `/media/*`. Ta bort per-projekt-attachments-endpoints i
      `uploads.py` (eller behåll som deprecated tills migrering körts). Publika /s
      behöver INGEN ändring (media-URL:er är absoluta + publika).

      **Fas 4-koppling:** när Team byggs blir owner_id ett Team-id och poolen delas i
      teamet. `/media/<owner_id>/`-strukturen håller (owner_id = team_id då). Usage-scan
      blir per-team-projekt.

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

- [x] **Scen-hotspots: rendera markdown + dubbla rutor KLAR (2026-07-12).**
      `attachHsTooltips(hotSpots, sceneNames)` MD-renderar nu scen- OCH URL-hotspots;
      scen-hotspots får teaser (MD) ovanför + "→ målscen"-etikett (`belowLabel`,
      `.hs-scenelabel`) nedanför. `cloneHs` slutade skriva över texten. Callers bygger
      `sceneNames` (viewer.js/tour-preview.js/scene.js). Verifierat i editor + /view.
      Ursprunglig spec:
      (1) BUGG: markdown-text i en scen-hotspot (type=scene) renderas INTE som MD i
      /preview/viewern. Orsak: `attachHsTooltips` (markdown.js) villkorar MD-tooltipen på
      `h.type === "info"` -> scen/URL-hotspots får bara pannellums default-D()-rendering
      (nu escapad = platt text). Fix: låt attachHsTooltips MD-rendera även scen-hotspots
      med text.
      (2) UX: scen-hotspots ska visa teaser-texten (MD) OVANFÖR hotspoten och en
      "-> leder till Scen X"-etikett NEDANFÖR - i BÅDE /scenes-editorn och /preview (idag
      måste man till /preview för att se texten). Editorns `cloneHs` (scene.js) skriver
      idag ÖVER scen-hotspotens text med "Scen X"-etiketten -> användarens text göms.
      Ändra så texten behålls (teaser ovanför) och scen-etiketten läggs som en separat
      ruta nedanför. Kräver: ny/utökad createTooltipFunc i markdown.js som kan rita en
      etikett under hotspoten (positiv marginTop) utöver teasern ovanför; attachHsTooltips
      behöver målscenens namn (`tour.scenes[sceneId].title`) - resolva före anropet i
      viewer.js/tour-preview.js/scene.js. Fiddligt pannellum-tooltip-arbete över 4 filer
      -> browser-verifiera (shot/Playwright) i editor, /preview, /view och bundle.

- [x] **BUGG: grå text i expanderad hotspot i scenvyn FIXAT (2026-07-12).** Pico
      (editor/preview) satte `color` direkt på `p`/`h`/`li` -> slog arvet från
      `.hs-sheet-inner` (#1c2128) så texten blev grå (#373c44). Fix i app.css:
      `.hs-sheet-body p,li,h1-4,blockquote { color: inherit }`. Publicerade vieweren
      laddar inte Pico -> var redan mörk. Verifierat: p-färg #1c2128. I `/projects/X/scenes` är
      texten i det expanderade hotspot-arket (`.hs-sheet` / `.hs-sheet-body.markdown-body`,
      byggs i `app/static/markdown.js` `openHsSheet`) grå i stället for svart. Färgerna
      i `viewer.css` (`.hs-md`/`.hs-sheet*`) är satta för viewerns MÖRKA kontext; i
      editorns ljusa ark blir texten grå/otillräcklig kontrast. Sätt en explicit mörk
      textfärg på arket i editor-kontexten (app.css) - kolla att viewern/bundlen/publika
      /s inte påverkas.

- [x] **Projekt-backup/import KLAR (2026-07-12).** Redigerbar projekt-zip (rådata:
      tour/map/map.png/images/tiles/media + manifest) via `services/backup.py` +
      `routes/backup.py`. Export = trådat jobb + knapp på preview-steget; import =
      `POST /projects/import` (zip-slip-guard, media in i importörens pool, `/projects/
      <slug>/` + `/media/<owner>/` skrivs om), import-knapp på startsidan. Löser
      "flytta/säkerhetskopiera en redigerbar tur" (granskningens produkt-"bör") och att
      bundlen saknade källbilder för tilade scener.

- [x] **Version/schema-kompatibilitet för turer & arkiv KLAR (2026-07-12).** Beslut:
      **additiv-först + version-gate vid import.** `config.SCHEMA_VERSION` (=1); `tour.json`
      stämplas med `schemaVersion` vid varje `write_tour`, backup-manifestet skriver samma
      `version`, och `backup._check_archive_version` avvisar arkiv med högre version än
      verktyget stödjer (äldre/samma/saknad godtas, defaultar fyller nya fält). Policyn
      dokumenterad i CLAUDE.md. Migrationskedja (v1->v2) läggs FÖRST när en brytande
      ändring faktiskt behövs. Ursprunglig utredning nedan (behållen för kontext):
- [~] **~~Reda ut version/schema-kompatibilitet för turer & arkiv (Rasmus 2026-07-12).~~**
      Risk: en tur exporterad/skriven med en version av verktyget kan bli inkompatibel
      när schemat (tour.json) ändras - gäller BÅDE projekt-import (arkiv från annan/äldre
      instans) OCH tour.json på disk när verktyget uppdateras. Idag: `project.json` bär
      `format`+`version` (VERSION=1 i backup.py) men importen kollar bara `format`, inte
      version-intervall; tour.json har ingen egen version. Att utreda/besluta:
      - **Additiv-schema-först (billigast, matchar pre-prod-etoset):** nya fält är
        valfria med defaults, ta aldrig bort/döp om -> gammal och ny läser varandra,
        okända fält ignoreras. Bumpa version BARA vid brytande ändring.
      - **Version-koll vid import:** avvisa arkiv vars version > verktygets max-stödda med
        tydligt meddelande ("skapad med en nyare version, uppdatera verktyget"). Äldre ->
        acceptera (om additivt) eller migrera.
      - **Migrationskedja för tour.json** (v1->v2 ...) vid brytande ändringar - en liten
        registry av migrate-funktioner som körs vid import OCH vid läsning av gammal
        tour.json på disk (jfr Alembic men för JSON). Lägg ev. app/schema-version + verktygs-
        version (git-SHA) i project.json/tour.json för diagnostik.
      - Beslut: sätt en `SCHEMA_VERSION`-konstant, definiera kompat-policy (troligen
        additiv-först + version-gate vid import), och dokumentera i CLAUDE.md.

- [x] **Tema-förinställningar KLAR (2026-07-12).** Namngivna tema-/inställnings-presets
      per ägare (`ThemePreset`, services/presets.py, routes/presets.py). Spara/använd/
      radera på preview-steget + "standard för nya turer" (nya turer ärver via
      create_project). Config = tour.default-subset, saneras vid spar. **Tur-duplicering
      skrotad** (Rasmus 2026-07-12): det enda återanvändbara mellan turer är temat/
      inställningarna, inte scenerna - presets är rätt abstraktion.

- [ ] **Anpassningsbar logotyp/branding-overlay i vieweren.** Rasmus 2026-07-12.
      Låt användaren lägga ett branding-block i den publicerade turen (default nere till
      vänster): en logotyp (bild), en textrad och ev. länk till en webbsida.
      - **Redigering:** markdown-editor (EasyMDE, samma som hotspots) på preview-steget,
        med mediebiblioteks-knapp för logotypen (bilder ur poolen). Storleksinställning
        (liten/mellan/stor) + ev. positionsval (hörn).
      - **Lagring:** `tour.default.branding` = {content: markdown, size, position}. Ligg i
        `default`-blocket -> **kan bakas in i ThemePreset** så ett stifts logga/branding
        ärvs av alla deras turer (sanitize_config + preset-config utökas då).
      - **Runtime:** viewer.js/tour-preview.js renderar en `.branding`-overlay (absolut,
        default nere till vänster) via `renderMarkdown()` (DOMPurify-sanerad, samma väg som
        hotspots). Externa länkar: target=_blank + rel=noopener. Storlek via CSS-klass.
      - **Bundle:** `bundle.py` måste skanna `tour.default.branding.content` efter
        `/media/<owner>/`-referenser (utöver hotSpots) och relativisera + kopiera dem, annars
        saknas loggan i den exporterade bundlen. Publika /s + backup hanteras redan (absoluta
        media-URL:er). Gäller alla vyer (editor-preview/​/preview/​/view/​bundle).

- [x] **Fler typsnitt i temat KLAR (2026-07-13):** DM Sans + Spectral vendorade som
      self-hostade woff2 (latin-subset, ~82 KB, SIL OFL) i `static/vendor/fonts/`
      (`fonts.css` + 3 woff2; DM Sans variabel = en fil). Laddas i viewer/preview/bundle,
      `bundle.py` kopierar med dem (self-containment verifierad offline). FONTS-mappen
      (viewer.js/tour-preview.js/preset-library.js), font-validering (`_FONTS`) och alla
      typsnitts-selects uppdaterade. Systemstackarna kvar som lätta defaults.
      Kvar/senare: ev. kursiv-woff2 (nu faux-italic för *emfas*), latin-ext för fler accenter.

- [x] **Uppdatera WORKFLOW.md KLAR (2026-07-12).** Omskriven till en fotograf-vänlig
      guide i appens faktiska flöde (skapa/ladda upp -> placera/länka -> kalibrera/
      hotspots -> förhandsvisa/ställ in -> publicera), utan dev-referenser (js/geo.js,
      map.json, tangenter). Täcker nya funktioner: auto-tiling, mediebibliotek, rich
      text, startriktning, tema-förinställningar, delningslänk, backup/import.

## Funktionsluckor (Fable-granskning 2026-07-13)

Oberoende granskning (Fable) av vad som SAKNAS i det befintliga (redan breda)
funktionsomfånget. Prioriterat nedan. Rasmus beslut 2026-07-13 inflätade.

### Delnings-paket (quick wins) - KLART 2026-07-13

Tre relaterade delningsförbättringar. Gäller publika `/s/{token}`-vyn och/eller
bundlen; ingen datamodellsändring. Browser-verifierat (Playwright): OG-taggar på
`/s/`, QR-data-URL renderas, embed-snutt fylls. 121 backend-tester gröna.

- [x] **Open Graph / Twitter Card-metataggar KLART.** `viewer.html` (både
      inloggade `/view` och publika `/s/{token}`) + bundlens `bundle_index.html`
      har nu `og:type/title/description/image`, `og:url` och `twitter:card`.
      `og:image` = kartbilden `map.png`; absolut URL byggs i public.py/viewer.py ur
      `config.BASE_URL` eller `request.base_url`. Bundlen: relativ `og:image`
      (vet inte sin host - dokumenterat). Ingen `og:image` om turen saknar karta.
      **OBS multi-tenant:** absolut-URL-modellen har konsekvenser när team kör
      på egna domäner - se "OG + absoluta URL:er i multi-tenant" under Fas 4
      nedan. Måste hanteras INNAN egna domäner går live, annars pekar sociala
      förhandsvisningar fel.
- [x] **QR-kod för delningslänken KLART.** Vendorat `static/vendor/qrcode/qrcode.js`
      (Kazuhiko Arase, MIT, ingen CDN). `share.js` renderar QR (`qrcode(0,'M')
      .createDataURL` -> gif data-URL) + nedladdningsknapp i `.share-active`, fylls
      vid sidladdning och skapa/sluta dela. Bara editorn (preview-steget), inte i
      viewer/bundle.
- [x] **Embed-iframe-snutt KLART.** Readonly textarea med färdig
      `<iframe src=".../s/{token}" width=100% height=480 allowfullscreen loading=lazy>`
      + kopiera-knapp i `.share-active` (`share.js`).

### Fler quick wins (ej i första paketet)

- [x] **Gyroskop-toggle på mobil - INGET ATT BYGGA (2026-07-13).** Pannellum har
      redan en INBYGGD orienterings-knapp (`.pnlm-orientation-button`) som visas
      automatiskt när `DeviceOrientationEvent` finns **&& https && mobil-UA** (kollat
      i vendorade `pannellum.js`). Den hanterar även iOS-tillstånd (`requestPermission`).
      En egen knapp prövades men skrotades: den skulle ha SAMMA https+mobil-grind och
      därmed dubblera pannellums native-knapp i produktion (och löste inte "syns inte
      på test", vilket berodde på att dev-instansen är http - deviceorientation kräver
      secure context/https). Slutsats: lita på native-knappen. Verifiera på en
      https-deploy (som legacy-turerna i prod, där den redan syns).
- [x] **Disk-/lagringsöversikt för admin KLAR (2026-07-13).** `services/storage.py`
      (`dir_size` os.walk, `human_size`, `project_sizes`/`media_sizes`). **Egen flik
      `/admin/storage`** (`admin_storage.html`): totaler (disk/hos användare/ospårat)
      + drill-down per användare (`<details>` med turer störst-först + mediepool +
      total) + **Ospårat**-sektion (mappar utan matchande DB-rad). Även Lagring-kolumn
      på `/admin/users` och nedbrytning på `/admin/users/{id}`. `human_size` som
      Jinja-global.
      **TTL-cache KLAR (2026-07-13, byggd på Rasmus begäran):** `cached_dir_size`
      memoiserar mappstorlek per mapp i in-process dict (`SVK_STORAGE_CACHE_TTL`,
      default 60 s, 0=av) -> os.walk max en gång per TTL per mapp (mätt ~600x snabbare
      cache-hit). `invalidate()` + admin-knapp "Räkna om" (`POST /admin/storage/refresh`)
      för färska siffror på begäran. Browser-verifierat (Playwright). Inför Fas 4:
      gruppera per team (owner_id -> team_id), samma skanning + cache håller.

### Mobil-buggfixar (2026-07-13, upptäckta av Rasmus)

- [x] **Kartöverlägget hamnade som liten ruta nere till höger på mobil FIXAT.**
      `#map-container[data-size="..."]` (specificitet 1,1,0) slog media-queryns nakna
      `#map-container` (1,0,0) -> mobilbredden `calc(100vw-8px)` applicerades aldrig,
      så kartan stannade på data-size-bredden (~42vw) nere till höger. Media-queryn
      överstyr nu alla data-size-varianter explicit -> full bredd upptill vid
      Karta-knappen. `viewer.css`. Browser-verifierat (Playwright, 390px: width=382,
      top=4, left=4).
- [x] **Branding gömdes alltid när kartan öppnades FIXAT.** `setBrandingForMap`
      gömde branding villkorslöst; men kart-överlägget ligger uppe till höger, så
      bara en branding i det hörnet krockar. Gömmer nu branding bara när positionen
      är `top-right` - top-left/bottom-left/bottom-right lämnas synliga.
      `viewer.js` + `tour-preview.js` (samma regel i runtime och editor-preview).
      Browser-verifierat (bottom-right branding förblir `display:block` när kartan öppnas).

### Strategiska luckor (större, planeras separat)

- [x] **Flerspråkighet KLAR (2026-07-13).** Datamodell: **inline locale-map,
      additiv union** - textfält (hotspot text/body, scen title, branding.content)
      = ren sträng (default/monospråkigt) ELLER `{kod:text}`. `tour.default.languages`
      (först=default; saknas->["sv"]). Språk sv/en/de/fi/no/da. **Ingen SCHEMA_VERSION-
      bump** (additivt). Resolver + UI-strängar i markdown.js (`resolveText`/`uiStr`);
      runtime-viewern har språkväljare som bygger om pannellum + återställer vy, och
      skriver resolverad titel i scene.title (pannellums titel-ruta). Editorn: språkval
      på preview-steget (kryssrutor) -> per-språk-fält (flikar) i scen/preview/branding
      vid >1 språk, oförändrat vid 1. Backend: sanering (str|dict), `i18n_text_values`
      -> bundle/backup/media itererar alla varianter, `services/i18n.py` (`og_description`
      per default-språk). Byggd i ett svep med 3 parallella subagenter mot en låst
      grund (resolver/kontrakt). Browser-verifierat (Playwright: sv/en-byte, titel-ruta,
      branding, "Map"-knapp; monospråkigt oförändrat), 166 backend-tester gröna.
      Kvar/senare: pannellums egna laddnings-/felsträngar (`tour.strings`) lokaliseras
      inte än; ev. fler språk = utöka `config.LANGUAGES` + `LANG_NAMES` (+ woff2 för accenter).

- **Flerspråkighet - uppföljning (Rasmus 2026-07-13, pågår/planerat):**
  - [~] **Flagg-baserad språkväljare** KLAR i viewern (commit 171abc7). PÅGÅR (subagent):
        branding-editorns flikar -> flagg-dropdown, /mallar flerspråkig branding +
        flaggindikatorer på kort, **språkordning via drag-and-drop** (utöver bockrutor;
        ordning = prioritet, först = default), flagg-switcher-overlay även på /preview.
        Delad widget `static/lang-dropdown.js` + flagg-infra i markdown.js (`FLAG_SVGS`/
        `LANG_FLAG`/`langFlag`).
  - [ ] **Scentitel: dropdown + EN inputruta** (som branding) i stället för tre rutor
        (`#scene-title-langs` i scene.js). Använd samma `lang-dropdown.js`. Ev. även
        hotspot-modalens språk-`<select>` -> samma flagg-dropdown för konsekvens.
  - [ ] **Språkinställningarnas placering:** ligger på preview-steget (efter scenhantering)
        men behövs innan per-språk-scenredigering -> utred att flytta språkvalet tidigare
        i flödet. Senare.
  - [ ] **Översätt-steg (F5) - eget steg, aktivt vid >1 språk, placerat SENARE i flödet**
        (efter Preview, före Export - inte före Preview). Hittar alla översättningsbara
        fält (hotspot text/body, scentitlar, branding.content) som har defaultspråk men
        saknar målspråk; guidad genomgång (ladda scen + rikta kamera mot hotspot + inline-
        editor med källtext bredvid). Readiness-varning inför export/delning om
        översättningar saknas. Bygg efter att flagg-dropdown-widgeten landat.
  - [ ] **Språk-specifika hotspots (Rasmus 2026-07-13):** en hotspot ska kunna finnas
        BARA på vissa språk (inte alla). Kräver datamodell (t.ex. `hotSpot.langs`-
        begränsning), viewer-filtrering per aktuellt språk, editor-UI för att markera,
        och att Översätt/readiness inte flaggar dem som "saknad översättning". Designa.

- [ ] **Versionshistorik / ångra för tur-redigering.** Autospar skriver direkt
      över `tour.json`/`map.json` utan historik; en felaktig kart-/scenändring
      kan bara återställas via en manuell backup-zip. Risken växer när Fas 4 gör
      redigering multi-user (delat team-ägarskap, "alla kan redigera allt"). Enkel
      lösning: spara N senaste snapshots vid varje spar + en "återställ tidigare
      version"-vy. Värt att utreda innan Fas 4 gör redigering multi-user.

### Avfärdat / åt sidan

- **Tillgänglighet (WCAG) för panoramat - ÅT SIDAN (Rasmus 2026-07-13).**
      Pannellum renderar canvas/WebGL, osynligt för skärmläsare; ingen alt-text
      per scen, ingen icke-visuell navigering. Genuin lucka för ett offentligt
      projekt, men medvetet nedprioriterad tills vidare. Kräver schemautökning
      (textbeskrivning per scen) + alternativ navigeringsväg om/när den tas.
- **EXIF-baserad autokalibrering av nordoffset - GÅR INTE (Rasmus 2026-07-13).**
      Bilderna retuscheras oftast före uppladdning, vilket förstör/tappar
      kompass-EXIF. Kalibreringen förblir manuell (sikta + klicka på granne).
- **Sitemap/robots.txt/schema.org** för delade turer - lägre prio än OG-taggarna;
      relevant bara om kyrkor vill synas i Google-sök.
- **Ljud-/videohotspots (audioguide)** - större tillägg (mediahantering +
      spelar-UI), bedömt för spekulativt nu.

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

- [ ] **OG + absoluta URL:er i multi-tenant (MÅSTE lösas innan egna domäner går
      live).** Delnings-paketet (2026-07-13) byggde OG-taggar med `og:image`/`og:url`
      som absoluta URL:er. När flera team kör på egna domäner/subdomäner mot samma
      instans måste dessa absoluta URL:er peka på **rätt tenant-domän** per request,
      annars får sociala förhandsvisningar fel bild/länk (eller läcker mellan kunder).
      Bakgrund och att-göra:

      **Nuläge (5 call sites, samma mönster):** `origin = config.BASE_URL or
      str(request.base_url).rstrip("/")` finns i `public.py` (OG + /s-länk),
      `viewer.py` (OG), `preview.py` (share_url-visning), `projects.py` (share/unshare-
      svar), `admin.py` (invite-länk). Alla bygger absoluta URL:er ur SAMMA globala
      `SVK_BASE_URL`-env eller request-hosten.

      **Två fällor:**
      1. **Global `SVK_BASE_URL` är en foot-gun i multi-tenant.** Är den satt vinner
         den över request-hosten -> ALLA tenants får samma origin (t.ex. plattformens
         default-domän) i OG + delningslänkar. Med egna domäner får team B en
         förhandsvisning som pekar på team A:s/plattformens domän. Slutsats: när
         Fas 4 landar ska absolut-URL bytas från global env till **`Team.base_url`
         (per tenant)** ELLER ren request-härledning (host-baserad resolution ger
         redan rätt Host). Fas 4-punkten ovan säger redan "Team.base_url ersätter
         SVK_BASE_URL" - detta gäller alltså även OG-taggarna, inte bara invite/export.
      2. **Proxy-headers saknas idag** (verifierat: ingen `--proxy-headers`/
         `ProxyHeadersMiddleware` i `main.py`, uvicorn startas utan det). Bakom Caddy
         (TLS termineras där) ser uvicorn en ren HTTP-connection -> `request.base_url`
         ger scheme **http** även om besökaren kom via https, och X-Forwarded-Host
         ignoreras. Resultat: `og:image = http://...` -> Facebook/Twitter kan neka
         eller nedgradera bild-hämtningen (de vill ha https). Fix vid produktion:
         starta uvicorn med `--proxy-headers --forwarded-allow-ips=<caddy-ip>` (eller
         `ProxyHeadersMiddleware`) OCH se till att Caddy skickar `X-Forwarded-Proto`
         + `X-Forwarded-Host` (reverse_proxy gör Proto default; verifiera Host).
         Då blir `request.base_url` = `https://<tenant-host>/` korrekt.

      **Single seam KLART (2026-07-13):** de 5 call sites är konsoliderade till
      `deps.request_origin(request)` (oförändrat beteende, 121 tester gröna,
      OG/share_url rök-testade). När Team finns byts denna helper till
      `team_origin(team, request)` (eller så läser den `Team.base_url`) på ETT
      ställe -> per-team-domänbytet kan inte glömmas i någon route.

      **og:url-policy att besluta:** ska en tur som nås på BÅDE plattform-subdomän och
      kundens egna domän ha per-domän `og:url` (varje domän egen förhandsvisning,
      request-härlett) eller en kanonisk domän (Facebook dedupar shares per `og:url`)?
      För white-label per kund är per-domän (request/Team.base_url) rätt - varje kund
      äger sin egen förhandsvisning. Dokumentera valet när Team.base_url införs.

      **Krav som redan är uppfyllda:** `og:image` (map.png via `/s/{token}/map.png`)
      är en publik capability-URL utan auth-grind -> crawlers kan hämta den så länge
      host-resolutionen serverar `/s/` på tenant-domänen (vilket Fas 4-planen gör).
      Bundlens OG är host-agnostisk (relativ `og:image`) och berörs inte av detta.

- [ ] **Vid produktionssättning:** återinför Alembic (baslinje ur då-aktuella
      modeller), byt admin/admin mot riktiga creds, ev. Postgres via docker-compose.
      Pre-produktion: inga migrationer - schemaändring = radera svk.db + starta om
      (create_all + seed; projektmappar adopteras av admin).
