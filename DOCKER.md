# Deployment (Docker / Unraid)

Monolitisk single-container (FastAPI + uvicorn). Bygg-image publiceras av GitHub
Actions till `ghcr.io/armandur/svk-panorama` (`:latest`, SHA, branch, semver).

## På Unraid: Add Container (inte compose)

Skapa en container från imagen med följande. Compose-filen i repot är **bara för
lokal dev/test**.

### Port-mappningar (container -> host)

| Container | Host  | Not                          |
|-----------|-------|------------------------------|
| 8000      | valfri (t.ex. 8802) | appens webb-port |

### Path-mappningar

| Container path                      | Host path                              | Läge | Not |
|-------------------------------------|----------------------------------------|------|-----|
| `/data`                             | `/mnt/user/appdata/svk-panorama`       | rw   | projekt (bilder/tiles/tour.json) + `svk.db` |
| `/var/run/docker.sock`              | `/var/run/docker.sock`                 | rw   | krävs för tiling (se nedan) |

### Env-variabler

| Variabel               | Rekommenderat värde                         | Not |
|------------------------|---------------------------------------------|-----|
| `SVK_SECRET_KEY`       | lång slumpsträng                            | signerar CSRF- + session-cookies; fast värde annars invalideras inloggningar vid omstart |
| `SVK_ADMIN_EMAIL`      | din e-post                                  | bootstrap-admin (skapas vid första start om inga användare finns) |
| `SVK_ADMIN_PASSWORD`   | starkt lösenord                             | krävs för att kunna logga in första gången |
| `SVK_PROJECTS_DIR`     | `/mnt/user/appdata/svk-panorama/projects`   | se "Tiling" - måste matcha host-path |
| `SVK_DB_FILE`          | `/mnt/user/appdata/svk-panorama/svk.db`     | absolut path |
| `SVK_TILE_CONCURRENCY` | `2`                                         | nona är enkeltrådat; håll lågt på delad värd |
| `SVK_BASE_URL`         | (tom)                                       | för framtida export/delningslänkar |

## Tiling kräver docker-socket OCH matchande data-path

Tiling kör pannellums `generate.py` genom att shell:a ut `docker run
pannellum-multires ...` mot **värdens** docker-daemon (via den monterade socketen).
Två saker måste stämma:

1. **`pannellum-multires`-imagen måste finnas på värden.** Bygg den en gång från
   pannellums `utils/multires/Dockerfile`:
   ```
   docker build -t pannellum-multires <pannellum>/utils/multires/
   ```
2. **Data-pathen måste vara IDENTISK i container och på värd.** Tilings
   `docker run -v <path>:/in` skickar en path som **värdens** daemon tolkar. Om
   containern använder `/data/...` men värden har den på `/mnt/user/appdata/...`
   hittar daemonen inget. Lös det genom att mappa host-pathen till SAMMA path i
   containern och peka `SVK_PROJECTS_DIR`/`SVK_DB_FILE` dit:

   | Container path                            | Host path                                 |
   |-------------------------------------------|-------------------------------------------|
   | `/mnt/user/appdata/svk-panorama`          | `/mnt/user/appdata/svk-panorama`          |

   och `SVK_PROJECTS_DIR=/mnt/user/appdata/svk-panorama/projects`,
   `SVK_DB_FILE=/mnt/user/appdata/svk-panorama/svk.db`.

**Graceful degradation:** utan socket/matchande path fungerar allt UTOM tiling -
tiling-jobb felar (icke-blockerande) och turerna serveras equirektangulärt.
Uppladdning, planering, förhandsvisning och bundle-export fungerar ändå (bundlen
tar då med originalbilderna i stället för tiles).

**uid/gid:** tiling kör `docker run --user <uid>:<gid>` med app-processens
uid/gid. Kör containern som en användare som äger data-volymen (Unraid PUID/PGID)
så tile-filerna får rätt ägare.

## Lokalt (dev/test)

```
cp .env.example .env      # sätt SVK_SECRET_KEY
docker compose up --build
```
Öppna http://localhost:8002/. Tiling lokalt kräver samma matchande-path-setup som
ovan (annars fungerar allt utom tiling).

Utan Docker: `SVK_PORT=8002 .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8002`.
