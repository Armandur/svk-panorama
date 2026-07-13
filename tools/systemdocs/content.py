"""Innehåll för systemdocs-sidan: funktionsstegen (skärmdumpar med förklaring)
och den tekniska arkitekturöversikten (statisk text).

OBS: arkitekturtexten UNDERHÅLLS MANUELLT och kan släpa efter koden - till
skillnad från skärmdumparna, som alltid speglar den körande instansen. Uppdatera
den här filen när app-strukturen ändras (som CLAUDE.md)."""
from __future__ import annotations

# Funktionsgenomgång: en post per skärmdump. `path` formatteras med slug.
# `wait_ms` högre för WebGL/canvas-vyer (pannellum/karta) som ritar asynkront.
STEPS: list[dict] = [
    {
        "key": "home", "title": "Huvudmeny", "path": "/", "wait_ms": 1400,
        "caption": "/",
        "desc": "Startsidan listar dina turer med tiling-status per tur (spinner medan "
                "kakel genereras). Härifrån skapar man en ny tur, importerar en "
                "projekt-zip eller hoppar in i ett steg.",
    },
    {
        "key": "upload", "title": "1. Ladda upp bilder & karta", "path": "/projects/{slug}", "wait_ms": 1600,
        "caption": "/projects/&lt;slug&gt;",
        "desc": "Fotografen laddar upp de equirektangulära panoramabilderna och en "
                "översiktskarta. Uppladdningen är asynkron per fil med progress, "
                "för-genererade hover-previews, och startar automatiskt multires-tiling "
                "i bakgrunden. Här sätts även turens språk (bock + drag-ordning).",
    },
    {
        "key": "plan", "title": "2. Placera & länka på kartan", "path": "/projects/{slug}/plan", "wait_ms": 3200,
        "caption": "/projects/&lt;slug&gt;/plan",
        "desc": "Kart-först planeringssteg: dra ut scenerna på kartan och rita länkar "
                "mellan dem (enkel-/dubbelriktade med pilar). Kartan är enda "
                "sanningskällan för geometrin - hotspot-riktningarna härleds sedan ur "
                "kartpositionerna. Zoom/pan med konstant markörstorlek och hover-preview.",
    },
    {
        "key": "scenes", "title": "3. Kalibrera & hotspots", "path": "/projects/{slug}/scenes", "wait_ms": 3500,
        "caption": "/projects/&lt;slug&gt;/scenes",
        "desc": "Inuti varje panorama: kalibrera nordoffset (vrid vyn mot en granne och "
                "klicka), auto-generera länk-hotspots ur kartan, och lägg info-/URL-/"
                "scen-hotspots med markdown-text och bilder ur mediebiblioteket. "
                "Startriktning per scen sätts med sliders direkt i panoramat.",
    },
    {
        "key": "translate", "title": "4. Översätt", "path": "/projects/{slug}/translate", "wait_ms": 2600,
        "caption": "/projects/&lt;slug&gt;/translate (bara vid >1 språk)",
        "desc": "Guidat översättningssteg för flerspråkiga turer: listar luckor (fält med "
                "källtext men saknad översättning), klick riktar kameran mot fältet, och "
                "källtexten visas bredvid ett målspråksfält. N/M-räknare per scen och språk. "
                "Syns bara när turen har fler än ett språk.",
    },
    {
        "key": "preview", "title": "5. Förhandsvisa, ställ in & exportera", "path": "/projects/{slug}/preview", "wait_ms": 3200,
        "caption": "/projects/&lt;slug&gt;/preview",
        "desc": "Hela turen förhandsvisas med kartan. Här sätts globala inställningar "
                "(autorotate, scen-fade, startscen, kartstorlek, tema/typsnitt, "
                "branding-overlay), tema- och branding-mallar appliceras, turen delas "
                "publikt (länk + QR + embed), och den self-host-bara bundlen exporteras.",
    },
    {
        "key": "view", "title": "Publicerad viewer (runtime)", "path": "/projects/{slug}/view", "wait_ms": 3200,
        "caption": "/projects/&lt;slug&gt;/view (och publikt /s/&lt;token&gt;)",
        "desc": "Den färdiga turen: ren pannellum-runtime med klickbart kartöverlägg, "
                "flagg-språkväljare, branding-overlay och djuplänkning (scen/vy i URL:en). "
                "Samma viewer driver den publika delningslänken och den exporterade bundlen.",
    },
    {
        "key": "media", "title": "Mediebibliotek", "path": "/media", "wait_ms": 1400,
        "caption": "/media",
        "desc": "En delad bildpool per ägare, återanvändbar mellan turer. Sök (fritext + "
                "tur-taggar), tumnaglar, kort-/listvy, batch-radering och "
                "användnings-breadcrumbs. Bilderna serveras via oigissbara "
                "capability-URL:er så samma länk funkar i editor, publik vy och bundle.",
    },
    {
        "key": "mallar", "title": "Tema- & branding-mallar", "path": "/mallar", "wait_ms": 1400,
        "caption": "/mallar",
        "desc": "Namngivna tema-förinställningar (typsnitt, färger, autorotate, kartstorlek) "
                "och separata branding-mallar (logotyp/text-overlay). En kan sättas som "
                "standard och ärvs då av nya turer. Samma komponent driver både "
                "hanteringssidan och väljar-modalen på preview-steget.",
    },
    {
        "key": "storage", "title": "Admin: användare & lagring", "path": "/admin/storage", "wait_ms": 1400,
        "caption": "/admin/storage",
        "desc": "Super-admin-vy: diskanvändning per användare med drill-down per tur och "
                "mediepool, plus ospårade mappar. Sluten inbjudan, användarhantering "
                "(spärra/promota/batch) och tjänsteinställningar ligger under /admin.",
    },
]


# Teknisk arkitektur: statisk text (HTML tillåtet i body). Underhålls manuellt.
ARCH: list[dict] = [
    {
        "title": "Stack",
        "body": "<ul>"
                "<li><b>Backend:</b> Python 3.12 + FastAPI (uvicorn), SQLAlchemy 2 + SQLite, Jinja2.</li>"
                "<li><b>Frontend:</b> vanilla JS + HTML + CSS, <b>ingen bundler</b> (filer via <code>&lt;script&gt;</code>). Pico CSS + egen <code>tokens.css</code>.</li>"
                "<li><b>Panorama:</b> Pannellum, vendorad (aldrig CDN). Multires-tiling via pannellums <code>generate.py</code> i en Docker-image.</li>"
                "<li><b>Drift:</b> monolitisk single-container (Docker) på Unraid. Ingen objektlagring, ingen jobbkö - allt ryms i en instans.</li>"
                "</ul>",
    },
    {
        "title": "app/-struktur",
        "body": "<p>All aktiv kod ligger under <code>app/</code>. En route-fil per domän, en "
                "service per externt/tungt ansvar:</p>"
                "<ul>"
                "<li><code>main.py</code> (app, lifespan, mounts, routers), <code>config.py</code>, "
                "<code>database.py</code> (modeller + <code>init_db</code>), <code>deps.py</code> (get_db, CSRF, ägar-gate).</li>"
                "<li><code>routes/</code>: projects, uploads, plan, scenes, translate, preview, export, backup, media, presets, viewer, public, admin ...</li>"
                "<li><code>services/</code>: project_files (filsystemslager), tiling, bundle, backup, media, presets, storage, i18n.</li>"
                "<li><code>templates/</code> (Jinja2) + <code>static/</code> (JS/CSS + vendored pannellum/pico).</li>"
                "</ul>"
                "<p>De ~13 gamla produktionsturerna (<code>js/</code>, <code>css/</code>, <code>&lt;xx&gt;/*.html</code>) "
                "är legacy och separata från editorn.</p>",
    },
    {
        "title": "Datamodell & sanningskälla",
        "body": "<p>Två filer per projekt (under gitignorade <code>projects/&lt;slug&gt;/</code>):</p>"
                "<ul>"
                "<li><b><code>tour.json</code></b> - ren <b>equirektangulär</b> sanningskälla: scener, hotspots och "
                "ett <code>default</code>-block (autoRotate, fade, firstScene, mapSize, tema, branding, languages). "
                "Samma format som Pannellum konsumerar.</li>"
                "<li><b><code>map.json</code></b> - scenernas kartpositioner (i procent av kartbildens naturliga "
                "storlek → upplösningsoberoende) + länkar (edges).</li>"
                "</ul>"
                "<p><b>Multires läggs på FÖRST vid visning/export</b> (<code>apply_multires()</code> mergar in "
                "tiles-manifestet) - så hotspot-ändringar aldrig kräver om-tiling.</p>",
    },
    {
        "title": "Bakgrundsjobb (tiling & export)",
        "body": "<p>Både multires-tiling och bundle-export kör i daemon-trådar med en in-memory statusdict "
                "per slug, pollad av status-endpoints. Tiling shell:ar ut mot en Docker-image; progress härleds "
                "ur <b>skrivna filer</b> (räknar kubfaces + tile-jpg mot förväntat antal), inte ur en fork av "
                "generate.py. Skrivningar till tour.json/manifest är atomiska och låsta.</p>",
    },
    {
        "title": "Bundle-export (self-host-produkten)",
        "body": "<p>Exporten bygger en <b>självbärande zip</b>: <code>index.html</code> + vendored pannellum + "
                "viewer.js/css + tiles + karta + refererade poolbilder + README. <b>Alla sökvägar relativiseras</b> "
                "så bundlen fungerar i valfri underkatalog utan server-kod - rena statiska filer. Spökspråk "
                "(borttagna språk) prunas ur bundlen så bara aktivt innehåll skeppas.</p>",
    },
    {
        "title": "Auth & multi-tenancy",
        "body": "<p>Sluten inbjudan (ingen öppen registrering): bcrypt-login, signerad session-cookie, "
                "<code>User</code> + <code>owner_id</code> på projekt, ägar-gate i <code>get_project_or_404</code> "
                "(admin släpps igenom). Turer kan delas oautentiserat via en oigissbar "
                "<code>/s/&lt;token&gt;</code>-länk (samma viewer, läs-only assets). Nästa fas: team-ägarskap och "
                "egna domäner.</p>",
    },
    {
        "title": "Flerspråkighet (i18n)",
        "body": "<p><b>Datamodell: inline locale-map, additiv union.</b> Ett textfält är antingen en ren sträng "
                "(monospråkigt/default) eller <code>{kod: text}</code> (t.ex. <code>{sv, en, de}</code>). Turens "
                "språk ligger i <code>default.languages</code> (först = default). En delad resolver väljer rätt "
                "språk med fallback; runtime-viewern har en flagg-språkväljare som bygger om pannellum, och "
                "editorn har ett eget guidat översättningssteg. Additivt → monospråkiga turer förblir rena "
                "strängar (ingen migration).</p>",
    },
]
