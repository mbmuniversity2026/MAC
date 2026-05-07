FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY alembic.ini .
COPY alembic/ alembic/
COPY mac/ mac/
COPY frontend/ frontend/

# Worker node setup files (served via /api/v1/cluster/join/*)
COPY docker-compose.worker.yml .
COPY worker_agent.py .
COPY setup-worker.bat .

# Don't run as root in production
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8000/api/v1 || exit 1

CMD sh -c "alembic upgrade head && uvicorn mac.main:app --host 0.0.0.0 --port 8000 --workers ${MAC_WORKERS:-4}"
