# svk-panorama

Virtuella 360-turer av kyrkor och kyrkogårdar med [Pannellum](https://github.com/mpetroff/pannellum).
En **editor** (FastAPI-app) för att bygga turer och exportera dem som en
**självbärande statisk bundle** att lägga på valfri webbserver. Self-host-först;
SaaS är en senare fas.

## Vad den gör

Arbetsflöde i editorn: ladda upp panoraman + karta -> placera och länka scener på
kartan -> kalibrera riktning + lägg hotspots per scen -> sätt turinställningar och
tema + förhandsgranska -> exportera bundle. Panoraman görs om till multires-kakel
för snabb laddning (tiling som bakgrundsjobb).

## Köra lokalt

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
SVK_PORT=8002 .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8002
```

Öppna http://localhost:8002/. Tiling kräver Docker + imagen `pannellum-multires`
(se DOCKER.md); utan den fungerar allt utom tiling.

Tester: `.venv/bin/python tests/backend_test.py` och `node tools/geo.test.js`.

## Konton och inloggning

Sluten inbjudan (ingen öppen registrering), multi-tenant: varje användare ser
sina egna turer. Vid första start seedas en admin ur env (`SVK_ADMIN_EMAIL` /
`SVK_ADMIN_PASSWORD`, default **admin/admin** - byt före produktion). Admin
hanterar användare under **Admin -> Användare** (`/admin/users`): skapa konton och
dela inbjudningslänken (den inbjudne sätter själv sitt lösenord), öppna en
användares detaljsida för att ändra namn/lösenord/profilbild på deras vägnar,
spärra/aktivera konton, promota/degradera admin, samt batch-åtgärder på flera
användare. Egna uppgifter ändras under **Inställningar** (`/profile`).

Pre-produktion körs utan migrationer: vid schemaändring, radera `svk.db` och
starta om (schemat byggs om och admin seedas; projektmappar på disk adopteras av
admin). Alembic återinförs vid produktionssättning.

## Deployment

Docker single-container, publiceras av GitHub Actions till
`ghcr.io/armandur/svk-panorama`. Se **[DOCKER.md](DOCKER.md)** för Unraid-setup
(env-variabler, port-/path-mappningar och tiling via docker-socket).

## Demo-team

Ett team folk kan testa editorn i utan att röra riktig data. Administreras på
**Admin -> Demo** (`/admin/demo`):

1. Klicka **Skapa / återställ demo-team** - skapar teamet `demo` + testkontona
   (`demo`/`demo`, `demo2`/`demo`, medlemmar utan åtkomst till annan data).
2. Logga in som ett demo-konto och bygg de demo-turer du vill visa.
3. Klicka **Lås nuvarande innehåll** - sparar utgångsläget som en gitignorad
   guld-seed (`SVK_DEMO_SEED_DIR`, default `demo_seed/`).
4. **Reset** återställer teamet till det låsta läget (rensar allt testare skapat).
   Manuellt via knappen, eller schemalagt nattligt.

**Nattlig reset** via en token-autentiserad intern endpoint (in-process, så den
rensar jobbstatus/cache korrekt). Sätt `SVK_DEMO_RESET_TOKEN` och schemalägg en
timer som curlar den, t.ex. en systemd user-timer:

```ini
# ~/.config/systemd/user/svk-demo-reset.service
[Service]
Type=oneshot
ExecStart=/usr/bin/curl -fsS -X POST -H "X-Demo-Token: DIN_TOKEN" http://ubuntu-ai:8005/internal/demo-reset

# ~/.config/systemd/user/svk-demo-reset.timer
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

`systemctl --user enable --now svk-demo-reset.timer`. Är `SVK_DEMO_RESET_TOKEN`
tom är den interna endpointen avstängd (bara manuell reset).

## Dokumentation

- **[CLAUDE.md](CLAUDE.md)** - kodbasbeskrivning (stack, struktur, designbeslut).
- **[ROADMAP.md](ROADMAP.md)** - faser och status.
- **[WORKFLOW.md](WORKFLOW.md)** - fotografens arbetsgång.
- **[DOCKER.md](DOCKER.md)** - deployment.
- **[CODE-REVIEWS.md](CODE-REVIEWS.md)** - granskningar.
