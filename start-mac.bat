@echo off
setlocal enabledelayedexpansion
title MAC — MBM AI Cloud
cd /d "%~dp0"

echo.
echo     ___________
echo    /           \
echo   ^|  O     O  ^|
echo   ^|    ___    ^|   Hi! I'm MAC
echo   ^|   ^|   ^|   ^|   MBM AI Cloud  v2.0
echo    \   ---   /
echo     \_______/
echo      ^|^| ^|^|
echo  ===================================================
echo   MAC — MBM AI Cloud  ^|  Starting...
echo   MBM University, Jodhpur
echo  ===================================================
echo.

REM ── Step 1: Check / Install Docker ───────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Docker Desktop not found or not running.
    where docker >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] Docker not installed. Installing via winget...
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        if errorlevel 1 (
            echo  [ERROR] winget install failed. Download manually:
            echo          https://docs.docker.com/desktop/install/windows-install/
            pause
            exit /b 1
        )
        echo.
        echo  [OK] Docker Desktop installed.
        echo  IMPORTANT: Restart your PC, then run start-mac.bat again.
        pause
        exit /b 0
    ) else (
        echo  [INFO] Docker found but not running. Starting Docker Desktop...
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
        echo  Waiting 45s for Docker to initialise...
        timeout /t 45 /nobreak >nul
        docker info >nul 2>&1
        if errorlevel 1 (
            echo  [ERROR] Docker still not ready. Open Docker Desktop manually and retry.
            pause
            exit /b 1
        )
    )
)
echo  [OK] Docker is running.

REM ── Step 2: Create .env if missing ───────────────────────────────────────────
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo  [INFO] Created .env from .env.example
        echo         Edit .env to customise before production use.
    ) else (
        echo  [WARN] .env.example not found — creating minimal .env
        (
            echo MAC_ENV=development
            echo MAC_SECRET_KEY=dev-secret-key-change-in-production
            echo JWT_SECRET_KEY=dev-jwt-key-change-in-production
            echo TRANSFORMERS_OFFLINE=0
            echo HF_DATASETS_OFFLINE=0
        ) > ".env"
    )
)
echo  [OK] .env ready.

REM ── Step 3: Detect LAN IP ────────────────────────────────────────────────────
set "LOCAL_IP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress" 2^>nul`) do (
    set "LOCAL_IP=%%i"
)
if not defined LOCAL_IP set "LOCAL_IP=127.0.0.1"
echo  [OK] LAN IP: !LOCAL_IP!

REM ── Step 4: Generate SSL certificates (if not already there) ─────────────────
if not exist "nginx\ssl\mac.crt" (
    echo  Generating SSL certificates for !LOCAL_IP!...
    if not exist "nginx\ssl" mkdir "nginx\ssl"
    python -c "exec(open('mac/services/_gen_ssl_startup.py').read())" "!LOCAL_IP!" 2>nul
    if errorlevel 1 (
        docker run --rm -v "%cd%\nginx\ssl:/ssl" -v "%cd%\mac\services\_gen_ssl_startup.py:/gen.py:ro" python:3.11-slim sh -c "pip install cryptography -q && python /gen.py !LOCAL_IP! /ssl" 2>nul
    )
    if exist "nginx\ssl\mac.crt" (
        echo  [OK] SSL certificates generated.
    ) else (
        echo  [WARN] SSL cert generation failed. HTTPS unavailable; HTTP still works.
    )
) else (
    echo  [OK] SSL certificates already present.
)

REM ── Step 5: Install CA cert to local trust store ─────────────────────────────
if exist "nginx\ssl\ca.crt" (
    certutil -user -addstore "Root" "nginx\ssl\ca.crt" >nul 2>&1
    if not errorlevel 1 echo  [OK] CA certificate trusted on this PC.
)

REM ── Step 6: Open firewall ports ──────────────────────────────────────────────
netsh advfirewall firewall add rule name="MAC HTTP"    dir=in action=allow protocol=TCP localport=80   profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC HTTPS"   dir=in action=allow protocol=TCP localport=443  profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC API"     dir=in action=allow protocol=TCP localport=8000 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC Whisper" dir=in action=allow protocol=TCP localport=8005 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC TTS"     dir=in action=allow protocol=TCP localport=8006 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC vLLM"    dir=in action=allow protocol=TCP localport=8001 profile=any >nul 2>&1
echo  [OK] Firewall rules applied.
echo.

REM ── Step 7: Detect NVIDIA GPU + verify Docker GPU access ────────────────────
set "GPU_PROFILE="
set "GPU_NAME=None"
nvidia-smi --query-gpu=name --format=csv,noheader 2>nul > "%TEMP%\mac_gpu.tmp"
if not errorlevel 1 (
    set /p GPU_NAME=<"%TEMP%\mac_gpu.tmp"
    del "%TEMP%\mac_gpu.tmp" >nul 2>&1
    if not "!GPU_NAME!"=="" (
        echo  [OK] NVIDIA GPU detected: !GPU_NAME!
        REM Verify Docker can actually pass the GPU through
        docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi >nul 2>&1
        if errorlevel 1 (
            echo  [WARN] GPU found but Docker containers cannot access it.
            echo.
            echo         FIX:
            echo           Docker Desktop ^> Settings ^> General ^> Use WSL2 backend  (enable)
            echo           Docker Desktop ^> Settings ^> Resources ^> GPU             (enable)
            echo           Restart Docker Desktop, then restart this script.
            echo.
            echo         Starting WITHOUT GPU. vLLM will not run.
            echo         Add an OpenAI/Anthropic key in Settings for AI chat.
            echo.
        ) else (
            echo  [OK] GPU accessible inside Docker containers.
            set "GPU_PROFILE=--profile gpu"
        )
    ) else (
        del "%TEMP%\mac_gpu.tmp" >nul 2>&1
    )
) else (
    del "%TEMP%\mac_gpu.tmp" >nul 2>&1
    echo  [INFO] No NVIDIA GPU on this PC.
    echo         vLLM (local AI) will NOT start — that is fine for a no-GPU machine.
    echo         All other services run normally: chat via API key, Whisper STT on CPU,
    echo         Veena TTS on CPU (slower), attendance, RAG, web search, exams, etc.
    echo         GPU worker PCs will provide AI once connected (start-worker-pc*.bat).
)
echo.

REM ── Step 8: Ensure Veena TTS image exists (avoid redownloading PyTorch) ──────
echo  Checking Veena TTS image...
docker image inspect mac-tts:latest >nul 2>&1
if errorlevel 1 (
    REM Check for previously built image under different compose project name
    set "TTS_FOUND=0"
    for %%t in (macmac-tts mac_tts newmac-tts) do (
        docker image inspect %%t:latest >nul 2>&1
        if not errorlevel 1 (
            if "!TTS_FOUND!"=="0" (
                echo  [OK] Found existing TTS image (%%t) — reusing it.
                docker tag %%t:latest mac-tts:latest
                set "TTS_FOUND=1"
            )
        )
    )
    if "!TTS_FOUND!"=="0" (
        echo  [INFO] Building Veena TTS image (first time — downloads PyTorch ~2 GB)...
        echo        This takes 5-15 min depending on internet speed.
        echo        Subsequent starts are instant.
        docker build -t mac-tts:latest ./veena_tts
        if errorlevel 1 (
            echo  [WARN] Veena TTS build failed. TTS unavailable — voice chat disabled.
        ) else (
            echo  [OK] Veena TTS image built.
        )
    )
) else (
    echo  [OK] Veena TTS image ready.
)
echo.

REM ── Step 9: Ensure MAC API image exists ──────────────────────────────────────
echo  Checking MAC API image...
docker image inspect mac-mac:latest >nul 2>&1
if errorlevel 1 (
    REM Check for previously built image under different project name
    set "MAC_FOUND=0"
    for %%m in (macmac-mac newmac-mac ghcr.io/mbmuniversity2026/mac) do (
        docker image inspect %%m:latest >nul 2>&1
        if not errorlevel 1 (
            if "!MAC_FOUND!"=="0" (
                echo  [OK] Found existing MAC image (%%m) — reusing it.
                docker tag %%m:latest mac-mac:latest
                set "MAC_FOUND=1"
            )
        )
    )
    if "!MAC_FOUND!"=="0" (
        echo  [INFO] Building MAC API image (first time — ~2-3 min)...
        docker build -t mac-mac:latest .
        if errorlevel 1 (
            echo  [ERROR] MAC API build failed. Cannot start.
            pause
            exit /b 1
        )
        echo  [OK] MAC API image built.
    )
) else (
    echo  [OK] MAC API image ready.
)
echo.

REM ── Step 10: Start all services ──────────────────────────────────────────────
echo  Starting MAC services...
echo.
docker compose !GPU_PROFILE! up -d

if errorlevel 1 (
    echo.
    echo  [ERROR] docker compose up failed.
    echo.
    echo  Common fixes:
    echo    - Port conflict: netstat -ano ^| findstr :80
    echo    - View logs:     docker compose logs --tail=50
    echo    - Reset volumes: docker compose down -v  (WARNING: deletes DB data)
    echo.
    pause
    exit /b 1
)

REM ── Step 11: Wait for MAC API to be healthy ──────────────────────────────────
echo.
echo  Waiting for MAC API to be ready...
set "READY=0"
for /l %%i in (1,1,30) do (
    if "!READY!"=="0" (
        docker exec mac-api python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" >nul 2>&1
        if not errorlevel 1 (
            set "READY=1"
            echo  [OK] MAC API is healthy.
        ) else (
            <nul set /p "=  Waiting... (%%i/30)"
            timeout /t 3 /nobreak >nul
            echo.
        )
    )
)
if "!READY!"=="0" (
    echo  [WARN] MAC API health check timed out. It may still be starting.
    echo         Check: docker compose logs mac --tail=30
)

REM ── Step 12: Reload nginx ─────────────────────────────────────────────────────
timeout /t 3 /nobreak >nul
docker exec mac-nginx nginx -s reload >nul 2>&1

REM ── Step 13: Show running services ───────────────────────────────────────────
echo.
echo  Running containers:
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>nul
echo.

echo  ===================================================
echo   MAC is running!
echo.
echo   APP  (HTTP):   http://!LOCAL_IP!
if exist "nginx\ssl\mac.crt" (
    echo   APP  (HTTPS):  https://!LOCAL_IP!
)
echo   APP  (local):  http://localhost
echo.
if "!GPU_PROFILE!"=="--profile gpu" (
    echo   AI Chat   : Local GPU — Qwen2.5-7B-AWQ on :8001
) else (
    echo   AI Chat   : No local GPU — add API key in Settings
    echo               or connect worker PCs via start-worker-pc*.bat
)
echo   Whisper STT : http://localhost:8005
echo   Veena TTS   : http://localhost:8006
echo   API docs    : http://localhost:8000/docs
echo   pgAdmin     : http://localhost:5051
echo   SearXNG     : http://localhost:8888
echo  ===================================================
echo.
echo  Dev credentials (MAC_ENV=development only):
echo    Admin:   abhisek.cse@mbm.ac.in  / Admin@1234
echo    Faculty: raj.cse@mbm.ac.in      / Faculty@1234
echo    Student: 21CS045                / Student@1234
echo.

REM ── Step 14: Cloudflare Tunnel (optional) ───────────────────────────────────
where cloudflared >nul 2>&1
if not errorlevel 1 (
    echo  Starting Cloudflare Tunnel for internet API access...
    start "Cloudflare Tunnel" /min cmd /c "cloudflared tunnel --url http://localhost:80 2>&1 | findstr /i trycloudflare"
    timeout /t 3 /nobreak >nul
    echo  [OK] Cloudflare Tunnel running (check its window for the public URL).
) else (
    echo  [INFO] Tip: install cloudflared for public tunnel access.
    echo         winget install Cloudflare.cloudflared
)
echo.

REM ── Open browser ──────────────────────────────────────────────────────────────
start http://localhost

REM ── Live log tail ─────────────────────────────────────────────────────────────
echo  ===================================================
echo   Live logs below. Press Ctrl+C to stop watching.
echo   Containers keep running in background after Ctrl+C.
echo   To stop all: stop-mac.bat
echo  ===================================================
echo.
docker compose logs -f --tail=20 --no-color 2>nul
echo.
echo  Containers are still running in the background.
echo.
pause
