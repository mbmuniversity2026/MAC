# ── Veena TTS Docker Image ───────────────────────────────────────────────────
# Builds a lightweight FastAPI server wrapping maya-research/Veena.
# GPU (CUDA 12.1) preferred; falls back to CPU automatically.
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

WORKDIR /app

# System deps: libsndfile for soundfile, gcc for bitsandbytes build
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    gcc g++ \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# PyTorch 2.5.1 + CUDA 12.4 — latest stable, satisfies transformers >= 2.4 requirement
# Works on RTX 3060 (Ampere) and later; falls back to CPU if no GPU.
RUN pip install --no-cache-dir \
    torch==2.5.1 \
    torchaudio==2.5.1 \
    --index-url https://download.pytorch.org/whl/cu124

# Veena inference stack
RUN pip install --no-cache-dir \
    transformers>=4.43.0 \
    accelerate>=0.30.0 \
    bitsandbytes>=0.43.1 \
    snac \
    soundfile \
    fastapi>=0.111.0 \
    uvicorn[standard]>=0.30.0 \
    pydantic>=2.0 \
    huggingface_hub>=0.23.0

COPY server.py .

# HuggingFace cache inside a Docker volume so weights survive container restarts
ENV HF_HOME=/root/.cache/huggingface
ENV VEENA_MODEL=maya-research/Veena
ENV VEENA_DEVICE=auto

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-keep-alive", "120"]
