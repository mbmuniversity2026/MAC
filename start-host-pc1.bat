@echo off
setlocal enabledelayedexpansion
title MAC — PC1 HOST (Qwen2.5-7B + All Services)
cd /d "%~dp0"

echo.
echo  ================================================================
echo   MAC — MBM AI Cloud
echo   PC1: HOST NODE
echo   Services: API + DB + Redis + Qdrant + SearXNG + Nginx
echo             Whisper STT + Veena TTS + Qwen2.5-7B-AWQ (vLLM)
echo   Workers: PC2 (Mistral-7B) + PC3 (Vision Model)
echo  ================================================================
echo.

REM ── Step 1: Check Docker ──────────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Docker not running. Starting Docker Desktop...
    where docker >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] Docker not installed. Installing via winget...
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        echo.
        echo  RESTART required. Run this script again after restart.
        pause & exit /b 0
    )
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
    echo  Waiting 45s for Docker...
    timeout /t 45 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Docker still not ready. Start Docker Desktop manually.
        pause & exit /b 1
    )
)
echo  [OK] Docker is running.

REM ── Step 2: Detect LAN IP ─────────────────────────────────────────────────────
set "LOCAL_IP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress"`) do set "LOCAL_IP=%%i"
if not defined LOCAL_IP set "LOCAL_IP=127.0.0.1"
echo  [OK] LAN IP: !LOCAL_IP!

REM ── Step 3: Generate SSL ──────────────────────────────────────────────────────
if not exist "nginx\ssl" mkdir "nginx\ssl"
python -c "exec(open('mac/services/_gen_ssl_startup.py').read())" "!LOCAL_IP!" 2>nul
if errorlevel 1 (
    docker run --rm -v "%cd%\nginx\ssl:/ssl" -v "%cd%\mac\services\_gen_ssl_startup.py:/gen.py:ro" python:3.11-slim sh -c "pip install cryptography -q && python /gen.py !LOCAL_IP! /ssl" 2>nul
)
if exist "nginx\ssl\mac.crt" (
    echo  [OK] SSL ready.
    certutil -user -addstore "Root" "nginx\ssl\ca.crt" >nul 2>&1
) else (
    echo  [WARN] SSL skipped — HTTP only.
)

REM ── Step 4: Firewall ──────────────────────────────────────────────────────────
netsh advfirewall firewall add rule name="MAC HTTP"       dir=in action=allow protocol=TCP localport=80   profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC HTTPS"      dir=in action=allow protocol=TCP localport=443  profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC API"        dir=in action=allow protocol=TCP localport=8000 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC vLLM Speed" dir=in action=allow protocol=TCP localport=8001 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC Whisper"    dir=in action=allow protocol=TCP localport=8005 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC TTS"        dir=in action=allow protocol=TCP localport=8006 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC Cluster"    dir=in action=allow protocol=TCP localport=7700 profile=any >nul 2>&1
echo  [OK] Firewall rules applied.

REM ── Step 5: Check HuggingFace cache ──────────────────────────────────────────
echo.
echo  Checking HuggingFace model cache...
set "HF_CACHE=%USERPROFILE%\.cache\huggingface"
if not exist "!HF_CACHE!" mkdir "!HF_CACHE!"

REM Check if Qwen2.5-7B-AWQ weights exist
set "QWEN_CACHE_EXISTS=0"
for /f "usebackq" %%d in (`dir /s /b "!HF_CACHE!\models--Qwen--Qwen2.5-7B-Instruct-AWQ" 2^>nul`) do set "QWEN_CACHE_EXISTS=1"
if "!QWEN_CACHE_EXISTS!"=="1" (
    echo  [OK] Qwen2.5-7B-AWQ weights found in cache — no download needed.
) else (
    echo  [INFO] Qwen2.5-7B-AWQ not in local cache.
    echo         Will download from HuggingFace on first vLLM start (~4.5 GB).
    echo         Keep internet connected during first startup.
    echo         Set HF_TOKEN= in .env for faster authenticated download.
)
echo.

REM ── Step 6: Detect NVIDIA GPU ─────────────────────────────────────────────────
set "GPU_PROFILE="
set "GPU_NAME=None"
nvidia-smi --query-gpu=name --format=csv,noheader 2>nul > "%TEMP%\mac_gpu_pc1.tmp"
if not errorlevel 1 (
    set /p GPU_NAME=<"%TEMP%\mac_gpu_pc1.tmp"
    del "%TEMP%\mac_gpu_pc1.tmp" >nul 2>&1
    echo  [OK] NVIDIA GPU: !GPU_NAME!
    echo       Starting Qwen2.5-7B-AWQ on GPU (port 8001).
    echo       Also starting Veena TTS on GPU (port 8006).

    REM Verify NVIDIA Container Toolkit is available
    docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi >nul 2>&1
    if errorlevel 1 (
        echo.
        echo  [WARN] NVIDIA GPU found but Docker cannot access it.
        echo         Fix: Docker Desktop ^> Settings ^> General ^> Use WSL2 backend
        echo              Docker Desktop ^> Settings ^> Resources ^> Enable GPU
        echo         Or install nvidia-container-toolkit (Linux/WSL2).
        echo         Continuing without GPU profile — vLLM won't start.
        echo.
    ) else (
        set "GPU_PROFILE=--profile gpu"
        echo  [OK] GPU accessible in Docker containers.
    )
) else (
    del "%TEMP%\mac_gpu_pc1.tmp" >nul 2>&1
    echo  [INFO] No NVIDIA GPU detected on this PC.
    echo         vLLM will NOT start. Use API keys in Settings for AI chat.
    echo         Or ensure PC2/PC3 workers are connected with GPUs.
)
echo.

REM ── Step 7: Build Veena TTS image (first time only) ───────────────────────────
echo  Checking Veena TTS image...
docker image inspect mac-tts-img >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Building Veena TTS image (first run, ~3 min)...
    docker build -t mac-tts-img ./veena_tts
    if errorlevel 1 (echo  [WARN] Veena TTS build failed.) else (echo  [OK] Veena TTS built.)
) else (
    echo  [OK] Veena TTS image exists.
)
echo.

REM ── Step 8: Pull latest images (if network available) ─────────────────────────
echo  Checking for updated Docker images...
docker compose !GPU_PROFILE! pull --quiet 2>nul
echo  [OK] Image check done.
echo.

REM ── Step 9: Start all services ────────────────────────────────────────────────
echo  Starting MAC services (PC1 Host)...
docker compose !GPU_PROFILE! up -d --build --remove-orphans
if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start services. Checking logs...
    docker compose logs --tail=30 2>nul
    pause & exit /b 1
)

REM ── Step 10: Wait for API to be healthy ───────────────────────────────────────
echo.
echo  Waiting for MAC API to be ready...
set /a "WAIT=0"
:wait_loop
timeout /t 3 /nobreak >nul
set /a "WAIT+=3"
docker inspect --format="{{.State.Health.Status}}" mac-api 2>nul | findstr "healthy" >nul
if not errorlevel 1 (
    echo  [OK] MAC API is healthy!
    goto :api_ready
)
if !WAIT! GEQ 120 (
    echo  [WARN] API health check timed out. Proceeding anyway.
    goto :api_ready
)
echo  Waiting... (!WAIT!s)
goto :wait_loop
:api_ready

docker exec mac-nginx nginx -s reload >nul 2>&1

REM ── Step 11: Show status ──────────────────────────────────────────────────────
echo.
echo  ================================================================
echo   PC1 HOST RUNNING
echo.
echo   URL (HTTPS) : https://!LOCAL_IP!
echo   URL (HTTP)  : http://!LOCAL_IP!
echo   API docs    : http://!LOCAL_IP!:8000/docs
echo   pgAdmin     : http://localhost:5051
echo   SearXNG     : http://localhost:8888
echo.
echo   Voice AI    : Whisper (STT :8005) + Veena TTS (:8006)
echo   Chat LLM    : Qwen2.5-7B-AWQ (:8001) [GPU]
echo.
echo   Worker join : http://!LOCAL_IP!/join
echo   Worker CLI  : http://!LOCAL_IP!/api/v1/cluster/join/bat
echo.
echo   Admin login : http://!LOCAL_IP!  (admin / admin123)
echo.
echo   PC2 (Mistral-7B):  Run start-worker-pc2-mistral.bat on PC2
echo   PC3 (Vision AI):   Run start-worker-pc3-vision.bat on PC3
echo  ================================================================
echo.
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>nul

REM ── Step 12: Cloudflare tunnel (optional) ─────────────────────────────────────
where cloudflared >nul 2>&1
if not errorlevel 1 (
    start "Cloudflare Tunnel" /min cmd /c "cloudflared tunnel --url http://localhost:80 2>&1"
    echo  [OK] Cloudflare tunnel started (check tunnel window for public URL).
)

if not "!LOCAL_IP!"=="127.0.0.1" (start https://!LOCAL_IP!) else (start http://localhost)

echo.
echo  Showing live logs (Ctrl+C to stop watching, services keep running):
docker compose logs -f --tail=20 --no-color 2>nul
echo.
echo  To stop: stop-mac.bat
pause
