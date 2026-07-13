# systemdocs - systemöversikt/presentation ur en körande instans

Genererar EN self-contained HTML-sida (`tmp/systemdocs.html`, gitignorad) som
dokumenterar svk-panorama visuellt:

- **Del 1 - Funktionsgenomgång:** riktiga skärmdumpar av editor-flödet (huvudmeny
  → ladda upp → placera → kalibrera → översätt → förhandsvisa → viewer) plus
  mediebibliotek, mallar och admin. Fångas ur en **körande instans** via Playwright.
- **Del 2 - Teknisk arkitektur:** stack, app/-struktur, datamodell, bakgrundsjobb,
  bundle-export, auth, i18n. **Statisk text som underhålls manuellt.**

Sidan dubblar som kollega-presentation. Bilderna är base64-bäddade → en enda
portabel fil som kan levereras via `svc share`.

## Köra

Generatorn använder Playwright, som bor i **shot-venv** (inte appens `.venv`):

```
~/.local/share/shot-venv/bin/python tools/systemdocs/generate.py
```

Flaggor:

- `--slug S` - demotur att fånga (default `harnosands-domkyrka`, flerspråkig sv/en/de).
- `--base URL` - instansens bas-URL (default `http://ubuntu-ai:8005`).
- `--no-restart` - hoppa steg 0 (se nedan) om instansen redan kör aktuell kod.

Leverera sedan sidan:

```
svc share tmp/systemdocs.html --desc "svk-panorama systemöversikt"
```

## Steg 0: färskhet (viktigt)

Python laddas inte om utan omstart, så en redan körande instans visar ofta
**gammalt UI** i skärmdumparna. Därför startar generatorn som standard om
svk-panorama på porten mot aktuell kod innan capture (dödar bara processen vars
cmdline matchar `app.main:app` - aldrig fel process), och pollar `/login` tills
den svarar. Kör med `--no-restart` om du precis startat om själv.

## Filer

- `capture.py` - Playwright-drivning (login + `Session.capture(path)`). Stdlib +
  playwright bara, inga app-importer, ingen Jinja2 (shot-venv saknar dem).
- `content.py` - stegens texter + arkitektursektionerna. **Uppdatera denna när
  app-strukturen ändras** (som CLAUDE.md) - arkitekturtexten auto-uppdateras inte.
- `generate.py` - orkestrerar: färskhets-restart → capture alla steg → bygg HTML.

## Demotur

Skärmdumparna fångas mot en riktig tur (`harnosands-domkyrka`). Dess synliga
text är curerad till rena, illustrativa värden så presentationen inte visar
testskräp - kör mot en annan `--slug` om du vill visa upp en skarp tur.

## När köra

Efter större ändringar (nytt steg, omdesignad vy). Skärmdumparna speglar då den
nya koden automatiskt; glöm inte att uppdatera `content.py` om texten behöver följa med.
