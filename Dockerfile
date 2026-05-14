FROM python:3.11-slim

LABEL org.opencontainers.image.source=https://github.com/mbmuniversity2026/iMaC
LABEL org.opencontainers.image.description="MAC — MBM AI Cloud · Self-hosted AI for MBM University, Jodhpur"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.authors="mbmuniversity2026 <mbmuniversity2026@gmail.com>"

WORKDIR /app

# System deps (no docker.io — replaced by static binary below)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc g++ \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI static binary — MBM Book spawns per-user containers via docker socket
RUN curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-26.1.4.tgz" \
    | tar xz --strip-components=1 -C /usr/local/bin docker/docker \
    && docker --version

# Install Python deps (insightface builds from source — longer timeout)
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 -r requirements.txt

# Pre-bake insightface buffalo_sc model (~80 MB) into /opt so no Docker volume can shadow it.
# /opt is not mounted by docker-compose.yml → model always available offline after build.
RUN mkdir -p /opt/insightface_models && \
    ( python -c "\
import os; \
from insightface.app import FaceAnalysis; \
app = FaceAnalysis(name='buffalo_sc', root='/opt/insightface_models', providers=['CPUExecutionProvider']); \
app.prepare(ctx_id=0, det_size=(320,320)); \
print('insightface buffalo_sc ready')" \
      || echo "[WARN] insightface model download failed — attendance will retry on first internet connection" \
    ) && \
    chmod -R a+rX /opt/insightface_models

# Copy application code
COPY alembic.ini .
COPY alembic/ alembic/
COPY mac/ mac/
COPY frontend/ frontend/

# Worker node setup files (served via /api/v1/cluster/join/*)
COPY docker-compose.worker.yml .
COPY worker_agent.py .
COPY setup-worker.bat .

RUN useradd -m appuser && chown -R appuser:appuser /app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8000/api/v1 || exit 1

# Run as root so mac-api can access /var/run/docker.sock to spawn MBM Book containers.
# This is acceptable for a self-hosted LAN-only deployment.
CMD ["sh", "-c", "chmod 666 /var/run/docker.sock 2>/dev/null || true && alembic upgrade head && uvicorn mac.main:app --host 0.0.0.0 --port 8000 --workers ${MAC_WORKERS:-4}"]
