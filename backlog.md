# Backlog Export

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

## [P3][todo] [svk-panorama] Inför global samtidighetsgräns för tunga bakgrundsjobb (tiling/export/backup)

## BESLUT (2026-07-19)
Vald ansats: **Alt (b) - riktig FIFO-jobbkö med N workers + samlad status-vy** (inte den enkla semaforen i alt a). Ger köad-status i UI, förutsägbar ordning och en samlad vy över alla körande/köade jobb - bättre långsiktigt, särskilt inför Fas 4 (flera team). UPPSKJUTET - implementeras inte nu, tas när jobb-kontention faktiskt skaver (bulk-import eller flera aktiva team).

## Context
Det finns ingen global samtidighetsgräns över turer. tiling.start_job(slug) (app/services/tiling.py:369) startar en egen daemon-tråd per tur, och TILE_CONCURRENCY (default 2) begränsar bara scener INOM en tur. Startar man tiling på M turer -> M x TILE_CONCURRENCY samtidiga Docker-processer (nona/generate.py, _run_docker tiling.py:211) -> kan dranka värden (CPU/RAM/disk-I/O). Export (bundle._build bundle.py:283) och backup (backup._build backup.py:145) är också fristående, okoordinerade trådar. Blir mer akut vid bulk (12 importerade turer) och i Fas 4.

## Acceptance criteria
- [ ] Totalt antal samtidiga tunga jobb bundet av en global gräns, oavsett hur många turer/jobb som startas
- [ ] Gränsen komponerar med per-tur TILE_CONCURRENCY
- [ ] Gäller tiling + export + backup (delad kö)
- [ ] Köad-status synlig i UI + samlad vy över körande/köade jobb (kärnan i alt b)
- [ ] Fortfarande single-instans (in-process), ingen extern kö-tjänst
- [ ] Konfigurerbar (t.ex. SVK_GLOBAL_TILE_SLOTS / antal workers)

## Implementation (alt b, vald)
FIFO-kö + fast worker-pool (N workers) som drar jobb ur kön; tiling/export/backup lägger jobb i kön i stället för att spawna egna trådar. Samlad status-modell (körande/köade/klara) + UI-vy. OBS: ROADMAP Fas 3-not 'ingen jobbkö' gäller MULTI-INSTANS-kö; detta är in-process. ROADMAP.md ~rad 91.

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

