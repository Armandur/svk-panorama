# Stegnavigeringen i editorn - UX-underlag inför beslut

Sammanställning av UX-granskningen av editorns stegnavigering (Uppladdning → Placering →
Scenhantering → [Översätt] → Förhandsvisning). Underlag för att välja riktning - **inget
byggt/ändrat ännu** utöver de två små buggfixar som redan gjordes (se historik).

---

## 1. Vad det gäller

Fotografen går igenom editorn i **steg**. Vi vill ha en stegnavigering som ger:

- **Var är jag?** (aktuellt steg)
- **Se hela flödet** (alla steg i en blick)
- **Hoppa mellan steg** + föregående/nästa

Idag ligger stegnavigeringen (`_step_nav.html`) i en flex-rad (`.plan-topnav`) med **fyra
saker sida vid sida**:

1. Hamburgermeny (☰) → Huvudmeny + Versionshistorik + (på mobil) stegen
2. Stegindikator (numrerade prickar, aktivt steg har etikett)
3. Föregående/Nästa-pilar
4. Ibland "Helskärm" (bara preview-steget)

**Kritisk begränsning:** på plan/scenes/preview ligger hela raden **inuti** den smala
vänster-sidopanelen `.planner-side`, som är **fast 21rem (~322px)** bred oavsett
skärmbredd. Panoramat/kartan tar resten. Projektet är desktop-först; på mobil (<768px)
döljs steppern och hamburgaren bär stegen.

---

## 2. Historik - varför vi tar en om-funderare

Stegindikatorn lades till (TASK-111) och har sedan **lappats om och om igen**:

- Alla etiketter → ~549px innehåll → skrollade alltid i 322px-panelen
- Vertikal skrollbar dök upp (Pico `li`-padding + overflow-quirk) → fixad
- Horisontell skrollbar klippte toppen av cirklarna → skrollbar dold
- Gjord kompakt (bara prickar + aktiv etikett) → **ändå** klipps vänstra cirkeln från
  steg 2, och föregående-pilen "hoppar upp ett steg"

Det mönstret (ny bugg för varje fix) är själva signalen: vi tvingar in fel komponent i
fel utrymme. Därför den här granskningen.

---

## 3. Diagnos (grundorsak, inte en CSS-bugg)

Mätt med Playwright (`getBoundingClientRect`, `scrollWidth`/`clientWidth`) vid 1280px och
1440px - **identiska resultat**, vilket bekräftar att panelen är fast 21rem (ingen
responsiv brytpunkt är inblandad):

| Sak | Bredd |
|---|---|
| Tillgängligt för hela raden (`.plan-topnav`) | **~306px** |
| Hamburgare | 38px |
| Stegindikator | **217-273px** (beror på aktiva stegets namnlängd) |
| Pilknapp (×1-2) | 38px styck |

- **Steg 2 ("Placering", båda pilar):** behov ≈ **358px** mot 306px → **52px överflöde** →
  pilen radbryter mitt i pilparet (den "hoppar" ensam till rad 2).
- **Steg 3 ("Scenhantering"):** bredare indikator → brottet hamnar före båda pilarna (de
  hamnar ihop på rad 2 i stället - mindre fult, men ändå en extra rad).
- **Steg 4 ("Förhandsvisning", bara 1 pil):** indikatorn (273px) + hamburgare (38px)
  ligger redan ~5px utanför - ser ok ut bara för att det finns en enda pil att tränga in.

**Det avgörande:** var radbrottet hamnar beror på **hur många tecken det aktiva stegets
namn har**. Det är alltså strukturellt instabilt - varje ny namnlängd (t.ex. när
"Översätt"-steget aktiveras för en flerspråkig tur) kan ge ett nytt, otestat brytmönster.
Ingen ytterligare kompression (mindre font, dolda etiketter) löser det - den flyttar bara
brytpunkten.

**Dessutom - dold dubblering:** hamburgarmenyn listar redan ALLA steg med aktuellt
markerat - exakt samma information som stegindikatorn, fast vertikalt och utan
platsproblem. Två komponenter tävlar om samma smala rad för att säga samma sak.

**Slutsats:** en horisontell stepper är designad för generöst horisontellt utrymme (en
fullbredds-header). Att pressa in den + hamburgare + 1-2 pilar i en rad låst vid ~306px
är att kämpa mot mönstrets egna förutsättningar.

### Skärmdumpar (live-buggarna)

- Steg 2 - pilen "hoppar" (inzoomad topnav): http://ubuntu-ai:8890/share/64dd1eabfa56/plan-1280-topnav-zoom.png
- Steg 4 - "bästa fallet", ligger ändå ~5px från överflöde: http://ubuntu-ai:8890/share/36f974a6b2b7/preview-1280-topnav-zoom.png

---

## 4. Designalternativ

### Alt A - "Steg 2 av 4 · Namn" + tunn progressbar

Ersätt prick-steppern med en textrad + smal progressbar. Kvar i sidopanelen.

```
[☰]  Steg 2 av 4 · Placering            [←][→]
▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

- **Ryms i 306px:** Ja, alltid (bara text + bar, kan trunkeras).
- **+** Garanterat ingen radbrytning oavsett namnlängd. Minst att bygga/underhålla.
- **−** Ser inte alla stegnamn i raden - kräver hamburgaren för det. Mindre visuellt rikt.

### Alt B - vertikal stepper i panelen

Stapla stegen vertikalt överst i `.planner-side` (prick + fullt namn per rad).

```
[☰]                          [←][→]
● Uppladdning
● Placering  (nu)
○ Scenhantering
○ Förhandsvisning
──────────────────
 ...panel-innehåll...
```

- **Ryms:** Bredd inget problem (namn liggande). Kostar i stället **höjd**.
- **+** Aldrig klippning, fulla etiketter alltid, naturligt klickbart.
- **−** Äter permanent ~100-150px höjd i en redan trång panel; dubblerar hamburgarens
  lista om den inte tas bort samtidigt.

### Alt C - flytta UT ur sidopanelen till en egen full-bredd topbar

Hela stegraden flyttas ut ur `.planner-side` till en rad som spänner **hela**
editor-bredden, ovanför både panel och panorama/karta. Samma idé som den befintliga gröna
"Du redigerar den här turen"-banderollen (`.editor-lock-banner`, fast full-bredd).

```
┌──────────────────────────────────────────────────────────────────────┐
│ [☰]  ① Uppladdning ─ ② Placering ─ ③ Scenhantering ─ ④ Förhandsvisning │  [←][→]
├───────────────┬────────────────────────────────────────────────────────┤
│ Placering      │                                                        │
│ Hemsö kyrkogård│                  karta / panorama                      │
│  ...panel...   │                                                        │
```

- **Ryms:** Trivialt - 1280px+ räcker för fyra fulla etiketter + pilar utan kompression.
- **+** Löser ROTORSAKEN. Steppern blir en riktig stepper (fulla namn, ingen klippning).
  Frigör ~83px höjd tillbaka till panelen. Återanvänder ett befintligt mönster
  (lås-banderollen) - ingen ny UI-idiom.
- **−** Störst ändring. Rör den delade page-shellen över upload/plan/scenes/preview/
  translate, måste samspela med lås-banderollen (två fasta rader) och `100vh`-fullscreen-
  layouten. Kräver eftertanke kring mobilfallet.

### Alt D - slå ihop hamburgare + stepper (ta bort dubbleringen)

Hamburgaren listar redan stegen → släng den separata steppern även på desktop. Behåll
hamburgare med en liten badge (☰ 2/4) + pilar. "Var är jag" bärs av sidans H2-rubrik
(säger redan "Placering") + badgen.

```
[☰ 2/4]                      [←][→]

H2: "Placering"   (sidans egen rubrik)
```

- **Ryms:** Trivialt.
- **+** Minst kod, tar bort dubbleringen helt, minst att gå sönder framåt.
- **−** Går emot "se HELA flödet"-kravet - flödet syns inte utan ett klick. Starkast i
  kombination med Alt A:s progressbar.

---

## 5. Rekommendation (från UX-granskningen)

**Alt C (full-bredd topbar) kombinerat med Alt D:s städning** (ta bort hamburgare/stepper-
dubbleringen när steppern väl har plats).

Motivering: kraven var uttryckligen att se **hela** flödet, veta var man är, och hoppa
mellan steg - precis vad en horisontell stepper med fulla etiketter är bra på, men bara
när den får det utrymme mönstret förutsätter. A och D löser symptomen genom att göra
komponenten mindre ambitiös (text i stället för synlig stepper) - funktionellt korrekta,
men ger avkall på "se hela flödet". B löser bredden men flyttar problemet till höjdled i
en redan trång panel.

C är enda lösningen som låter steppern förbli en RIKTIG stepper - full bredd, fulla
etiketter, ingen kompromiss - för att den äntligen får ett utrymme som räcker. Det är den
strukturellt sunda fixen, och det minst uppfinningsrika (kodbasen har redan en fast
full-bredd-bar-mekanism att luta sig mot). När steppern bor i den breda baren bör
hamburgarens steg-lista trimmas till Huvudmeny + Versionshistorik, annars har man bara
flyttat dubbleringen.

**Avvägning att vara medveten om:** C är störst i omfattning och rör den delade shellen +
lås-banderollen + fullscreen-layouten. A/D är betydligt mindre men ger avkall på
"se hela flödet" i raden.

---

## 6. Grova implementationsanteckningar (för Alt C+D)

- **Struktur:** `_step_nav.html` blir en egen rad OVANFÖR `main.plan-app` i mallarna
  (upload/plan/scenes/preview/translate), inte längre först i `.planner-side`.
- **Höjdreservation:** återanvänd mönstret från lås-banderollen (`--lock-banner-h`-
  variabeln som redan justerar `main.plan-app`) - stapla topbaren ovanpå banderollen (två
  rader när båda syns, en annars), eller lägg den i normalt flöde ovanför `100vh`-layouten
  (enklare, undviker z-index-krock).
- **`.planner-side`:** tappar sin topnav-rad; H2-rubriken blir första elementet → ~83px
  höjd tillbaka till den skrollande panelen.
- **Stepper-CSS:** kan förenklas rejält när bredden inte är knapp (overflow-workarounds,
  scrollbar-döljning, li-padding-nollning blir onödiga). Etiketter kan visas för ALLA
  steg - den riktiga vinsten.
- **Mobil (<768px):** lämna orört (hamburgaren bär stegen, steppern dold).
- **Dubblering:** trimma hamburgar-menyns steg-lista till Huvudmeny + Versionshistorik.
- **"Helskärm"** och ev. framtida knappar hakar in i samma breda rad - gott om plats nu.

---

## 7. Öppna frågor att bestämma

1. **Riktning:** Alt C+D (störst, löser rotorsaken) vs A/D (mindre, avkall på "se hela
   flödet") vs B (vertikal, äter höjd)? Eller en kombination.
2. **Om C:** topbar STAPLAD ovanpå lås-banderollen, eller en KOMBINERAD rad? Och fast
   (`position: fixed`) eller i normalt flöde?
3. **Alternativ ansats:** ska vi i stället göra `.planner-side` bredare (t.ex. 24-26rem)
   så nuvarande mönster ryms? (Enklare, men stjäl bredd från panorama/karta - troligen
   sämre, men värt att nämna.)
