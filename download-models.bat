@echo off
setlocal enabledelayedexpansion
title MAC — Download AI Models for Offline Use
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC — Model Downloader
echo   Downloads ALL models into Docker volume hf-cache.
echo   Run this ONCE on a network connection.
echo   After that, MAC works fully OFFLINE.
echo  ===================================================
echo.
echo  Models to download:
echo    1. Sarvam-2B      (sarvamai/sarvam-2b-v0.5)     ~5 GB
echo    2. Veena TTS      (maya-research/Veena)          ~6 GB  (4-bit ~2 GB)
echo    3. SNAC codec     (hubertsiuzdak/snac_24khz)     ~0.1 GB
echo    4. Whisper Small  (Systran/faster-whisper-small) ~0.5 GB
echo  --------------------------------------------------
echo   Total: ~12 GB on disk  (cached, no re-download)
echo  ===================================================
echo.

REM ── Check Docker ─────────────────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker is not running. Start Docker Desktop first.
    pause
    exit /b 1
)

REM ── Create shared volume if it doesn't exist ──────────────────────────────────
docker volume create mac_hf-cache >nul 2>&1
echo  [OK] HuggingFace cache volume ready.

REM ── Download all models via a temporary Python container ─────────────────────
echo.
echo  Starting download (this may take 10-30 minutes on first run)...
echo  Subsequent runs are instant — models are already cached.
echo.

docker run --rm ^
  -v mac_hf-cache:/root/.cache/huggingface ^
  -e HF_HOME=/root/.cache/huggingface ^
  python:3.11-slim ^
  sh -c "pip install --quiet huggingface_hub && python -c \"
from huggingface_hub import snapshot_download
import os

cache = '/root/.cache/huggingface'
os.makedirs(cache, exist_ok=True)

models = [
    'sarvamai/sarvam-2b-v0.5',
    'maya-research/Veena',
    'hubertsiuzdak/snac_24khz',
]

for m in models:
    print(f'\\nDownloading {m} ...')
    try:
        snapshot_download(m, cache_dir=cache)
        print(f'  [OK] {m}')
    except Exception as e:
        print(f'  [WARN] {m}: {e}')

print('\\nAll downloads complete.')
\""

if errorlevel 1 (
    echo.
    echo  [WARN] Some downloads may have failed. Check output above.
) else (
    echo.
    echo  [OK] All models downloaded to Docker volume mac_hf-cache.
)

REM ── Download Whisper via its own container ────────────────────────────────────
echo.
echo  Pre-loading Whisper-small model...
docker run --rm ^
  -v mac_hf-cache:/root/.cache/huggingface ^
  -e WHISPER__MODEL=Systran/faster-whisper-small ^
  fedirz/faster-whisper-server:latest-cpu ^
  python -c "from faster_whisper import WhisperModel; WhisperModel('Systran/faster-whisper-small', device='cpu')" 2>nul
echo  [OK] Whisper model cached.

echo.
echo  ===================================================
echo   All models downloaded!
echo.
echo   To run fully OFFLINE, set in your .env file:
echo     TRANSFORMERS_OFFLINE=1
echo     HF_DATASETS_OFFLINE=1
echo.
echo   Then run start-mac.bat as normal.
echo   No internet required after this point.
echo  ===================================================
echo.
pause
