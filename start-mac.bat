@echo off
setlocal enabledelayedexpansion
title MAC — MBM AI Cloud
cd /d "%~dp0"

echo.
echo     ___________
echo    /           \
echo   ^|  O     O  ^|
echo   ^|    ___    ^|   Hi! I'm MAC
echo   ^|   ^|   ^|   ^|   MBM AI Cloud  v0.0
echo    \   ---   /
echo     \_______/
echo      ^|^| ^|^|
echo  ===================================================
echo   MAC — MBM AI Cloud  ^|  Starting services...
echo   Voice Pipeline: Whisper -^> Sarvam-2B -^> Veena TTS
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
        echo  IMPORTANT: You must RESTART your PC now, then run start-mac.bat again.
        echo  Docker Desktop requires a restart to finish setup.
        echo.
        pause
        exit /b 0
    ) else (
        echo  [INFO] Docker found but not running. Starting Docker Desktop...
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
        echo  Waiting 30s for Docker to start...
        timeout /t 30 /nobreak >nul
        docker info >nul 2>&1
        if errorlevel 1 (
            echo  [ERROR] Docker still not ready. Please start Docker Desktop manually and retry.
            pause
            exit /b 1
        )
    )
)
echo  [OK] Docker is running.

REM ── Step 2: Detect LAN IP ────────────────────────────────────────────────────
set "LOCAL_IP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress"`) do (
    set "LOCAL_IP=%%i"
)
if not defined LOCAL_IP (
    echo  [WARN] Could not detect WiFi/LAN IP. Using localhost.
    set "LOCAL_IP=127.0.0.1"
)
echo  [OK] LAN IP: !LOCAL_IP!
echo.

REM ── Step 3: Generate SSL certificates ────────────────────────────────────────
echo  Generating SSL certificates for !LOCAL_IP!...
if not exist "nginx\ssl" mkdir "nginx\ssl"

python -c "exec(open('mac/services/_gen_ssl_startup.py').read())" "!LOCAL_IP!" 2>nul
if errorlevel 1 (
    echo  [INFO] Python not found locally, using Docker for SSL gen...
    docker run --rm -v "%cd%\nginx\ssl:/ssl" -v "%cd%\mac\services\_gen_ssl_startup.py:/gen.py:ro" python:3.11-slim sh -c "pip install cryptography -q && python /gen.py !LOCAL_IP! /ssl" 2>nul
)

if exist "nginx\ssl\mac.crt" (
    echo  [OK] SSL certificates ready.
) else (
    echo  [WARN] SSL generation failed. HTTP will work; HTTPS unavailable.
)
echo.

REM ── Step 4: Install CA cert ──────────────────────────────────────────────────
if exist "nginx\ssl\ca.crt" (
    certutil -user -addstore "Root" "nginx\ssl\ca.crt" >nul 2>&1
    if not errorlevel 1 (
        echo  [OK] CA certificate trusted on this PC.
    )
)

REM ── Step 5: Open firewall ports ──────────────────────────────────────────────
echo  Opening firewall ports...
netsh advfirewall firewall add rule name="MAC HTTP"    dir=in action=allow protocol=TCP localport=80   profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC HTTPS"   dir=in action=allow protocol=TCP localport=443  profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC API"     dir=in action=allow protocol=TCP localport=8000 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC Whisper" dir=in action=allow protocol=TCP localport=8005 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC TTS"     dir=in action=allow protocol=TCP localport=8006 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC vLLM"    dir=in action=allow protocol=TCP localport=8001 profile=any >nul 2>&1
echo  [OK] Firewall rules applied.
echo.

REM ── Step 6: Detect NVIDIA GPU ────────────────────────────────────────────────
set "GPU_PROFILE="
set "GPU_NAME=None"
nvidia-smi --query-gpu=name --format=csv,noheader 2>nul > "%TEMP%\mac_gpu.tmp"
if not errorlevel 1 (
    set /p GPU_NAME=<"%TEMP%\mac_gpu.tmp"
    del "%TEMP%\mac_gpu.tmp" >nul 2>&1
    echo  [OK] NVIDIA GPU: !GPU_NAME!
    echo       Starting Sarvam-2B (voice LLM) + Veena TTS on GPU.
    set "GPU_PROFILE=--profile gpu"
) else (
    del "%TEMP%\mac_gpu.tmp" >nul 2>&1
    echo  [INFO] No NVIDIA GPU detected.
    echo         Sarvam-2B will not start (vLLM needs GPU).
    echo         Veena TTS and Whisper will run on CPU (slower).
    echo         Add your OpenAI / Anthropic key in Settings for AI chat.
)
echo.

REM ── Step 7: Build Veena TTS image (first time only) ──────────────────────────
echo  Checking Veena TTS image...
docker image inspect mac-tts-img >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Building Veena TTS Docker image (first run — takes a few minutes)...
    docker build -t mac-tts-img ./veena_tts
    if errorlevel 1 (
        echo  [WARN] Veena TTS build failed. TTS will be unavailable.
    ) else (
        echo  [OK] Veena TTS image built.
    )
) else (
    echo  [OK] Veena TTS image already built.
)
echo.

REM ── Step 8: Start services ───────────────────────────────────────────────────
echo  Starting MAC services...
echo  (First run: Sarvam-2B + Veena weights download from HuggingFace ~4-6 GB)
echo.
docker compose !GPU_PROFILE! up -d --build

if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start services.
    echo  Check logs: docker compose logs --tail=50
    pause
    exit /b 1
)

REM ── Step 9: Reload nginx ─────────────────────────────────────────────────────
echo.
timeout /t 5 /nobreak >nul
docker exec mac-nginx nginx -s reload >nul 2>&1
echo  [OK] nginx reloaded.

REM ── Step 10: Show status ─────────────────────────────────────────────────────
echo.
echo  Running containers:
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>nul
echo.

echo  ===================================================
echo   MAC is running!
echo.
echo   APP  (HTTPS): https://!LOCAL_IP!
echo   APP  (HTTP):  http://!LOCAL_IP!
echo   APP  (local): http://localhost
echo.
echo   Voice Pipeline:
echo     Whisper STT : http://localhost:8005
echo     Sarvam-2B   : http://localhost:8001  (GPU)
echo     Veena TTS   : http://localhost:8006  (kavya/agastya voices)
echo.
echo   API docs  : http://localhost:8000/docs
echo   pgAdmin   : http://localhost:5051
echo   SearXNG   : http://localhost:8888
echo.
echo   Worker join: http://!LOCAL_IP!/join
echo   CA cert    : http://!LOCAL_IP!/install-cert
echo  ===================================================
echo.

echo  Dev credentials:
echo    Admin:   abhisek.cse@mbm.ac.in / Admin@1234
echo    Faculty: raj.cse@mbm.ac.in     / Faculty@1234
echo    Student: 21CS045               / Student@1234
echo.
echo  Voice Chat: Log in → click the mic icon in AI Chat
echo  NOTE: Sarvam-2B + Veena weights download on first start (~4-6 GB).
echo        Voice chat will work once both containers show "running".
echo.

echo  Press any key to open MAC in your browser...
pause >nul
if not "!LOCAL_IP!"=="127.0.0.1" (
    start https://!LOCAL_IP!
) else (
    start http://localhost
)
