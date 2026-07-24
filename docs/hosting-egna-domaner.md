# Hosting och egna domäner - utredning (Fas 4.3)

Utredning 2026-07-24 inför Fas 4.3 ("egna domäner per team"). Bakgrund: ROADMAP:en
förutsätter Caddy on-demand TLS, men produktionen körs idag på TERVO2 bakom Nginx
Proxy Manager (NPM) på en hemuppkoppling. Frågan: kör vi först på TERVO2, och vad
kostar/kräver en flytt till Hetzner?

**Grundpremiss (Rasmus 2026-07-24):** två skilda saker med skilda domäner.

- **Editorn/admin-appen** (där fotografen loggar in och bygger turer) kör på EN
  plattformshost, `pano.pettersson-vik.se`, på TERVO2. Single host, per-host
  HTTP-01-cert som de ~55 befintliga NPM-hostarna. Trivialt, inget att utreda.
- **De publicerade turerna** levereras på **varje teams EGNA domän** - t.ex.
  `panorama.svenskakyrkanharnosand.se`, `panorama.<team>.se`. Godtyckliga
  kunddomäner. Samma FastAPI-app (host-baserad tenant-resolution avgör vilket
  teams innehåll som serveras), men på kundens domän.

Detta är INTE framtida nice-to-have: det är exakt hur legacy fungerar **redan
idag**. `panorama.svenskakyrkanharnosand.se` kör nu via NPM (proxy-host id 35 ->
`192.168.1.2:9590`), manuellt uppsatt. Den nya plattformen ska göra samma sak men
**self-serve**. Alltså är äkta kunddomäner kärnan från dag ett; den enda frågan är
hur cert + routing **automatiseras** (idag: en manuell NPM-proxy-host + cert per
domän).

Wildcard-subdomän under vår egen domän (`<team>.pano.pettersson-vik.se`) är en
**valfri fallback** för team utan egen domän - inte huvudmodellen.

## TL;DR - de två besluten du behöver ta

**Beslut A (produkt): kundens egen domän eller vår subdomän?** Kundens egna domän
(`panorama.<org>.se`) är normen och matchar legacy; vår subdomän är en fallback
för team som saknar/inte vill ha egen domän.

| | Kundens egna domän (norm) | Vår subdomän (fallback) |
|---|---|---|
| Exempel | `panorama.svenskakyrkanharnosand.se` | `harnosand.pano.pettersson-vik.se` |
| Cert | Ett cert **per kunddomän** | **ETT** wildcard (`*.pano.pettersson-vik.se`) |
| White-label | Full (kundens egen domän) | Delvis (vår domän syns) |
| Matchar dagens legacy? | Ja | Nej (nytt) |

**Beslut B (infra): hur automatiseras cert + routing för kundens egna domäner?**
Detta är den verkliga utredningsfrågan (Beslut A:s fallback-spalt löses av ett
enda wildcard och är trivial).

| | TERVO2 bakom NPM (nu) | Egen Hetzner-box (Caddy) |
|---|---|---|
| Mekanism | NPM-API eager provisionering | Caddy on-demand (inline) |
| Relation till idag | Automatiserar dagens **manuella** NPM-process | Ny box, ersätter processen |
| Kostnad | ~0 kr | ~€9/mån |
| Egen orkestreringskod | Ja (litet skript mot NPM-API) | Nej (Caddy sköter allt) |
| Rör produktions-NPM | Nej (bara API-anrop) | Nej (separat box) |
| SLA / betalande kund | Nej (hemuppkoppling) | Ja |

**Rekommendation:** editorn på `pano.pettersson-vik.se` nu (trivialt). För
kunddomäner: **automatisera dagens manuella NPM-process via dess API** (verify ->
skapa proxy-host + cert) - funkar på TERVO2, ingen ny hårdvara. Flytta till egen
Hetzner-box + Caddy on-demand när en betalande kund + SLA-krav gör
hemuppkopplingen till en affärsrisk. `request_origin`-seamen gör flytten
transparent för domänkoden.

## 1. Vår subdomän som fallback (billigt, för team utan egen domän)

Team utan egen domän kan få `<team>.pano.pettersson-vik.se`. Ett enda
wildcard-cert `*.pano.pettersson-vik.se` täcker obegränsat antal - kräver en
engångskonfiguration i NPM med DNS-01-challenge (DNS-providerns API-token för
`pettersson-vik.se`). Efter det kan `harnosand.`, `sundsvall.` osv. pekas mot
instansen utan att någon rör proxyn per team.

Detta är en bekvämlighet vid sidan av huvudmodellen (kundens egna domän), inte ett
substitut - de flesta kyrkokunder vill ha `panorama.<egen-domän>.se` för
white-label.

## 2. Äkta kunddomäner - vad som faktiskt krävs

En kund som vill köra sina turer på `panorama.<egen-domän>.se` kan vi inte förutse
i förväg -> vi behöver ett cert per kunddomän. Detta görs redan idag för legacy,
manuellt (en NPM-proxy-host + cert per domän). Frågan är hur det **automatiseras**
för self-serve. Det finns **två** vägar (Beslut B):

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

För editorn och de första kunddomänerna via NPM-API: helt acceptabelt. Som värd
för betalande kunders egna domäner med SLA-förväntan: motiverar en riktig VPS.

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

**Steg 0 - editorn på `pano.pettersson-vik.se`, TERVO2 (valt startläge):** en
NPM-proxy-host för editor-/admin-appen, per-host HTTP-01-cert som de befintliga.
Ingen ny hårdvara. Fotografer loggar in och bygger här. (Turer kan visas via
`/view` och delas via `/s/{token}` på denna host redan innan kunddomäner finns.)

**Steg 1 - kunddomäner för publicerade turer via NPM-API (kärnan):** automatisera
dagens manuella process (`panorama.<org>.se` -> app) med host-baserad
tenant-resolution + `Team.base_url`. Flöde: team lägger till domän -> DNS-/TXT-
verifiering -> skript skapar NPM-proxy-host + cert via API. Funkar på TERVO2, ingen
ny hårdvara. Duger så länge lasten är låg och SLA-krav saknas.

**Steg 1b - vår subdomän som fallback (valfritt):** wildcard-cert
`*.pano.pettersson-vik.se` via DNS-01 för team utan egen domän. Engångssetup i
NPM, `Team.base_url` -> subdomän. Vid sidan av steg 1, inte i stället för.

**Steg 2 - när betalande kund + SLA-krav:** egen Hetzner CX33 + Caddy on-demand
TLS. Flytta appen dit; Caddy äger 443 på den boxen och sköter kunddomän-cert
inline (NPM-API-skriptet slängs). TERVO2:s NPM påverkas inte.
`request_origin`-seamen (avsnitt 7) gör att domänlogiken inte behöver ändras vid
flytten - bara var appen körs.

**Steg 3 - produktion/skala:** enligt ROADMAP:s "vid produktionssättning" -
riktiga creds, ev. Postgres, Alembic-baslinje.

Poängen: **kunddomäner (steg 1) är kärnan och kan börja på TERVO2** genom att
automatisera den process du redan kör manuellt - flytten till Caddy/Hetzner (steg
2) blir en driftfråga när affären motiverar det, inte en förutsättning för att
komma igång, och domänkoden skrivs inte om.

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
