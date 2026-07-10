# Arbetsgång för att skapa en panoramatur

Detta dokument beskriver hela arbetsgången från fotografering till publicerad
tur. Det är dels en referens för utvecklingen, dels underlaget för den
**hur-man-gör-guide som ska byggas in i webbverktyget** (onboarding i
planeringsvyn). Uppdatera detta dokument när flödet ändras.

## Utanför verktyget (fotograf)

1. **Planera** - skapa en karta/ritning över området (t.ex. en kyrkogård eller
   kyrka) och märk ut var varje panorama ska tas. Numrera punkterna.
2. **Fotografera** i nummerordning med 360-kamera, en bild per punkt/scen.
3. **Redigera** - importera bilderna, retuschera i Affinity Photo vid behov
   (t.ex. maska bort fotografen genom att kombinera två exponeringar), exportera
   som equirektangulära JPG.
   - Bilderna namnges efter fotografens nummersystem (1.jpg, 2.jpg, ...).
   - **Gammal begränsning som INTE längre gäller:** tidigare krävdes ~20 MB och
     max 8192 px bredd för att telefoner skulle orka ladda en hel bild per scen.
     Med multires-tiling (se `tools/tile_tour.py`) laddas bara en liten fallback
     först och sedan kakel on-demand, så källupplösningen påverkar knappt
     laddtiden. Fota gärna i högre upplösning för bättre inzoomning. Vi behåller
     bara ett rimligt källtak för tile-genereringens tid/lagring.

## I verktyget

### Planeringssteg (kart-först, innan man går in i scenerna)

4. **Ladda upp** panoramabilderna + kartbilden.
5. **Placera** varje numrerad bild som en punkt på kartan (skriver
   `map.json`-positioner).
6. **Länka** scenerna genom att dra linjer mellan punkterna på kartan
   (dubbelriktat; sparas i `mapSpots.edges`).

### Scensteg (inuti panoramat)

7. **Kalibrera** varje scen: vrid vyn så en granne du ser är centrerad och tryck
   `N`, ange grannens id. Verktyget härleder scenens nordoffset
   (`scene.northOffset`). En kalibrering per scen räcker.

### Generering och export

8. **Auto-generera** alla hotspots ur kartgeometrin (`A`) - riktade mot varandra
   med korrekt `targetYaw`. Se `js/geo.js`. Okalibrerade/olänkade scener
   rapporteras.
9. **Tila** bilderna till multires (`tools/tile_tour.py`).
10. **Exportera** en self-host-bundle (tiles + JSON + viewer + pannellum +
    hosting-instruktioner) som användaren kan lägga på valfri statisk host.

## Designprincip

Placering och länkning är ett **planeringssteg på kartan, skilt från scenvyn**.
Endast kalibreringen sker inuti en scen (den kräver att man vrider panoramat).
Generering och export bygger helt på kartgeometri + en kalibrering per scen.
