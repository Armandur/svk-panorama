# Hosting och egna domäner - utredning (Fas 4.3)

Utredning 2026-07-24 inför Fas 4.3 ("egna domäner per team"). Bakgrund: ROADMAP:en
förutsätter Caddy on-demand TLS, men produktionen körs idag på TERVO2 bakom Nginx
Proxy Manager (NPM) på en hemuppkoppling. Frågan: kör vi först på TERVO2, och vad
kostar/kräver en flytt till Hetzner?

**Grundpremiss (Rasmus 2026-07-24):** plattformen (tjänsten) kör på sin **egen
domän**. En organisation som `svenskakyrkanharnosand.se` är en **KUND**, inte
plattformens domän. Alltså är äkta kunddomäner en kärnfunktion, inte ett
specialfall - men plattformens egna subdomäner täcker de team som inte behöver
egen domän.

**Startpunkt (Rasmus 2026-07-24):** till att börja med kör plattformen på en
**subdomän under `pettersson-vik.se`** (t.ex. `svk-panorama.pettersson-vik.se`)
**på TERVO2**. Det är en enkel single-host-deploy: en NPM-proxy-host med per-host
HTTP-01-cert, precis som de ~55 befintliga. Inga per-team-domäner, ingen Caddy,
ingen ny hårdvara. Team når sina turer via appen (path/`/view`/`/s/{token}`) på
den enda hosten. Wildcard-subdomäner (avsnitt 1) och äkta kunddomäner (avsnitt 2)
är BÅDA framtida steg ovanpå detta - resten av utredningen beskriver den vägen när
den blir aktuell.

## TL;DR - de två besluten du behöver ta

**Beslut A (produkt): per team - platform-subdomän eller egen domän?** De flesta
team kan börja på en plattform-subdomän; vissa vill ha sin egen. Båda lever
sannolikt sida vid sida.

| | Platform-subdomän | Äkta kunddomän |
|---|---|---|
| Exempel | `harnosand.svk-panorama.se` | `virtuelltur.svenskakyrkanharnosand.se` |
| Cert | **ETT** wildcard-cert (`*.svk-panorama.se`) | Ett cert **per kund** |
| On-demand TLS behövs? | Nej | Ja (eller eager provisionering, se nedan) |
| Ny infra/kostnad | ~0 kr | Beror på var plattformen bor (Beslut B) |
| White-label-känsla | Delvis (vår domän syns) | Full (kundens egen domän) |

**Beslut B (infra): var bor plattformen?** Detta avgör HUR kunddomäners cert
löses:

| | TERVO2 (bakom NPM) | Egen Hetzner-box (Caddy) |
|---|---|---|
| Kunddomän-cert | NPM-API-skript (eager provisionering) | Caddy on-demand (inline) |
| Kostnad | ~0 kr | ~€9/mån |
| Egen orkestreringskod | Ja (litet skript) | Nej (Caddy sköter allt) |
| Rör produktions-NPM | Nej (bara API-anrop) | Nej (separat box) |
| SLA / lämplig för betalande kund | Nej (hemuppkoppling) | Ja |

**Rekommendation:** plattform-subdomäner + wildcard-cert nu (nästan gratis, funkar
på TERVO2 idag). För kunddomäner: NPM-API-vägen duger för de första kunderna på
TERVO2; flytta till egen Hetzner-box + Caddy när en betalande kund + SLA-krav gör
hemuppkopplingen till en affärsrisk.

## 1. Plattform-subdomäner - billigast, täcker de flesta

Ett enda wildcard-cert `*.svk-panorama.se` (plattformens egen domän) täcker
obegränsat antal team-subdomäner. NPM stödjer detta redan - kräver bara en
engångskonfiguration med DNS-01-challenge (DNS-providerns API-token för
plattformsdomänen). Efter det kan `harnosand.`, `sundsvall.`, `timra.` osv. pekas
mot instansen utan att någon rör proxyn per team. ROADMAP:en flaggar redan detta
som "nollkonfig-default först".

Detta kräver att vi äger en plattformsdomän och kan lägga DNS-01 för den. Det är
oberoende av var plattformen bor (TERVO2 eller Hetzner - wildcard funkar på båda).

## 2. Äkta kunddomäner - vad som faktiskt krävs

En kund som vill köra på `svenskakyrkanharnosand.se` (eller subdomän därav) kan vi
inte förutse -> vi behöver ett cert per kunddomän. Det finns **två** vägar, och
valet hänger på Beslut B (var plattformen bor).

### 2a. Caddy on-demand TLS (renast - kräver egen box)

Caddy håller TLS-handslaget öppet för ett okänt SNI, anropar en ask-endpoint
(`GET /internal/tls-allowed?host=`) som svarar 200 bara för verifierade domäner,
kör ACME mot Let's Encrypt och serverar certet - allt inline, per request. Ingen
förprovisionering, ingen egen orkestrering. Inbyggt rate-limit-skydd
(`interval`/`burst`) mot cert-missbruk.

Haken: **Caddy måste äga port 443.** Se avsnitt 3 om varför det inte går på TERVO2
utan att röra NPM -> Caddy-vägen betyder i praktiken en egen box.

### 2b. NPM-API eager provisionering (funkar på TERVO2)

**Vad hindrar NPM från on-demand?** Det är en arkitekturbegränsning i NPM, inte en
nginx-omöjlighet:

- **NPM är en statisk config-generator.** Node-appen skriver ett `server{}`-block
  per proxy-host till disk, med `ssl_certificate` mot en PEM-fil certbot redan
  hämtat, och reloadar nginx. Allt provisioneras i förväg.
- **Stock-nginx har ingen cert-hämtning vid handslag.** Cert väljs per
  `server{}`-block utifrån SNI, från filer redan på disk. Okänt SNI -> inget
  matchande block -> default-cert -> cert-mismatch i webbläsaren. Ingen krok
  "okänt SNI -> skaffa cert nu".
- **certbot körs som separat batch-steg**, inte i request-vägen.
- **Nyans:** NPM:s motor är OpenResty, som *kan* on-demand via
  `ssl_certificate_by_lua` (biblioteket `lua-resty-auto-ssl` gör precis det).
  Primitiven finns i motorn - NPM använder bara inte den vägen. Alltså: det som
  hindrar är NPM:s design, inte openresty i sig.

**Men on-demand behövs inte för den här skalan.** NPM har ett REST-API (wrappas av
`nginx-proxy`-skillen), så appen kan provisionera cert vid rätt tillfälle. Det
naturliga flödet har inget "första besökaren får fel"-glapp:

1. Kund lägger till sin domän i appen.
2. Appen: "peka DNS mot oss, klicka verifiera."
3. Kund sätter DNS. Appen verifierar (DNS/TXT-token).
4. **Nu** anropar appen NPM:s API -> skapa proxy-host + begär cert. HTTP-01 funkar
   direkt eftersom DNS redan är live.

certbot/NPM sköter förnyelser efteråt. Skillnaden mot Caddy:

- **Caddy:** noll förprovisionering, cert inline, ingen egen orkestrering.
- **NPM-API:** du äger ett litet skript (idempotens, retries, felhantering) - men
  förnyelser sköts av NPM.

För en handfull kyrkokunder är NPM-API-vägen fullt duglig. NPM:s API är dock
odokumenterat (community luskar i schema/källkod), så räkna med lite reverse
engineering. Caddy vinner på operativ enkelhet; NPM-API vinner på att det funkar
på TERVO2 utan ny hårdvara.

## 3. :443-problemet - varför Caddy inte kan samexistera med NPM på TERVO2

Bara en process kan binda port 443 per IP. NPM äger 443 på TERVO2, och NPM är
lastbärande för hela hemmet: Plex, Frigate, *arr, samtliga `*.pettersson-vik.se`
och `*.svenskakyrkanharnosand.se` (~55 proxy-hosts). Global CLAUDE.md: rör inte
NPM:s produktionsrouting utan att fråga.

Caddy on-demand kräver att Caddy äger 443. På TERVO2 finns bara dåliga vägar:

1. **Ersätt NPM med Caddy för allt** - migrera ~55 hosts. Stort, riskabelt ingrepp
   i fungerande hemma-infra för en enda ny funktion.
2. **SNI-baserad L4-routing framför båda** (nginx `stream{}` + `ssl_preread`) -
   bräckligt, NPM:s UI/API känner inte till det, kan brytas av NPM-uppdateringar.
3. **Olika portar** - fungerar inte, kundens domän pekar på 443 rakt av.

Slutsats: **Caddy on-demand -> egen box.** NPM-API-vägen (2b) är därför det enda
rimliga sättet att göra kunddomäner *på TERVO2*, eftersom den bara pratar med NPM
via API i stället för att konkurrera om 443.

## 4. Hemservern som produktionsvärd för betalande kunder

Oberoende av TLS-mekaniken: i det ögonblick en extern kund pekar sin domän mot
TERVO2 slutar maskinen vara den "lekplats" som resten av min setup är byggd för.

- **Publik IP hos Bahnhof är en tilläggstjänst och inte garanterat statisk.** En
  IP som kan ändras + kunddomäner som pekar dit = avbrott vid IP-byte. Kräver
  garanterad statisk IP eller dynamisk DNS med kort TTL (ändå glapp).
- **Ingen SLA.** Strömavbrott, routeromstart, ISP-underhåll = kundens turer nere
  utan varning. OK för PoC, en affärsrisk för betalande kund.
- **ToS.** Privatabonnemang begränsar ofta till "personligt bruk" och förbjuder
  kommersiell serverdrift - en avtalsfråga att kolla explicit innan man tar betalt
  för tjänst som körs där.

För hobbytester och de första kunderna på plattform-subdomän: helt acceptabelt.
Som värd för betalande kunders egna domäner: motiverar en riktig VPS.

## 5. Hetzner - kostnad (post prishöjning juni 2026)

Hetzner höjde priserna två gånger under 2026. CX-serien (delad Intel/AMD) ger nu
klart bäst pris/prestanda; CPX/CCX blev oproportionerligt dyra.

| Plan | vCPU | RAM | Disk | Trafik | €/mån |
|---|---|---|---|---|---|
| CX23 | 2 | 4 GB | 40 GB | 20 TB | 5,49 |
| **CX33** | **4** | **8 GB** | **80 GB** | **20 TB** | **8,49** |
| CX43 | 8 | 16 GB | 160 GB | 20 TB | 15,99 |

**Rekommenderad startplan: CX33 (~€8,49 + €0,50 IPv4 = ~€9/mån, ~110 kr).**
Tiling (nona/generate.py) är CPU/minnestungt men körs i korta jobb; 4 vCPU/8 GB
ger marginal för `TILE_CONCURRENCY=2` parallellt med editorn. CX23 är i underkant
om tiling och redigering krockar. Skala till CX43 utan arkitekturbyte (live
resize) om flera team laddar upp samtidigt blir vanligt.

Detaljer:
- **IPv4** kostar numera +€0,50/mån/instans; **IPv6** gratis (/64 ingår).
- **Obegränsat antal kunddomäner** (A/AAAA mot samma IP) utan extra kostnad -
  precis vad on-demand-modellen kräver.
- **Backup** (7 rullande) = +20% av serverpriset (~+€1,70/mån för CX33).
- **Plats:** Helsingfors (~8 ms från Sverige) eller Nürnberg - båda utmärkta.
- **ARM (CAX):** hoppa över tills vidare - ingen prisfördel efter höjningen, och
  `pannellum-multires`-imagen måste byggas nativt för arm64 (annars
  QEMU-emulering som dödar tiling-prestandan).
- **Alternativ:** Contabo billigare på pappret men överbokad CPU (risk för
  tiling); Netcup jämförbart; DigitalOcean/Fly.io 5-7x dyrare för alltid-på.
  Hetzner CX är rätt nivå.

## 6. Rekommenderad sekvens

**Steg 0 - nu, på TERVO2 (valt startläge):** single-host under en subdomän till
`pettersson-vik.se` (t.ex. `svk-panorama.pettersson-vik.se`). En NPM-proxy-host,
per-host HTTP-01-cert som de befintliga. Ingen multi-tenant-domänlogik, ingen
Caddy, ingen ny hårdvara. Alla team på samma host.

**Steg 0b - plattform-subdomäner (när per-team-domän önskas, billigt):** wildcard
för `*.svk-panorama.pettersson-vik.se` via DNS-01 (kräver DNS-providerns
API-token för `pettersson-vik.se` - engångssetup i NPM). `Team.base_url` ->
subdomän, host-baserad tenant-resolution. NPM orört i övrigt.

**Steg 1 - första kunddomänerna, fortfarande på TERVO2 (om du vill):**
NPM-API-eager provisionering (2b). Bygg domänverifiering (TXT-record) +
verify-then-provision-skript mot NPM:s API. Funkar med hemuppkopplingen så länge
lasten är låg och SLA-kraven inte finns.

**Steg 2 - när betalande kund + SLA-krav:** egen Hetzner CX33 + Caddy on-demand
TLS. Flytta plattformen dit; Caddy äger 443 på den boxen och sköter cert inline.
TERVO2:s NPM påverkas inte. `request_origin`-seamen (avsnitt 7) gör att
domänlogiken inte behöver ändras vid flytten - bara var appen körs.

**Steg 3 - produktion/skala:** enligt ROADMAP:s "vid produktionssättning" -
riktiga creds, ev. Postgres, Alembic-baslinje.

Poängen: **steg 0 kräver inget av det dyra.** Plattform-subdomäner levererar
multi-tenant-domäner idag. Kunddomäner kan börja på TERVO2 via NPM-API och flytta
till Caddy/Hetzner när affären motiverar det - utan att domänkoden skrivs om.

## 7. Kodpåverkan (mestadels redan förberett)

- **`deps.request_origin(request)`** är redan single seam (5 call sites
  konsoliderade). Byts till att läsa `Team.base_url` före request-host -> per-team
  origin på ETT ställe. Gäller alla domänspår, och gör en framtida TERVO2 ->
  Hetzner-flytt transparent för domänlogiken.
- **Proxy-headers saknas idag** (verifierat: ingen `--proxy-headers`/
  `ProxyHeadersMiddleware`). Bakom vilken reverse proxy som helst (NPM eller
  Caddy) måste uvicorn startas med `--proxy-headers --forwarded-allow-ips=<proxy-ip>`
  annars ger `request.base_url` fel scheme (http). NPM skickar
  `X-Forwarded-Proto` men INTE `X-Forwarded-Host` (originalvärdet finns i `Host`);
  Caddy skickar båda. Måste fixas innan valfritt domänspår går live.
- **Tenant-resolution-middleware** (host -> Team, sätter `request.state.team`),
  efter SessionMiddleware, före routrar. Samma för alla spår.
- **Domänverifiering (TXT-token)** krävs för äkta kunddomäner (steg 1+) - annars
  kan team A claima team B:s domän / trigga cert för godtycklig host. Behövs för
  BÅDE NPM-API- och Caddy-vägen (Caddys ask-endpoint läser samma
  verifieringstillstånd). Plattform-subdomäner behöver ingen verifiering (vi äger
  domänen).
- **NPM-API-integration (bara för steg 1 på TERVO2):** provisioneringsskript mot
  NPM:s REST-API (skapa proxy-host + cert vid verifierad domän). Slängs om/när
  plattformen flyttar till Caddy - Caddy behöver ingen sådan kod.
- **og:url-policy:** per-domän (request/`Team.base_url`) är rätt för white-label -
  varje kund äger sin egen förhandsvisning. Dokumenteras när `Team.base_url`
  införs.

## Källor

Hetzner-priser: officiellt pressmeddelande om prishöjning juni 2026, Costgoat/
Northflank/Bitdoze pristabeller (hämtade 2026-07-24). NPM/Caddy: Caddy on-demand
TLS-docs, NPM GitHub-diskussion #3265 (API), issue #4119 (SNI-routing), nginx
`ssl_preread`-docs, `lua-resty-auto-ssl`. Bahnhof publik IP: bahnhof.se +
Sweclockers-tråd. Full käll-lista i utredningens research-underlag.
