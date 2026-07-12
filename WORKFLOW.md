# Så gör du en virtuell rundtur

En rundtur består av flera 360-panorama (en per plats) som besökaren kan gå
mellan, med en karta som visar var man är. Så här går det till, från fotografering
till publicerad tur.

## Innan du börjar i verktyget

1. **Planera platserna.** Utgå från en karta eller ritning över kyrkan/kyrkogården
   och märk ut var varje panorama ska tas. Numrera punkterna i den ordning du
   tänker gå.
2. **Fotografera** i nummerordning med en 360-kamera - ett foto per punkt.
3. **Redigera** bilderna i din bildredigerare (t.ex. Affinity Photo) om du vill -
   till exempel maska bort dig själv. Exportera som vanliga 360-bilder (JPG) och
   döp dem efter numren: `1.jpg`, `2.jpg`, `3.jpg` ...
   - Fota gärna i hög upplösning för snygg inzoomning. Verktyget bygger automatiskt
     smarta "kakel" så att stora bilder ändå laddar snabbt för besökaren.

## I verktyget, steg för steg

### 1. Skapa projekt och ladda upp

Skapa ett nytt projekt på startsidan. Ladda upp dina panoramabilder och en bild
på kartan. Uppladdningen visar en tydlig progress per bild, och så fort bilderna
är uppe börjar verktyget **automatiskt** förbereda dem i bakgrunden - du behöver
inte göra något, du ser bara en status som går mot klart.

Har du redan ett projekt från en annan dator kan du i stället **importera** en
projekt-zip på startsidan.

### 2. Placera och länka på kartan

Öppna planeringssteget. Här jobbar du helt på kartan:

- **Placera** varje numrerad bild som en punkt där den togs.
- **Länka** ihop scener genom att dra en linje mellan två punkter - det talar om
  att besökaren kan gå mellan dem. Dra åt båda hållen för en tvåvägslänk.

Verktyget säger till om någon scen ännu inte är placerad eller länkad.

### 3. Kalibrera och lägg till hotspots

Gå in i scenvyn. För varje scen:

- **Kalibrera riktningen:** vrid panoramat tills en granne du ser är centrerad i
  hårkorset och klicka på den grannen. Då vet verktyget åt vilket håll scenen
  "pekar" så att länkarna hamnar rätt. En kalibrering per scen räcker.
- **Auto-skapa länk-hotspots:** en knapp skapar automatiskt klickbara pilar mellan
  länkade scener, riktade åt rätt håll.
- **Lägg till egna hotspots** där du vill: infopunkter med text och bild, länkar
  till en webbsida, eller en extra scen-övergång. Texten skrivs i en enkel
  redigerare med rubriker, fetstil, länkar och bilder (bilderna hämtar du ur
  **mediebiblioteket**, som är gemensamt för alla dina turer). En infopunkt kan ha
  både en kort teaser och ett längre "Läs mer"-innehåll.
- **Sätt startriktningen** för scenen - åt vilket håll besökaren tittar när hen
  kommer dit via kartan. Vrid vyn (eller använd sliderna) och tryck "Sätt till
  nuvarande vy".

### 4. Förhandsgranska och ställ in

På förhandsvisningssteget ser du hela turen som besökaren kommer att uppleva den,
och ställer in helheten:

- **Autorotation** (på/av, hastighet, riktning), övergångar och vilken scen turen
  börjar på.
- **Tema:** typsnitt och färger på kartprickarna - din identitet.
- **Kartstorlek.**
- **Förinställningar:** spara tema + inställningar som en namngiven förinställning
  och återanvänd den på andra turer. Markera en som standard, så ärver alla nya
  projekt den automatiskt.

### 5. Publicera

- **Exportera en bundle:** en självbärande zip med hela turen som du lägger på
  valfri webbserver - inga specialkrav, det är rena statiska filer.
- **Dela en länk:** skapa en oigissbar delningslänk som visar turen utan
  inloggning, bra för att skicka en förhandsvisning. Sluta dela när du vill.
- **Säkerhetskopiera:** ladda ner en redigerbar projekt-zip (allt råmaterial) för
  backup eller för att flytta turen till en annan dator/instans.

## Bra att veta

- **Kartan är utgångspunkten.** Placering och länkning görs på kartan, skilt från
  scenerna. Inuti en scen gör du bara det som kräver att man vrider panoramat -
  kalibrering, hotspots och startriktning. Resten (länkar, riktningar) räknas ut
  automatiskt ur kartan.
- **Du kan gå fram och tillbaka** mellan stegen när som helst; inget är hugget i
  sten förrän du publicerar.
