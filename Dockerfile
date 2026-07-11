# svk-panorama - monolitisk single-container (FastAPI + uvicorn).
# Tiling shell:ar ut till `docker run pannellum-multires` -> imagen innehåller
# docker-KLIENTEN (inte daemonen); montera värdens docker.sock vid drift.
FROM python:3.12-slim

# Docker-klient (statisk binär) för tiling via värdens daemon. Inget bygg-lager
# kvar efteråt -> liten image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.3.1.tgz \
    | tar -xz -C /usr/local/bin --strip-components=1 docker/docker \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bara det appen behöver (js/ återanvänds av editorn; WORKFLOW.md visas i guiden).
COPY app ./app
COPY js ./js
COPY tools ./tools
COPY WORKFLOW.md ./

# Persistent data (projekt + db) läggs på en volym under /data som default.
# För tiling via docker.sock måste denna path vara IDENTISK på värd och container
# (se DOCKER.md) - override:a SVK_PROJECTS_DIR/SVK_DB_FILE då.
ENV SVK_HOST=0.0.0.0 \
    SVK_PORT=8000 \
    SVK_PROJECTS_DIR=/data/projects \
    SVK_DB_FILE=/data/svk.db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
