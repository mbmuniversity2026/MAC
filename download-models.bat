@echo off
setlocal enabledelayedexpansion
title MAC — Download AI Models for Offline Use
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC — Model Downloader  (Host PC1)
echo   Downloads ALL models into Docker volumes.
echo   Run this ONCE on a network connection.
echo   After that, MAC works fully OFFLINE.
echo  ===================================================
echo.
echo  Models to download:
echo    1. Qwen2.5-7B-AWQ  (main chat LLM)             ~5 GB
echo    2. Veena TTS        (maya-research/Veena)        ~6 GB  [4-bit ~2 GB]
echo    3. SNAC codec       (hubertsiuzdak/snac_24khz)   ~0.1 GB
echo    4. Whisper Small    (Systran/faster-whisper-small) ~0.5 GB
echo  --------------------------------------------------
echo   Total: ~12 GB on disk  (cached, no re-download)
echo  ===================================================
echo.
echo  NOTE: Worker PC2 and PC3 have their own download scripts:
echo    download-models-worker-pc2.bat  (Mistral-7B-AWQ)
echo    download-models-worker-pc3.bat  (Qwen2-VL-7B)
echo.

REM ── Check Docker ─────────────────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker is not running. Start Docker Desktop first.
    pause
    exit /b 1
)

REM ── Create shared volumes ─────────────────────────────────────────────────────
docker volume create mac_hf-cache >nul 2>&1
echo  [OK] HuggingFace cache volume ready.

REM ── Download HF models via a temporary Python container ──────────────────────
echo.
echo  Step 1/3 — Downloading HuggingFace models (this may take 20-60 min)...
echo  Subsequent runs are instant — models are already cached.
echo.

docker run --rm ^
  -v mac_hf-cache:/root/.cache/huggingface ^
  -e HF_HOME=/root/.cache/huggingface ^
  -e HF_TOKEN=%HF_TOKEN% ^
  python:3.11-slim ^
  sh -c "pip install --quiet huggingface_hub && python -c \"\
from huggingface_hub import snapshot_download
import os

cache = '/root/.cache/huggingface'
os.makedirs(cache, exist_ok=True)

models = [
    ('Qwen/Qwen2.5-7B-Instruct-AWQ',         'main LLM — ~5 GB'),
    ('maya-research/Veena',                    'TTS voice — ~6 GB'),
    ('hubertsiuzdak/snac_24khz',              'TTS codec — ~100 MB'),
]

for repo_id, label in models:
    print(f'Downloading {repo_id} ({label}) ...')
    try:
        snapshot_download(repo_id, cache_dir=cache)
        print(f'  [OK] {repo_id}')
    except Exception as e:
        print(f'  [WARN] {repo_id}: {e}')

print('HF downloads complete.')
\""

if errorlevel 1 (
    echo.
    echo  [WARN] Some HF downloads may have failed. Check output above.
    echo  You can re-run this script to retry — already-cached models are skipped.
) else (
    echo  [OK] HuggingFace models cached.
)

REM ── Pre-load Whisper model via its own container ──────────────────────────────
echo.
echo  Step 2/3 — Pre-loading Whisper-small STT model (~500 MB)...
docker run --rm ^
  -v mac_hf-cache:/root/.cache/huggingface ^
  -e WHISPER__MODEL=Systran/faster-whisper-small ^
  fedirz/faster-whisper-server:latest-cpu ^
  python -c "from faster_whisper import WhisperModel; WhisperModel('Systran/faster-whisper-small', device='cpu'); print('[OK] Whisper cached')" 2>nul
if errorlevel 1 (
    echo  [WARN] Whisper pre-load failed. It will download on first use.
) else (
    echo  [OK] Whisper model cached.
)

REM ── Write TRANSFORMERS_OFFLINE=1 to .env ─────────────────────────────────────
echo.
echo  Step 3/3 — Enabling offline mode in .env ...

if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo  [INFO] Created .env from .env.example
    ) else (
        echo. > .env
    )
)

REM Use PowerShell to update or insert TRANSFORMERS_OFFLINE and HF_DATASETS_OFFLINE
powershell -NoProfile -Command ^
  "$path = '.env';" ^
  "$lines = Get-Content $path -ErrorAction SilentlyContinue;" ^
  "if ($lines -eq $null) { $lines = @() };" ^
  "$to = $false; $hd = $false;" ^
  "$lines = $lines | ForEach-Object {" ^
  "  if ($_ -match '^TRANSFORMERS_OFFLINE') { $to = $true; 'TRANSFORMERS_OFFLINE=1' }" ^
  "  elseif ($_ -match '^HF_DATASETS_OFFLINE') { $hd = $true; 'HF_DATASETS_OFFLINE=1' }" ^
  "  else { $_ }" ^
  "};" ^
  "if (-not $to) { $lines += 'TRANSFORMERS_OFFLINE=1' };" ^
  "if (-not $hd) { $lines += 'HF_DATASETS_OFFLINE=1' };" ^
  "$lines | Set-Content $path -Encoding UTF8"

if errorlevel 1 (
    echo  [WARN] Could not write to .env automatically.
    echo  Please add these lines to your .env file manually:
    echo    TRANSFORMERS_OFFLINE=1
    echo    HF_DATASETS_OFFLINE=1
) else (
    echo  [OK] .env updated: TRANSFORMERS_OFFLINE=1, HF_DATASETS_OFFLINE=1
)

echo.
echo  ===================================================
echo   All models downloaded!
echo.
echo   Your .env now has TRANSFORMERS_OFFLINE=1 set.
echo   MAC will start without any internet access.
echo.
echo   To re-enable online mode (for model updates):
echo     go-online.bat
echo.
echo   To return to offline mode:
echo     go-offline.bat
echo  ===================================================
echo.
pause
