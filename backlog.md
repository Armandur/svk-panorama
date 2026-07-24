# Backlog Export

## [P2][todo] [svk-panorama] Egna domäner: automatisera kunddomän-cert via NPM-API (verify-then-provision)

## Context
Idag skapas en kunddomäns proxy-host + cert manuellt i NPM (så kör legacy `panorama.svenskakyrkanharnosand.se` redan). För self-serve ska appen automatisera detta: efter verifierad domän (TASK-396) anropa NPM:s REST-API och skapa proxy-host + begära cert. NPM saknar on-demand TLS (statisk config-generator), men API:t räcker för eager provisionering utan handslags-glapp eftersom DNS redan är live vid verifieringstillfället. Kärnan i kunddomän-featuren på TERVO2.

## Acceptance criteria
- [ ] Efter verifierad domän skapar servern automatiskt en NPM-proxy-host (`panorama.<org>.se` -> app) + begär HTTP-01-cert via NPM:s API
- [ ] Idempotent: upprepade anrop skapar inte dubbletter; befintlig host uppdateras
- [ ] Felhantering + retries (DNS-propagation/cert-fördröjning) med tydlig status till team-admin
- [ ] Token/credentials mot NPM hanteras säkert (inte hårdkodat; jfr npm-api.conf-mönstret)
- [ ] Avaktivering: nolla domän -> ta bort proxy-hosten (eller inaktivera)
- [ ] certbot/NPM sköter förnyelser (ingen egen förnyelse-logik behövs)

## Implementation hints
NPM REST-API (odokumenterat): `POST /api/tokens` -> bearer, `POST /api/nginx/certificates` (LE-cert), `POST /api/nginx/proxy-hosts` (refererar certificate_id). `nginx-proxy`-skillens `npm-api.sh` visar mönstret. Forward-host = där appen kör (VM 192.168.1.42 vid test, container 192.168.1.2 i prod - TASK-402). Trigga från domänverifieringsflödet (TASK-396). Slängs om plattformen flyttar till Caddy (TASK-400).

- ID: `01KY9MR9NZZASMNVBMDHGJKBRQ`
- Type: feature
- Actor: ai:claude-opus-4-8

---

## [P2][todo] [svk-panorama] Egna domäner: kräv domänverifiering (TXT-token) innan aktivering

## Context
Innan en kunddomän aktiveras (proxy-host + cert utfärdas) måste teamet bevisa att det äger domänen. Utan verifiering kan team A claima team B:s domän, eller trigga cert-utfärdande för godtyckliga hostar (missbruk/rate-limit-bränning mot Let's Encrypt). Verifieringen är gemensam grund för både NPM-API-vägen (TASK-397) och en framtida Caddy ask-endpoint (som läser samma tillstånd).

## Acceptance criteria
- [ ] Team-admin kan begära en domän och får ett verifieringstoken (DNS TXT-record att lägga upp)
- [ ] Servern verifierar ägarskap (TXT-token matchar ELLER domänen A/CNAME-resolvar till oss) INNAN domänen markeras aktiv
- [ ] En domän kan inte aktiveras av ett team medan ett annat team äger/verifierat den
- [ ] Verifieringsstatus lagras på domänen/teamet och kan läsas av provisioneringssteget + en framtida tls-allowed-endpoint
- [ ] Tydliga felmeddelanden (svenska) vid misslyckad/utebliven verifiering

## Implementation hints
Datamodell: verifieringstoken + status per domän (på Team.base_url eller en separat domän-tabell om flera domäner/team ska stödjas senare). TXT-uppslag via DNS (t.ex. dnspython). Gate:a aktivering på verifierad status. Detta tillstånd är det TASK-397:s skript och en ev. `GET /internal/tls-allowed?host=` (Caddy) frågar mot.

- ID: `01KY9MR9NKE6HZEFWZPNVMH14X`
- Type: feature
- Actor: ai:claude-opus-4-8

---

## [P2][todo] [svk-panorama] Egna domäner: låt request_origin läsa Team.base_url för per-team origin

## Context
Absoluta URL:er (OG `og:url`/`og:image`, publika delningslänkar, invite-länkar) byggs idag ur en enda seam, `deps.request_origin(request)` (redan konsoliderad från 5 call sites: public.py, viewer.py, preview.py, projects.py, admin.py). I multi-tenant måste dessa peka på RÄTT tenant-domän per request, annars läcker förhandsvisningar/länkar mellan kunder eller pekar på plattformsdomänen. Global `SVK_BASE_URL` är en foot-gun (vinner över request-host -> alla tenants får samma origin).

## Acceptance criteria
- [ ] `request_origin` returnerar teamets origin (ur `Team.base_url` / `request.state.team`) när en tenant är resolverad, annars dagens request-härledda origin
- [ ] Global `SVK_BASE_URL` slutar överskugga per-tenant-origin (behålls ev. bara som fallback för icke-tenant-kontext)
- [ ] OG-taggar + `/s`-länk + invite-länk pekar på rätt tenant-domän (verifierat på minst en kunddomän)
- [ ] og:url-policy beslutad och dokumenterad: per-domän (request/Team.base_url) för white-label
- [ ] Noll-team/plattformshost: oförändrat beteende

## Implementation hints
Ändra bara i `deps.request_origin` (en punkt -> når alla 5 call sites). Läs `request.state.team` (TASK-394). Kräver proxy-headers (TASK-393) för rätt scheme. Bygger vidare på ROADMAP-noten "OG + absoluta URL:er i multi-tenant".

- ID: `01KY9MR9N70JNA3NC8XHQEYPAQ`
- Type: feature
- Actor: ai:claude-opus-4-8

---

## [P2][todo] [svk-panorama] Egna domäner: inför host-baserad tenant-resolution (Host -> Team)

## Context
Publicerade turer ska serveras på varje teams egna domän (`panorama.<org>.se`) från samma FastAPI-app. För att avgöra vilket teams innehåll en request gäller behöver appen slå upp request-Host mot ett Team. Utan detta kan appen inte servera rätt tur på en kunddomän. Grund för hela kunddomän-featuren (TASK-396/397 hänger på den).

## Acceptance criteria
- [ ] En middleware slår upp `request` Host mot `Team.base_url` och sätter `request.state.team` (None om ingen match)
- [ ] Placerad EFTER `SessionMiddleware` men FÖRE routrarna
- [ ] En request mot `panorama.<org>.se` resolvar till rätt Team och serverar det teamets publika tur(er)
- [ ] Plattformshosten (pano.pettersson-vik.se) och okända hostar beter sig som idag (ingen tenant -> normalt beteende)
- [ ] Host-matchning är case-insensitiv och ignorerar port

## Implementation hints
Ny middleware i app/main.py (registreras i rätt ordning). Slå upp mot `Team.base_url` (normaliserad host). Konsumeras av `deps.request_origin` (TASK-395) och de publika viewer-routerna. Noll-team = oförändrat beteende (samma invariant som Fas 4.1-gaten). Överväg hur `/s/{token}` och `/view` samspelar med tenant-host.

- ID: `01KY9MR9MXE5S1M81QAXWZ65PN`
- Type: feature
- Actor: ai:claude-opus-4-8

---

## [P2][todo] [svk-panorama] Egna domäner: aktivera proxy-headers på uvicorn bakom reverse proxy

## Context
uvicorn startas idag UTAN `--proxy-headers`/`ProxyHeadersMiddleware` (verifierat i app/main.py). Bakom en TLS-terminerande reverse proxy (NPM nu, Caddy senare) ser uvicorn en ren HTTP-connection, så `request.base_url` får scheme `http` och kan få fel host. Det bryter alla absoluta URL:er (OG-taggar, delningslänkar, invite-länkar) så snart appen körs bakom proxyn på en riktig domän. Prereq för hela egna-domäner-spåret.

## Acceptance criteria
- [ ] uvicorn startas med `--proxy-headers` och `--forwarded-allow-ips=<proxy-ip>` (inte `*`)
- [ ] `request.base_url` ger `https` + korrekt host bakom NPM (verifierat mot pano.pettersson-vik.se)
- [ ] `X-Forwarded-Proto` respekteras; dokumentera att NPM inte skickar `X-Forwarded-Host` (originalhost bärs i `Host`)
- [ ] Startkommandot i CLAUDE.md ("Köra") + README uppdaterat

## Implementation hints
Antingen uvicorn-flaggor eller Starlette `ProxyHeadersMiddleware` i app/main.py. NPM (openresty) sätter `X-Forwarded-Proto/For`, `X-Real-IP` men INTE `X-Forwarded-Host`. `forwarded-allow-ips` = NPM/TERVO2-IP, aldrig `*`. Detta är samma seam som `deps.request_origin` (TASK-395) läser.

- ID: `01KY9MR9MGGSJBSF2ANEA5V2YX`
- Type: improvement
- Actor: ai:claude-opus-4-8

---

## [P2][todo] [svk-panorama] Egna domäner: driftsätt editorn bakom NPM-hosten pano.pettersson-vik.se

## Context
Editor-/admin-appen (där fotografer loggar in och bygger turer) behöver en stabil publik adress. Startläget är en NPM-proxy-host på plattformsdomänen `pano.pettersson-vik.se`, per-host HTTP-01-cert som de ~55 befintliga hostarna. Trivialt och rör inte multi-tenant-domänlogiken.

## Acceptance criteria
- [ ] NPM-proxy-host `pano.pettersson-vik.se` -> app, med giltigt Let's Encrypt-cert
- [ ] Inloggning + editor-flödet fungerar över https på hosten
- [ ] Turer nås via `/view` och delas via `/s/{token}` på hosten
- [ ] Fungerar med proxy-headers (TASK-393) så absoluta URL:er blir https

## Implementation hints
Skapa hosten via `nginx-proxy`-skillens `npm-api.sh --host-create`. Forward-host: VM `192.168.1.42` vid test (som kort/hrlon/viva idag), byts till container `192.168.1.2` när prod-containern finns (TASK-402). Ingen tenant-logik här - det är plattformens egen host.

- ID: `01KY9MR9M12PEGYZBDJ9W8371N`
- Type: chore
- Actor: ai:claude-opus-4-8

---

## [P2][done] [svk-panorama] Appens accentfärg blir Pico-blå i stället för grön (CSS-specificitet)

tokens.css:15 mappar --pico-primary till --svk-accent (#2f6f4f grön), men Pico:s ':root:not([data-theme=dark]),[data-theme=light]' sätter --pico-primary:#0172ad med HÖGRE specificitet än tokens.css:s enkla ':root' -> blå vinner i light mode (computed --pico-primary = #0172ad). Alla primärknappar/fokusramar/länkar i inloggade appen blir blå i stället för den avsedda gröna. (Landningssidan är en separat beige/röd sida - 'grönt' kommer ur tokens.css, appens avsedda accent.) Klart nar: --pico-primary renderar grönt (#2f6f4f light / #4fa87a dark) i appen. Fix: matcha Pico:s selektor-specificitet i tokens.css (':root:not([data-theme=dark]),[data-theme=light]' + dark-motsvarigheten) eller !important på --pico-primary. Ev. följd-beslut: dra in landningssidan i samma gröna palett för genomgående identitet. Verifiera: computed style av --pico-primary på /editor ska vara grön.

- ID: `01KXX41BHV6YWY7QZVC4X25QZJ`
- Type: bug
- Actor: ai:ux-review

---

## [P2][done] [svk-panorama] EasyMDE-toolbaren osynlig i hotspot-modalen (light mode)

Verktygsraden (fetstil/länk/Infoga bild ur mediebiblioteket) i hotspot-textredigeraren (#hs-field-text .editor-toolbar) har osynliga ikoner i LIGHT mode - de syns i dark mode. Rotorsak bekräftad: app.css rad ~817-820 fixar exakt detta ('ikonerna ärver annars vit text -> osynliga på ljus toolbar') men BARA scopeat till .planner-side. Hotspot-modalen omfattas inte -> ikonerna ärver vit text, osynliga på ljus toolbar, syns mot mörk bakgrund i dark mode. Knappen 'Infoga bild ur mediebiblioteket' (enda vägen till poolbilder i en hotspot) blir odiscoverable. Klart nar: toolbar-ikonerna syns i BÅDE light och dark mode i hotspot-modalen. Fix: utöka den läsbara-färg-regeln (color: #2c3e50 el. tokenbaserad) till #hs-field-text .editor-toolbar button/i, eller gör den container-oberoende. Verifiera: shot av hotspot-modalen i light mode, ikonerna ska synas.

- ID: `01KXX41BHD8C6FAVED0QT0CRX1`
- Type: bug
- Actor: ai:ux-review

---

## [P2][done] [svk-panorama] scan_usage missar branding-bilder -> raderbar bild som används

scan_usage() skannar bara hotspot text/body efter /media/<owner>/<name>, aldrig tour.default.branding.content. En poolbild som bara används som branding/logga rapporteras som Oanvänd i mediebiblioteket och kan raderas utan serverguard. Radering 404:ar live branding-overlay i editor-preview och aktiva /s-delningslänkar direkt. bundle._media_refs och backup._media_refs skannar BÅDA branding.content - scan_usage är den avvikande. Klart när: en bild som används i branding rapporteras som använd och skyddas mot radering. Verifiera: lägg en poolbild i branding, kolla /media/list -> usage ska visa branding, inte 'oanvänd'.

- ID: `01KXVNJQEH8FDBZNG22R637316`
- Type: bug
- Actor: ai:code-review

---

## [P2][done] [svk-panorama] Open redirect via next=/\\evil.com (backslash-prefix)

_safe_next blockerar bara literal // men browsers normaliserar /\ (backslash) till // på http/https. next=/%5Cevil.com passerar startswith('/') och inte startswith('//'), returneras oförändrat, och RedirectResponse efter login blir en protokoll-relativ extern redirect till angriparhost. Phishing direkt efter autentisering. Klart när: next med backslash-prefix inte längre ger extern redirect. Verifiera: GET /login?next=/%5Cevil.com, logga in, ska landa internt inte på evil.com.

- ID: `01KXVNJQE88JETH2S2RNG0YZ92`
- Type: vulnerability
- Actor: ai:code-review

---

## [P2][done] [svk-panorama] Lösenord >72 byte kraschar med 500 i stället för valideringsfel

hash_password() anropar bcrypt.hashpw utan längdguard, och password_error() avvisar aldrig >72-byte-lösenord. Verifierat mot installerad bcrypt==5.0.0: bcrypt.hashpw(b'a'*100, gensalt()) kastar ValueError. Alla lösenordsvägar (accept-invite, /profile/password, /admin/users/{id}/password) saknar övre längdkontroll -> 500 i stället för svenskt felmeddelande. Asymmetri: verify_password har redan try/except för samma fall. Klart när: långt lösenord (>72 byte, t.ex. via emoji eller lösenordshanterare) ger snyggt valideringsfel. Verifiera: POST lösenord med 100 tecken, förvänta 400/valideringstext, inte 500.

- ID: `01KXVNJQDPSE0XY0HTCNZESDA5`
- Type: bug
- Actor: ai:code-review

---

## [P2][done] [svk-panorama] save() överskriver in-flight-redigering -> tyst dataförlust

plan.js saveMap() (och scene.js save()/tour-preview.js save()) fryser payloaden korrekt före await, men efter await sätts savedSnapshot/dirty ovillkorligt till NUVARANDE in-memory-state. Redigerar användaren medan POST är i flykten absorberas ändringen tyst: UI visar sparat, beforeunload-varningen släpps, och plan.js clearDraft() raderar sista crash-recovery-kopian. Reload -> ändringen borta utan spår. Klart när: en redigering gjord under pågående spar inte längre markeras som sparad/ren. Verifiera: dra en scenmarkör medan spar-POST pågår, ladda om, ändringen ska kvarstå eller dirty-flaggan vara kvar.

- ID: `01KXVNF5BCG8ZNEJRF9GE3FT56`
- Type: bug
- Actor: ai:code-review

---

## [P3][todo] [svk-panorama] Egna domäner: paketera editorn som produktions-container på TERVO2

## Context
Idag kör editorn som en efemär dev-instans på ubuntu-ai-VM:en (`192.168.1.42`, port 8005, admin/admin, delad svk.db). För produktion behövs en riktig, persistent container på TERVO2. Detta är ett DRIFTsteg skilt från domänfeaturen: hela egna-domäner-featuren kan testas mot VM-instansen (NPM forwardar till VM likt kort/hrlon/viva) innan containern finns.

## Acceptance criteria
- [ ] Editorn paketerad som Docker-container på TERVO2 (dockyard/Unraid)
- [ ] Persistent volym för `projects/`, `media/`, `svk.db` (överlever omstart/uppdatering)
- [ ] Riktiga admin-creds (inte admin/admin); `SVK_SECRET_KEY` satt persistent
- [ ] Egen port + svc-registrering; NPM-hosten pano.pettersson-vik.se (TASK-392) pekas om från `.42` (VM) till `.2` (container)
- [ ] Startas med proxy-headers (TASK-393)
- [ ] Verifierat: editor + turer fungerar mot containern via pano.pettersson-vik.se

## Implementation hints
Hosting-mognad: VM-dev (nu) -> prod-container TERVO2 (denna) -> Hetzner (TASK-400, vid behov). Använd `skapa-unraid-container`-skillen (dockyard). Skilt från TASK-400 (extern box, bara vid SLA-krav). Docker single-container-mönstret i CLAUDE.md.

- ID: `01KY9NXAXGBY5CRDPEQYD0W29X`
- Type: chore
- Actor: ai:claude-opus-4-8

---

## [P3][todo] [svk-panorama] Egna domäner: erbjud plattform-subdomän som fallback (wildcard-cert)

## Context
Alla team har inte en egen domän. Som bekvämlighet kan de få en plattform-subdomän, `<team>.pano.pettersson-vik.se`. Ett enda wildcard-cert `*.pano.pettersson-vik.se` täcker obegränsat antal - till skillnad från kundernas egna domäner (som kräver cert per domän, TASK-397). Detta är en fallback vid sidan av huvudmodellen, inte ett substitut.

## Acceptance criteria
- [ ] Wildcard-cert `*.pano.pettersson-vik.se` finns i NPM (DNS-01, engångssetup)
- [ ] Team utan egen domän kan tilldelas en subdomän; `Team.base_url` sätts till den
- [ ] Subdomänen resolveras av tenant-middleware (TASK-394) och serverar teamets turer
- [ ] Ingen per-team-provisionering behövs (wildcard täcker nya subdomäner direkt)

## Implementation hints
DNS-01 kräver DNS-providerns API-token för `pettersson-vik.se` (engångskonfig i NPM). Subdomän-tilldelning i /team-UI (TASK-398) som alternativ till egen domän. Delar tenant-resolution + request_origin-seam med kunddomän-vägen.

- ID: `01KY9MR9PP6SJK5X3R0NS6JXGK`
- Type: feature
- Actor: ai:claude-opus-4-8

---

## [P3][todo] [svk-panorama] Egna domäner: bygg UI för att sätta/nolla teamets domän på /team

## Context
Team-admin behöver kunna koppla (och koppla bort) sitt teams egna domän utan att super-admin rör infra per kund. UI:t binder ihop domänverifiering (TASK-396) och provisionering (TASK-397): mata in domän -> få TXT-instruktion -> verifiera -> aktivera. ROADMAP: domän-delen av team-livscykeln = Fas 4.3.

## Acceptance criteria
- [ ] Team-admin kan på /team sätta teamets domän, se verifieringsinstruktion (TXT) och verifieringsstatus
- [ ] Aktivera domän triggar provisionering (TASK-397); status visas live (pending/verifierad/aktiv/fel)
- [ ] Nolla domän tar bort proxy-hosten och slutar servera på den
- [ ] Gate:at med `require_team_admin`; CSRF på POST
- [ ] Felmeddelanden på svenska, icke-tekniska

## Implementation hints
Ny sektion på /team (routes/teams.py, require_team_admin). Skriver `Team.base_url`. Anropar verifierings- (TASK-396) och provisioneringslagret (TASK-397). Följ befintligt /team-UI-mönster (medlemslista/åtgärdsmeny).

- ID: `01KY9MR9PA1NDBETC4CM3P6GQ5`
- Type: feature
- Actor: ai:claude-opus-4-8

---

## [P3][done] [svk-panorama] Samlad jobb-status-vy (körande/köade/klara) i UI - Fas 2 (efter jobbkön)

Fas 2, BEROR PÅ backend-jobbkön (TASK-27). När alla tunga jobb går genom en global kö med ett centralt jobb-register (job_id -> {kind, slug, status: queued|running|done|error}) kan vi visa en SAMLAD vy över alla körande/köade/klara jobb på ett ställe - i stället för dagens per-tur, per-tjänst-status utspridd.

Innehåll: en vy (troligen på huvudmenyn /editor eller /admin) som listar aktuella jobb (tiling per scen/tur, export, backup) med kind, tur, status (köad/kör/klar/fel), och köposition för köade. Läser jobqueue:s centrala register (ny read-endpoint, t.ex. GET /jobs).

EJ loop-bar på samma sätt som Fas 1: kräver browser-verifiering (Judge kan inte automatisera det bra) -> köra som vanlig delegering/manuell verifiering, inte backlog-loop.
Klart nar: en användare ser alla körande + köade + nyligen klara jobb i EN vy, som uppdateras (polling) medan jobb kör.

- ID: `01KY8744KCPK9PY9XTZFJGY4DS`
- Type: improvement
- Actor: human:rasmus

---

## [P3][done] [svk-panorama] Fäll ihop 'Uppladdade scener'-listan på uppladdningssteget för mogna turer

På uppladdningssteget (upload.html, sektionen 'Uppladdade scener (N)', rad ~94-127) tar scen-tabellen väldigt mycket plats på turer med många scener (t.ex. 22). När man återvänder till steget på en MOGEN tur (all uppladdning + tiling klar) borde listan vara ihopfälld i en accordion i stället för att dominera sidan.

Önskat beteende: default UTFÄLLD på en färsk tur (medan man laddar upp / tiling pågår - man vill se scenerna + progressen), default IHOPFÄLLD när bearbetningen är klar (man har 'lämnat steget en gång'). Manuellt val kommer ihåg (som preview-stegets panelgrupper).

Implementation (litet-medel): wrappa sektionen i en <details class='panel-group' data-group='up-scener'> och återanvänd det BEFINTLIGA accordion-mönstret (preview.html + localStorage-persistens-scriptet som minns öppet/stängt per data-group). Default-state: sätt 'open' bara om turen är färsk/bearbetar; annars ihopfälld. 'Bearbetning klar' kan härledas ur tiling-status (alla scener tilade -> #tile-section är klar/dold). localStorage-valet vinner över default (som på preview).

Klart nar: på en tur där alla scener är tilade visas 'Uppladdade scener'-listan ihopfälld som default på uppladdningssteget; på en tur mitt i uppladdning/tiling är den utfälld; manuellt toggle-val kommer ihåg.

Prio: P3 - reell declutter på mogna turer, litet jobb (återanvänder panel-group-mönstret).

- ID: `01KY7ZBZ2JWDN5K8GFQPYDSZYP`
- Type: improvement
- Actor: ai:ux-review

---

## [P3][done] [svk-panorama] Omdesign stegnavigering: Alt C full-bredd topbar + Alt D städning

BESLUT (2026-07-23): vald riktning = Alt C (flytta stegnav ut ur den smala .planner-side-panelen till en egen full-bredd topbar över hela editorn) + Alt D:s städning (ta bort hamburgare/stepper-dubbleringen). Underlag: backlog-doc 'Stegnavigering - UX-underlag' (01KY7WPE, HTML med renderade mockups bifogad) + docs/ux/stegnavigering.md/.html i repot.

Bakgrund: nuvarande horisontella stepper klämd i den fasta 21rem-panelen skaver strukturellt (radbrott beror på variabel stegnamnslängd; ~52px överflöde på steg 2). Se rapporten.

## Acceptanskriterier
- [ ] Stegnavigeringen (steg + pilar + ev. Helskärm) ligger i en egen rad som spänner HELA editor-bredden, inte i .planner-side
- [ ] Alla steg visas med fulla etiketter samtidigt, ingen klippning/radbrytning oavsett stegnamnslängd (inkl. Översätt-steget)
- [ ] Aktivt steg tydligt markerat; nåbara steg klickbara; inaktiverade dämpade
- [ ] Samspelar korrekt med lås-banderollen (.editor-lock-banner) - staplad eller kombinerad, ingen z-index/höjd-krock; fullscreen-layouten (100vh) intakt
- [ ] Hamburgaren trimmad till Huvudmeny + Versionshistorik (steg-dubbleringen borttagen)
- [ ] Mobil (<768px) oförändrad (hamburgaren bär stegen)
- [ ] Panelen får tillbaka höjden (~83px) som topnav-raden åt
- [ ] Verifierad i browser vid desktop (1280/1440) OCH mobil (390), inga layoutbuggar; testa alla steg inkl. en flerspråkig tur (Översätt aktivt)

## Öppna delbeslut (se rapportens avsnitt 6)
- topbar staplad ovanpå lås-banderollen vs kombinerad rad; fixed vs normalt flöde.

- ID: `01KY7WQMYRQV2Z10DN56YREDWN`
- Type: improvement
- Actor: ai:ux-review

---

## [P3][todo] [svk-panorama] Re-exportera legacyturerna i full upplösning från .afphoto + tila (multires)

Legacyturerna (~13 gamla produktionsturer: js/app.js + <xx>/*.html, EJ migrerade till editorn) använder nedskalade enkel-bild-equirektangulära panoraman (fanns ingen tiling när de byggdes -> full storlek var för tung att servera som EN bild). Nu när editorn kör multires/tiling (pannellum-multires via Docker) kan full upplösning serveras effektivt (zoombart, skarpt).

Mål: re-exportera panoramana i FULL bredd/storlek ur Affinity-.afphoto-källfilerna och köra dem genom tiling-skriptet -> skarpa, zoombara multires-panoraman i de gamla produktionsturerna.

## Öppna beslut FÖRE detta är actionable
1. **Migreras legacyturerna in i editorn** (som redan gör tiling + multires-viewer + full-res-uppladdning) eller ska tiling bolt:as på den gamla legacy-viewern (js/app.js) manuellt? Editor-migrering är sannolikt LÄGST insats OCH pensionerar legacy-koden på köpet.
2. **.afphoto-export:** Affinity Photo är en desktop-GUI-app - finns .afphoto-filerna nåbara på VM:en, och kan de batch-exporteras HEADLESS? Troligen ett MANUELLT steg (Rasmus exporterar equirect JPEG/TIFF ur Affinity), sedan tar Claude tiling + wiring. Claude kan inte köra Affinity headless.
3. Omfång: ~13 turer x N scener. Per tur: export (manuellt) -> tila -> koppla in multires.

Klart nar: legacyturerna serverar full-upplösta multires-panoraman i stället för nedskalade enkel-bilder.

Prioritet: kvalitetslyft för den FAKTISKA live-produkten (de gamla turerna är det som faktiskt visas), men medelstort jobb med beroenden -> P3 tills scope/afphoto-åtkomst är klarlagt.

- ID: `01KY6VJJRYBMEAECW94272G4YT`
- Type: improvement
- Actor: human:rasmus

---

## [P3][done] [svk-panorama] Byt tema-previewns accent-väljare till Coloris (från input type=color)

Tema-preview (och theme-preview-skillens gallery.html) använder native <input type=color>. Byt till Coloris - lätt färgväljare svk-panorama redan vendorar (app/static/vendor/coloris/), används för dotColor/currentColor på preview-steget. Enhetligt färgval i hela appen + snyggare picker (swatch, hex-fält).

Omfång: (1) theme_preview.html: ladda coloris CSS/JS i {% block head %}, byt de två accent-inputarna till <input type=text class=coloris-input data-coloris>, init Coloris({el:'[data-coloris]',format:'hex',alpha:false}). JS läser fortfarande .value (hex) + input-eventet fyrar från Coloris -> apply() funkar oförändrat. (2) Skillens gallery.html: använd Coloris NÄR projektet vendorar det (Rasmus default), annars fall tillbaka på <input type=color>; dokumentera i SKILL.md. 'Det kan bli det generella' = Coloris som standard-färgväljaren i skillen.
Klart nar: accent-väljaren på /theme-preview är en Coloris-picker, och skillen använder Coloris som default.

- ID: `01KXX69QE0RBST7ZBGQ39JM781`
- Type: improvement
- Actor: human:rasmus

---

## [P3][done] [svk-panorama] Tre-lägesväxel (ljus/mörk/system) på tema-preview

Att växla ljust/mörkt via OS/webbläsaren är krångligt när man synar temat. Bygg en tre-stegs segment-knapp (sol=ljust, måne=mörkt, dator=system) på /theme-preview som växlar läget direkt, persistad i localStorage.

TEKNISK HAKE (varför det inte är helt trivialt): appen/tokens.css använder prefers-color-scheme, INTE data-theme. Pico stödjer [data-theme=light|dark] för sina basfärger, MEN tokens.css kopplar --svk-* till @media(prefers-color-scheme:dark). Tvingar man data-theme=dark får man Pico:s mörka bas men FEL (ljus) --svk-accent. Ren lösning: refaktorera tokens.css så mörkvärdena svarar på BÅDE @media(prefers-color-scheme:dark) OCH [data-theme=dark], plus [data-theme=light]-override (standard 3-vägs-temamönster). Då sätter växeln bara data-theme (eller tar bort det = system) och både Pico och --svk följer med korrekt. Bonus: samma mönster möjliggör en global temaväxel i appen senare.

Omfång: (1) tokens.css 3-vägs-refaktor, (2) sol/måne/dator-segmentknapp + localStorage på theme_preview.html, (3) folda in samma växel i theme-preview-SKILLENS gallery.html så alla projekt får den.
Klart nar: man kan tvinga ljust/mörkt/system på /theme-preview och BÅDE Pico-bas och --svk-accent stämmer i alla tre lägena.

- ID: `01KXX5KD1GAVJEBPPFJQYX05BB`
- Type: improvement
- Actor: human:rasmus

---

## [P3][done] [svk-panorama] Trailing-slash-URL:er 404:ar (/projects/{slug}/)

/projects/{slug}/ (med avslutande slash) ger 404; utan slash fungerar. En bokmärkt/delad länk med slash (browsers lägger ibland till den) landar på felsida. Klart nar: trailing-slash redirectar till kanonisk URL (eller båda accepteras). Fix: 302-redirect trailing-slash -> utan, eller FastAPI redirect_slashes. Verifiera: curl -I /projects/hemso-kyrkogard/ ska ge 200 eller 30x, inte 404.

- ID: `01KXX41BKGT9631A21RFNC1B6N`
- Type: improvement
- Actor: ai:ux-review

---

## [P3][done] [svk-panorama] Publicera & dela gömt i kollapsad sektion längst ner på sista steget

Export, säkerhetskopiering och delningslänk (WORKFLOW.md steg 5 Publicera - hela poängen med sista steget) ligger i en ihopfälld ackordion längst ner i en lång sidopanel, under Tema/Branding/Kartstorlek/Autorotate/Övergång. Måste scrolla och aktivt fälla upp. Klart nar: publicera/dela är synligt utan att scrolla förbi alla inställningar. Förslag: ha sektionen uppfälld som default eller flytta den högre. Verifiera: shot av preview-steget, dela-ytan syns utan interaktion.

- ID: `01KXX41BK330SMV8N6D98JB5MF`
- Type: improvement
- Actor: ai:ux-review

---

## [P3][done] [svk-panorama] Textklippning i exportsektionens förklaringstext

Hjälptexten under 'Inkludera originalbilder' på preview/export klipps i högerkanten ('...åter-till...' -> resten försvinner) - det indragna <p> matchar inte containerbredden och wrappar inte utan klipps av overflow. Skärmdump: tmp/ux-review/desktop-preview-export-text.png. Klart nar: hela hjälptexten wrappar och syns. Fix: box-sizing/bredd på det indragna hjälptext-elementet. Verifiera: shot vid 1280px, ingen avklippt text.

- ID: `01KXX41BJPC0BMJHMC8B6PYX08`
- Type: bug
- Actor: ai:ux-review

---

## [P3][done] [svk-panorama] Ingen persistent steg-/framstegsindikator i editor-flödet

Hela arbetsflödesnavigeringen (Uppladdning -> Placering -> Scener -> [Översätt] -> Förhandsvisning) ligger dold bakom en textlös hamburgermeny (_step_nav). Ingen synlig 'steg 2 av 4'-känsla; en förstagångsfotograf ser inte hela resan eller var i den man är utan att öppna menyn. Klart nar: aktuellt steg + hela flödet syns alltid. Förslag: tunn alltid-synlig breadcrumb/stegindikator med aktivt steg markerat. Verifiera: shot av valfritt editor-steg, stegen ska synas utan att öppna meny.

- ID: `01KXX41BJAHXRNDBPT4VAH9MRP`
- Type: improvement
- Actor: ai:ux-review

---

## [P3][done] [svk-panorama] Backup-import validerar inte .tif/.tiff-innehåll (bara jpg/png)

Import magic-byte-koll (_check_extracted_image) körs bara för .jpg/.jpeg/.png (_IMAGE_EXT), medan _ALLOWED_EXT även släpper in .tif/.tiff utan innehålls- eller dimensionsvalidering. Ett riggat project.zip (passerar _validate_members) kan lägga godtyckliga bytes på tiles/<scen>/*.tif upp till MAX_PANORAMA_MB per fil, oskannat och otäckt av MAX_IMAGE_MEGAPIXELS. Exploaterbarhet beror på om serverkod senare öppnar/serverar .tif-vägarna (ej verifierat). Klart när: .tif/.tiff genomgår samma innehållsvalidering som jpg/png vid import. Verifiera: importera zip med skräp-.tif, ska avvisas eller valideras.

- ID: `01KXVNJQJFZYXABM2GZX6276WR`
- Type: vulnerability
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] Reverse-tabnabbing i hotspot-tooltip/ark (saknar rel=noopener)

renderMarkdown-output injiceras via innerHTML i mdHotspotTooltip och openHsSheet utan ankar-härdningen (rel=noopener noreferrer) som renderBrandingInto uttryckligen sätter. En redigerare som skriver rå HTML-ankare med target=_blank i hotspot-text (marked släpper igenom, DOMPurify default strippar inte target/rel) får en länk som öppnas med window.opener intakt -> destinationssidan kan navigera ursprungsfliken till phishing. Klart när: länkar i hotspot-tooltip/ark får rel=noopener noreferrer som branding. Verifiera: hotspot-text med <a target=_blank>, öppnad länk ska ha rel=noopener.

- ID: `01KXVNJQJ3BX92N199772E9ERD`
- Type: vulnerability
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] horizon-roll debounce applicerar mot fel scen vid snabbt scenbyte

Horisont-roll-slidern debounce:ar scen-reload med setTimeout(applyRoll,900), men applyRoll läser viewer.getScene() vid fire-tid i stället för att fånga scenen draget gjordes på. Byter man scen inom 900ms-fönstret lämnas den dragna scenens live pannellum-config stale (sparad tour.json-värde är dock korrekt eftersom save() läser tour.scenes direkt). Scen A:s 3D-preview visar gammal tilt tills sidan laddas om. Klart när: roll-ändring appliceras på rätt scen även vid snabbt scenbyte. Verifiera: dra roll på scen A, byt genast till B, gå tillbaka - A ska visa rätt tilt utan reload.

- ID: `01KXVNJQHPE808APF68F3NNW77`
- Type: bug
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] editor-lock nollställer låsstate vid nätverksfel i heartbeat

apply() behandlar varje misslyckat/non-OK checkoutPost()-svar (nätverksblip, transient 5xx) identiskt med 'projektet har ingen låsning': locking=false, banner döljs, editor-locked tas bort från body - även för en användare som är i läsläge för att någon ANNAN håller låset. Vid heartbeat (60s) kan en transient error därför kortvarigt re-enabla UI som om turen vore olåst tills nästa lyckade heartbeat. Ingen dataförlust (server 409:ar skrivningar) men vilseledande transient state. Klart när: ett misslyckat heartbeat-svar inte ändrar visad låsstate. Verifiera: simulera nätverksfel under heartbeat, låsbanner ska inte försvinna.

- ID: `01KXVNJQH93QQRSBBVVV9SPYN8`
- Type: bug
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] translate.js dubbel-submit splice:ar bort fel gap

Spara-knappen i översätt-steget markeras bara aria-busy (inte disabled), så snabb dubbelklick/Enter avfyrar två överlappande POST /translate för samma gap. När första resolvar avancerar activeIndex via advanceAfterSave/selectGap, så andra resolutionens gaps.splice(activeIndex,1) tar bort ett ANNAT (oöversatt) gap vid det nya indexet. Det försvinner tyst ur listan och räknaren tills sidan laddas om. Ingen serverdata förloras. Klart när: dubbelklick på Spara inte kan ta bort fel gap. Verifiera: dubbelklicka Spara på ett översättningsfält, nästa gap ska inte försvinna oöversatt (disabla knappen medan request pågår).

- ID: `01KXVNJQGT0W3C5852QJC0MTZ6`
- Type: bug
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] Team-kvot kontrolleras en gång per request, inte per fil -> overshoot

team_over_quota kollas en gång före upload-loopen. En enda multi-fil-request kan därför pusha användningen långt förbi kvoten eftersom per-fil-skrivningar aldrig omkontrolleras mid-request. Ett team strax under kvoten laddar upp N panoramabilder (var upp till max_panorama_mb) i ett POST -> alla landar, overshoot upp till hela batchstorleken innan nästa request blockeras. Klart när: kvot kontrolleras löpande så en batch inte kan överskrida gränsen väsentligt. Verifiera: ladda upp flera stora filer i en request nära kvottaket, användningen ska inte kunna gå långt över.

- ID: `01KXVNJQGDWNBMRGBYGF0K9V7H`
- Type: bug
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] remove_scene snapshottar inkonsistent tour+map-par

remove_scene anropar write_tour sedan write_map back-to-back, båda med default snapshot=True. Om coalesce inte slår till (SVK_HISTORY_COALESCE_SEC lågt/0 eller föregående snapshot äldre än fönstret) arkiverar write_maps hook ett läge där disk har NYA tour.json men GAMLA map.json - ett par som aldrig existerade koherent. Restore till den versionen återinför en map-post för en redan raderad scen. Bryter mot dokumenterade 'unified snapshot, desync omöjlig'; restore skyddar med snapshot=False men remove_scene gör inte det. Klart när: scenradering inte kan arkivera ett desync:at par. Verifiera: kodgranskning - skriv båda med snapshot=False + en samlad snapshot, som restore.

- ID: `01KXVNJQG106FH6YMVRKCVPRVH`
- Type: bug
- Actor: ai:code-review

---

## [P3][todo] [svk-panorama] capture_seed/reset_demo håller globala tour_lock runt stora filkopior

capture_seed och reset_demo håller process-globala project_files.tour_lock runt shutil.rmtree/copytree av images/tiles (potentiellt hundratals MB / tusentals filer), mot tour_locks dokumenterade kontrakt (bara korta synkrona sektioner). tour_lock delas av ALLA turers write_tour/write_map -> medan en super-admin kör capture/reset blockeras varje annan användares spar i hela installationen tills kopian är klar (sekunder till tiotals sekunder). Manuell admin-reset under arbetstid drabbas också. Klart när: långa filkopior i demo sker utanför tour_lock. Verifiera: kodgranskning - kopiera filer utan att hålla tour_lock, ta bara låset runt den korta DB/tour.json-delen.

- ID: `01KXVNJQFPQD22WX7NF3Z979B3`
- Type: improvement
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] Demo-reset kan krascha med unik-slug IntegrityError vid pågående tiling

_reset_demo_locked steg 1 hoppar över radering av Project-rad om _tile_running(slug) är True (tur hamnar i skipped). Steg 2 avgör skip bara via row.team_id != tid, inte om raden fortfarande finns med team_id == tid. Om tiling hinner bli klar i gapet mellan passen hittar steg 2 den kvarvarande raden, wipe:ar/kopierar filer och gör db.add(Project(slug=...)) för en slug som redan har en rad -> commit kastar IntegrityError, reset kraschar, filsystem out-of-sync med DB. Klart när: reset hanterar kvarvarande rad med samma slug utan dubblettinsert. Verifiera: kodgranskning - steg 2 ska uppdatera befintlig rad eller hoppa slugs som skippades i steg 1.

- ID: `01KXVNJQFA1X4Y58865F6Q82K1`
- Type: bug
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] _bring_solo_to_team skriver tour.json utan tour_lock (race -> dataförlust)

_bring_solo_to_team gör read-modify-write av tour.json/manifest utan tour_lock, till skillnad från syskonet _rewrite_tour_media_key som wrappar samma op i 'with tour_lock'. Sparar användaren scen-/hotspot-edit (scenes.py/plan.py tar tour_lock) samtidigt som POST /teams med bring_tours=1 migrerar samma tur, skriver sista skrivningen över den andra tyst: antingen tappas scenedit, eller media-ref-omskrivningen (stale /media/<old_uid>/-refs -> trasiga bilder). Klart när: media-ref-omskrivningen vid solo->team sker under tour_lock. Verifiera: kodgranskning - omslut read-modify-write med tour_lock som _rewrite_tour_media_key.

- ID: `01KXVNJQEVJ2DG42VXARHB1Y0G`
- Type: bug
- Actor: ai:code-review

---

## [P3][done] [svk-panorama] Lägg till tur-väljare (dropdown) för cross-tour-hotspots i stället för rå URL

## Context
Cross-tour-hotspoten (MVP, redan byggd) har ett rått URL-fält där man klistrar in målturens adress. En in-tool väljare vore trevligare och robustare: välj en annan av dina/teamets turer ur en dropdown i stället för att kopiera en URL manuellt.

## Acceptance criteria
- [ ] Hotspot-modalens "Länka till annan tur" kan välja en befintlig tur (dropdown över dina/teamets turer) + ev. målscen
- [ ] Verktyget lagrar en tur-REFERENS (slug), inte en frusen URL
- [ ] URL:en RESOLVERAS per deploy-kontext: editor (`/view?slug=`), publik delning (`/s/<token>` för målturen), self-host-bundle (relativ mapp / konfig-bas)
- [ ] MVP:ns råa URL-fält finns kvar som fallback för externa/godtyckliga länkar

## Implementation hints
- Kräver en URL-strategi per deploy-kontext, analog med bundle-relativiseringen (`app/services/bundle.py` `_relativize`). Designbeslut innan implementation.
- Hotspot-editorn: `app/static/scene.js` (scen-hotspot-modalen, extern-URL-läget) + `app/templates/scene.html`.
- Hänger ihop med TASK-26 (URL-rewrite kan använda samma slug->URL-resolver).
- ROADMAP.md ~rad 365.

- ID: `01KXV9CVV3S38GMHDJG8G3H73P`
- Type: feature
- Actor: ai:claude-opus-4-8

---

## [P3][done] [svk-panorama] Global in-process jobbkö + samtidighetsgräns för tunga jobb - backend (Fas 1, loop-bar)

## BESLUT (2026-07-19, modell låst 2026-07-23)
Alt (b) FIFO-jobbkö. LÅST modell: EN global in-process kö med N workers; N = den globala gränsen (max N samtidiga tunga jobb oavsett hur många turer/jobb som startas). Tiling läggs som ETT jobb PER SCEN (inte per tur) -> N workers = max N samtidiga Docker/nona-processer. Export + backup = ett jobb var i samma kö. SVK_JOB_WORKERS (default 2) ERSÄTTER per-tur tile_concurrency. UI-vyn är EGEN task (Fas 2) - DENNA task är backend + gräns bara.

## Nuläge (rotorsak)
- tiling.start_job (app/services/tiling.py:343) spawnar en egen daemon-tråd per tur; _run_job (:299) kör ThreadPoolExecutor(tile_concurrency) över _tile_one (:274) -> _run_docker (:211, tung Docker/nona). Ingen global gräns -> M turer = M x tile_concurrency samtidiga Docker-processer -> dränker värden.
- bundle.start_job (bundle.py:276) + backup.start_export (backup.py:138) = egna fristående daemon-trådar, okoordinerade.
- Var tjänst har eget in-memory _jobs[slug]-dict, pollat av egen status-endpoint: /tile-job/status (routes/tiling.py:43), /export/status (routes/export.py:27), /backup/status (routes/backup.py:32). tile-status.js/export.js/backup.js pollar dessa.

## Implementation (prescriptiv)
1. NYTT `app/services/jobqueue.py`: modul-global `queue.Queue` + N daemon-worker-trådar (starta i app/main.py lifespan, eller lazily vid första submit). API t.ex. `submit(fn, *, kind, slug, scene_id=None, label=None) -> job_id`. Varje worker plockar ETT item och kör `fn()` -> som mest N tunga jobb samtidigt. Ett centralt jobb-register (dict job_id -> {kind, slug, scene_id, status: queued|running|done|error, ts}) byggs här (Fas 2-UI läser det; Fas 1 behöver det för testet). Markera status queued->running->done/error; ALLTID done/error i finally (annars läcker en worker-slot).
2. tiling: byt `threading.Thread(_run_job).start()` (tiling.py:369) mot att `jobqueue.submit` ETT jobb per scen (varje kör _tile_one för en scen). Turens `_jobs[slug]` (status/done/total/entries) uppdateras när scen-jobben klarar (done++, entry-status) SÅ ATT job_status/project_tile_state + /tile-job/status ger OFÖRÄNDRAD svar-form för klienten. Ta bort per-tur ThreadPoolExecutor(tile_concurrency). VIKTIGT: manifest.json-skrivningen (under _manifest_lock) och turens overall-status (done när ALLA dess scen-jobb klara, error om någon) måste vara korrekt även när scen-jobb klarar i annan ordning via kön.
3. bundle + backup: byt sina `threading.Thread(_build).start()` (bundle.py:283, backup.py:145) mot `jobqueue.submit(_build, kind=...)` - ett jobb var i samma kö. Deras _jobs[slug] + status-endpoints OFÖRÄNDRADE.
4. config.py: `SVK_JOB_WORKERS` (int, default 2). Ta bort/deprecera tile_concurrency SOM samtidighetskontroll (worker-antalet styr nu global concurrency).

## Acceptanskriterier (objektiva)
- [ ] Deterministiskt test i tests/backend_test.py (plain-assert-stil, ingen pytest) bevisar att aldrig fler än N jobb kör samtidigt: monkeypatcha den tunga jobb-kroppen (jobqueue-workerns fn / _run_docker) att öka en trådsäker delad räknare, sova kort, minska den, och spåra observerad max-samtidiga. Enqueue:a K >> N jobb (blanda tiling-scen + export + backup). Assert observerad max <= N. Kör för N=2 OCH N=1.
- [ ] Alla tre jobbtyper (tiling per scen, export, backup) går genom den GEMENSAMMA kön (inga egna threading.Thread(_build/_run_job) kvar) - verifierbart i kod + testet.
- [ ] Befintliga status-endpoints (/tile-job/status, /export/status, /backup/status) + project_tile_state ger SAMMA svar-form som förr (tile-status.js/export.js/backup.js oförändrade). Verifiera: starta tiling, polla status -> done/total räknar upp, blir "done".
- [ ] SVK_JOB_WORKERS styr N (default 2); single-instans/in-process (ingen extern kö-tjänst/broker).
- [ ] Hela tests/backend_test.py grönt (inkl. nya testet).

## Klart när (loop-exit)
Samtidighetstestet passerar (max <= N för N=1 och N=2), alla tre jobbtyper går via kön, status-endpoints oförändrade, hela backend_test.py grön. Verifiera: `.venv/bin/python tests/backend_test.py`.

## För backlog-loop / Sonnet
Rent backend, deterministiskt testbart -> Judge-grinden = samtidighetstestet + backend_test.py. Rör INTE UI/status-vy (Fas 2, egen task). Bevara status-endpoint-formen exakt (bryt inte klient-polling). Deadlock-akta: en worker får aldrig blockera på ett annat jobb i samma kö (t.ex. vänta på tiling inifrån ett export-jobb) -> alla submits är fire-and-forget. Fällan att undvika: att bara flytta trådstarten in i kön men behålla per-tur ThreadPoolExecutor -> då blir global concurrency N x tile_concurrency, inte N. ROADMAP Fas 3-not "ingen jobbkö" gäller MULTI-instans; detta är in-process.

- ID: `01KXV9CVTQK812WNB30J2RCCTR`
- Type: improvement
- Actor: ai:claude-opus-4-8

---

## [P3][done] [svk-panorama] Skriv om cross-tour-hotspottarnas URL:er från gamla domänen till nya slugs

## Context
De 12 importerade legacy-turernas cross-tour-hotspots (`type:scene` + `URL`, ingen `sceneId`) pekar fortfarande på gamla domänen, t.ex. `https://panorama.svenskakyrkanharnosand.se/ho/hokg.html?scene=1`. En besökare som klickar hamnar på gamla sajten i stället för den migrerade turen. Migreringen är annars klar (importerade, tilade, kalibrerade).

## Acceptance criteria
- [ ] Varje cross-tour-hotspots URL i de importerade turerna pekar på motsvarande NYA tur (slug), inte gamla domänen
- [ ] `?scene=N`-deep-linken bevaras (mappas till målturens scen)
- [ ] Externa länkar till svenskakyrkan.se (icke-tur-sidor) lämnas orörda
- [ ] Idempotent: en andra körning ändrar inget
- [ ] Verifierat i browser att en cross-tour-hotspot navigerar till rätt ny tur

## Implementation hints
- Mappning legacy `<xx>/<namn>.html` -> ny slug (t.ex. `ho/hokg` -> `hogsjo-kyrkogard`); samma mappning som `tools/import_legacy.py` härledde vid import (loadPanorama-anrop + titlar) kan återanvändas.
- Lägg ett `--rewrite-urls`-läge i `tools/import_legacy.py` som går igenom projektens `tour.json`, matchar legacy-domän-URL:er och skriver om.
- Nya plattformens URL-format beror på kontext (`/view?slug=`, publik `/s/<token>`, bundle) - se TASK-28 för den generella lösningen; denna task kan börja enkelt.
- ROADMAP.md ~rad 370.

- ID: `01KXV9CVT829AS30BVRFD3P47X`
- Type: chore
- Actor: ai:claude-opus-4-8

---

## [P4][todo] [svk-panorama] Egna domäner: utred flytt till egen box + Caddy on-demand vid SLA-krav

## Context
NPM-API-vägen (TASK-397) räcker för de första kunddomänerna på TERVO2, men hemuppkopplingen (Bahnhof: ej garanterat statisk IP, ingen SLA, privat-ToS) är en affärsrisk när betalande kund pekar sin domän dit. Då blir en egen box motiverad - och Caddy on-demand TLS blir renast (äger :443, utfärdar cert inline), vilket INTE går på TERVO2 där NPM äger :443 (lastbärande för ~55 hosts). Spike för att utreda/förbereda flytten.

## Acceptance criteria
- [ ] Beslut: trigger för flytt (vilken kund/SLA-nivå), och om plattformen flyttas helt eller bara kunddomän-delen
- [ ] Caddy-config utkast: on-demand TLS + ask-endpoint `GET /internal/tls-allowed?host=` (läser verifieringstillstånd, TASK-396) + rate-limit
- [ ] Migrationsplan: Hetzner CX33 (~9 EUR/mån), Docker, persistent volym, IPv4, backup
- [ ] Bekräfta att `request_origin`-seamen (TASK-395) gör flytten transparent (ingen domänkod skrivs om)
- [ ] Data-migrering (svk.db + projects/ + media/) och DNS-cutover-plan

## Implementation hints
Se docs/hosting-egna-domaner.md avsnitt 2a, 3, 5, 6. Caddy ersätter NPM-API-skriptet (som slängs). Proxy-headers (TASK-393) behövs även bakom Caddy (skickar X-Forwarded-Proto/Host). Spike -> leverera beslutsunderlag + config-utkast, inte färdig migrering.

- ID: `01KY9MR9Q3E42A1VRS6TYA1FC9`
- Type: spike
- Actor: ai:claude-opus-4-8

---

## [P4][done] [svk-panorama] Gallra jobqueue-registret (done/error-jobb växer obundet i minnet)

Funnen under TASK-376. jobqueue._registry (app/services/jobqueue.py) tar ALDRIG bort done/error-poster - det växer obundet för processens livstid (varje scen-tiling-jobb, export, backup, någonsin). /admin/jobs-vyn visar bara senaste ~20 klara klient-side, men underliggande dict behåller allt i minnet -> långsam minnesläcka på en långkörande instans.

Fix-riktning: kapa/gallra registret - t.ex. droppa done/error-poster när de blir äldre än 'nyligen' (ts-baserat) eller när dicten överstiger N poster (behåll de N senaste). Görs i jobqueue (t.ex. i _worker efter markering, eller en periodisk trim). Bevara queued/running orörda.
Klart nar: registret slutar växa obundet (döda poster gallras); /admin/jobs opåverkad för nyliga jobb.
Prio: P4 (ingen akut påverkan förrän processen kört länge med många jobb; single-instans).

- ID: `01KY8MSPJB8S86Z6AJ6H53KD4B`
- Type: bug
- Actor: ai:claude-opus-4-8

---

## [P4][done] [svk-panorama] joblog.append återskapar en raderad projektmapp (mkdir parents=True)

Funnen under TASK-27-implementationen (av Sonnet-implementeraren, out-of-scope för den tasken, PRE-EXISTING - inte en regression).

joblog.append() (app/services/joblog.py:33) gör p.parent.mkdir(parents=True, exist_ok=True) innan den skriver _jobs.log. Om ett scen-tiling-jobb (eller export/backup-jobb) FELAR och når joblog.append EFTER att projektet raderats mitt under körningen (t.ex. användaren raderar turen medan tiling pågår), återskapas den tomma projektmappen. Resultat: en spök-projektmapp utan projekt i DB.

Obskyr (kräver radering exakt medan ett jobb felar), men reell. Blir något mer sannolik nu med jobbkön (jobb kan ligga köade och köra långt efter att de startades). Original _run_job hade en 'if _jobs.get(slug) is None: return'-guard men den täckte bara en top-level-kraschväg, inte den här.

Fix-riktning: joblog.append ska inte ÅTERSKAPA projektmappen - skriv bara loggen om projektmappen fortfarande finns (t.ex. exist_ok utan parents=True, eller en tidig 'if not project_dir(slug).exists(): return'-guard). Verifiera: radera en tur medan ett jobb felar (eller simulera: ta bort mappen, anropa joblog.append) -> mappen ska INTE återuppstå.

Prio: P4 (obskyr edge-case, ingen dataförlust - bara en tom spökmapp).

- ID: `01KY88WWQM3NDSFWHMM0V8XG0P`
- Type: bug
- Actor: ai:claude-opus-4-8

---

## [P4][done] [svk-panorama] Horisontell overflow på uppladdningssidan vid 390px (site-header account-meny)

Sonnet-agenten hittade under stegnav-omdesignen (TASK-348) en PRE-EXISTING bugg (orelaterad, inte orsakad av omdesignen): upload-sidan har horisontell sidoverflow vid 390px (scrollWidth 656 vs 390), spårad till .nav-right (kontomenyn) i site-headern. Ej fixad (utanför omdesignens scope). Klart nar: /projects/{slug} (upload) vid 390px har ingen horisontell overflow (scrollWidth <= 390). Verifiera: shot/Playwright vid 390px, mät document.documentElement.scrollWidth.

- ID: `01KY7YD9GMHBYG9JDPN1QDQV3K`
- Type: bug
- Actor: ai:ux-review

---

## [P4][done] [svk-panorama] Auto-skrolla stegindikatorn till aktivt steg vid sidladdning

När stegindikatorn (_step_nav.html, desktop) är horisontellt skrollbar (smal desktop, 5 steg med Översätt, eller man är på sista steget) kan aktivt steg ligga utanför synfältet efter att en ny sida laddats. Den borde skrolla så aktivt steg syns.

Fix: ~3 rader JS på sidladdning - skrolla indikatorn så .step-item.current syns/centreras: document.querySelector('.step-indicator .step-item.current')?.scrollIntoView({inline:'center', block:'nearest'}) (block:'nearest' så sidan inte skrollar vertikalt). Hemvist: step-menu.js (laddad globalt där stegnav:en finns). Låg risk, liten insats.
Klart nar: efter navigering till ett steg är det steget synligt i indikatorn utan manuell skroll.

- ID: `01KY6WD50JZ1V63QSDVX89CSKM`
- Type: improvement
- Actor: human:rasmus

---

## [P4][done] [svk-panorama] Plan-tomtext antar att scener redan finns

På projekt utan varken scener eller karta säger plan-tomtexten bara 'ladda upp en karta på uppladdningssteget' och länkar till scenhanteringen som om den vore redo - nämner inte att inga scener är uppladdade. Bara nåbart via direkt URL (normal nav gate:ar /plan tills scener finns), låg påverkan. Skärmdump: tmp/ux-review/desktop-empty-plan.png. Klart nar: tomtexten speglar faktiskt tillstånd (inga scener + ingen karta). Verifiera: öppna /plan på tomt projekt.

- ID: `01KXX41BMNV0EBJRDMBTH75BR0`
- Type: improvement
- Actor: ai:ux-review

---

## [P4][done] [svk-panorama] Pannellums engelska felruta läcker in i svenskt gränssnitt

En scen utan uppladdad bild visar Pannellums inbyggda engelska felruta 'No panorama image was specified.' mitt i ett annars helsvenskt gränssnitt (nåbart via direkt URL till tomt projekt; normal nav gate:ar det). Klart nar: läget visar en svensk platshållartext. Fix: fånga tomt-läget i editorn eller konfigurera Pannellums strings. Verifiera: öppna en scen utan bild, ingen engelsk text.

- ID: `01KXX41BM973GYSQFVV409YVWB`
- Type: improvement
- Actor: ai:ux-review

---

## [P4][todo] [svk-panorama] Mobil: kontroller renderas före kartan/panoramat (scroll-förbi)

På plan- och scenvyn renderas hela sidopanelens kontroller FÖRE den interaktiva ytan (karta/panorama) i DOM-ordning -> på 390px måste man scrolla långt förbi text/formulär innan man ser bilden man ska jobba med. Projektet är desktop-först så låg prioritet, men noterat. Skärmdumpar: tmp/ux-review/mobile-plan.png, mobile-scenes.png. Klart nar: på mobil syns den interaktiva ytan utan lång scroll (t.ex. CSS order/flex-reorder). Verifiera: shot 390px, panorama/karta inom första skärmen.

- ID: `01KXX41BKXV9J9AZG56V9D1Q3T`
- Type: improvement
- Actor: ai:ux-review

---

## [P4][done] [svk-panorama] Oanvänd import 'from app import config' i tiling.py

from app import config importeras på modulnivå men används aldrig (bara strängen 'config.json' och en lokal variabel 'config' i _tile_one finns, ingen app.config-attributaccess). Dead code/brus. Klart när: den oanvända importen är borttagen. Verifiera: grep config. i filen, samt att modulen fortfarande importerar.

- ID: `01KXVNJQM5SYVMW3SKE7JFYAM7`
- Type: chore
- Actor: ai:code-review

---

## [P4][done] [svk-panorama] Dead code: slug:-filtergren i media-library.js

applyFilters slug:-gren (filter.indexOf('slug:')===0) är dead code - buildFilterSelect erbjuder bara all/unused, och filens egen kommentar bekräftar att per-tur-filtrering flyttats till sökfältets tur:-token. Oåtkomlig, ofarlig, men förvirrande kvarleva. Klart när: den oåtkomliga grenen är borttagen. Verifiera: kodgranskning.

- ID: `01KXVNJQKVS7FWCMXBRAHPSY1Y`
- Type: chore
- Actor: ai:code-review

---

## [P4][done] [svk-panorama] Duplicerade media-upload-helpers i tre editor-JS-filer

uploadHsImage/uploadBrandImage/uploadImg (media-pool-upload via fetch /media/upload?slug=) och deras parade mediaAction/brandMediaAction (öppna mediebibliotek, infoga ![]()-markdown i aktiv EasyMDE) är byte-för-byte identisk logik duplicerad i scene.js, tour-preview.js och translate.js. En framtida ändring av upload-kontraktet måste upprepas på tre ställen. Kandidat för gemensam helper (t.ex. bredvid media-library.js). Klart när: upload/insert-logiken finns på ett ställe. Verifiera: kodgranskning.

- ID: `01KXVNJQKJW2VKPDZM6PMPXW7Y`
- Type: improvement
- Actor: ai:code-review

---

## [P4][done] [svk-panorama] create_project unik-slug-loop är TOCTOU -> 500 vid samtidig skapa

Unik-slug-loopen i create_project (read-then-check db.query().first() följt av db.add/commit) är TOCTOU: två samtidiga POST /projects med samma namn kan båda passera unikhetskollen, och andra commit:en faller på unik-constraint som ohanterat 500 i stället för att falla tillbaka till nästa suffix. Låg confidence - behöver verifieras mot faktisk constraint/felhantering. Klart när: samtidiga skapa med samma namn ger unika slugs utan 500. Verifiera: två parallella POST /projects med samma namn.

- ID: `01KXVNJQK8P8CZDHWBTHGPS8RH`
- Type: bug
- Actor: ai:code-review

---

## [P4][done] [svk-panorama] editor_home gör N+1 fil-/DB-läsningar per /editor-laddning

editor_home läser read_tour(p.slug) (JSON-fil) för varje synlig tur, plus history.pending_editor (fil) och checkout.current_holder (db.get(User)) per team-tur, ocachat. En användare/team med dussintals turer triggar dussintals fil-läsningar och per-rad-DB-lookups på varje hemsideladdning; svarstid skalar linjärt med turantal (jfr storage.py:s medvetna TTL-cache för samma problemklass). Klart när: /editor-laddning inte skalar linjärt med diskläsningar per tur. Verifiera: mät /editor-laddtid med många turer före/efter cache.

- ID: `01KXVNJQJXZ3WC8A6HE9021F21`
- Type: improvement
- Actor: ai:code-review

---

## [P4][done] [svk-panorama] Dölj scen-hotspot-etiketten tills pannellum projicerat hotspoten (editorn)

## Context
En scen-hotspots "leder-till"-etikett (belowLabel, t.ex. "-> Scen 4") byggs av `mdHotspotTooltip` via pannellums `createTooltipFunc` och läggs på hotspotens DOM-element (`hs.div`). Innan pannellums render-loop hunnit projicera hotspoten (vid panorama-load, eller när hotspoten är bakom kameran) ligger `hs.div` i (0,0) -> etiketten blinkar uppe till vänster i vyn tills positionen räknats ut. Efter belowLabel-scopingen (commit 51d4be8) visas etiketten BARA i scen-editorn (`scene.js cloneHs` anropar `attachHsTooltips` med `sceneLabel:true`); preview och publicerade turer är redan rena. Kvar: den kortvariga top-left-artefakten i EDITORN vid load. Kosmetiskt (P4), men syns på alla turer med scen-hotspots.

## Acceptance criteria
- [ ] I scen-editorn (`/projects/<slug>/scenes`) syns INGEN "-> Scen N"-etikett i vyns övre vänstra hörn under panorama-load
- [ ] En scen-hotspots etikett syns korrekt (vid hotspoten) när den faktiskt projiceras i vyn
- [ ] Ingen etikett-artefakt kvarstår för hotspots som är bakom kameran (utanför vy)
- [ ] Ingen regression i preview/publicerad tur (belowLabel visas där även fortsatt INTE alls)
- [ ] Inga nya JS-fel i scen-editorn

## Implementation hints
- Etiketten byggs i `app/static/markdown.js` (`mdHotspotTooltip`, `belowLabel`-grenen) - elementet läggs på `hs.div`. Göm det (t.ex. `visibility:hidden` / en `hs-pos-pending`-klass) tills `hs.div` fått en icke-(0,0)-transform av pannellum, och visa det då.
- Möjliga triggers: en `requestAnimationFrame`-poll på `hs.div`s beräknade position, en MutationObserver på dess `style.transform`, eller att haka på pannellums scen-render/`mouseup`. Slå upp pannellums hotspot-positionering i deras docs (CLAUDE.md: gissa inte pannellum-beteende).
- Berör ENDAST editorn (`scene.js cloneHs` med `sceneLabel:true`); rör inte preview/runtime-vägen.
- ROADMAP.md ~rad 300.

## Verification
- Browser (shot-venv/Playwright): ladda `/projects/hogsjo-gamla-kyrka/scenes`, mät under/precis efter load att inget `.pnlm-tooltip .hs-scenelabel`-element (belowLabel) har en skärmposition i övre vänstra hörnet; efter att en scen-hotspot roterats in i vy syns dess etikett vid hotspoten. Inga console-fel.
- Regression: `/projects/<slug>/view` och `/preview` visar fortfarande INGEN belowLabel (grep embedded tour / DOM).

- ID: `01KXV9CVVEW1T4YSN3B1Q05CFT`
- Type: bug
- Actor: ai:claude-opus-4-8

---

