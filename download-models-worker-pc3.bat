@echo off
setlocal enabledelayedexpansion
title MAC Worker PC3 — Download Vision Model
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC Worker PC3 — Model Downloader
echo   Downloads vision model into Docker volume hf-cache.
echo   Run this ONCE on PC3 with internet, then go offline.
echo  ===================================================
echo.
echo  Choose vision model:
echo    1. Qwen2-VL-7B-Instruct (Qwen)          ~16 GB [RECOMMENDED — best vision]
echo    2. Qwen2-VL-2B-Instruct (Qwen)           ~4 GB  [lighter, less accurate]
echo    3. LLaVA-1.6-Mistral-7B-hf               ~15 GB [alternative]
echo    4. MiniCPM-V-2_6 (OpenBMB)               ~8 GB  [fast + accurate]
echo.
set /p CHOICE="  Enter 1-4 [default: 1]: "
if "!CHOICE!"=="" set CHOICE=1
if "!CHOICE!"=="1" set MODEL=Qwen/Qwen2-VL-7B-Instruct
if "!CHOICE!"=="2" set MODEL=Qwen/Qwen2-VL-2B-Instruct
if "!CHOICE!"=="3" set MODEL=llava-hf/llava-v1.6-mistral-7b-hf
if "!CHOICE!"=="4" set MODEL=openbmb/MiniCPM-V-2_6
if "!MODEL!"=="" set MODEL=Qwen/Qwen2-VL-7B-Instruct

echo.
echo  Downloading !MODEL! ...
echo  This may take 20-60 minutes on first run.
echo.

docker info >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker is not running. Start Docker Desktop first.
    pause
    exit /b 1
)

docker volume create mac_hf-cache >nul 2>&1

docker run --rm ^
  -v mac_hf-cache:/root/.cache/huggingface ^
  -e HF_HOME=/root/.cache/huggingface ^
  -e HF_TOKEN=%HF_TOKEN% ^
  python:3.11-slim ^
  sh -c "pip install --quiet huggingface_hub && python -c \"\
from huggingface_hub import snapshot_download
print('Downloading !MODEL! ...')
try:
    snapshot_download('!MODEL!', cache_dir='/root/.cache/huggingface')
    print('[OK] !MODEL! cached')
except Exception as e:
    print(f'[ERROR] {e}')
\""

if errorlevel 1 (
    echo  [WARN] Download may have failed. Re-run to retry.
) else (
    echo  [OK] Model downloaded successfully.
)

REM ── Write TRANSFORMERS_OFFLINE=1 to .env ─────────────────────────────────────
if not exist .env (
    if exist .env.example copy .env.example .env >nul
)

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
  "$lines | Set-Content $path -Encoding UTF8" 2>nul

echo  [OK] Offline mode set in .env

echo.
echo  ===================================================
echo   Download complete!
echo   Run start-worker-pc3-vision.bat to launch.
echo  ===================================================
echo.
pause
