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
echo  ===================================================
echo.

REM ── Check Docker is running ──────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker Desktop is not running.
    echo  Please start Docker Desktop and try again.
    pause
    exit /b 1
)
echo  [OK] Docker is running.

REM ── Detect the real WiFi/Ethernet LAN IP ─────────────────
set "LOCAL_IP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress"`) do (
    set "LOCAL_IP=%%i"
)

if not defined LOCAL_IP (
    echo  [WARN] Could not detect WiFi/LAN IP. Using localhost only.
    set "LOCAL_IP=127.0.0.1"
)
echo  [OK] LAN IP: !LOCAL_IP!
echo.

REM ── Generate SSL certificates ────────────────────────────
echo  Generating SSL certificates for !LOCAL_IP!...
if not exist "nginx\ssl" mkdir "nginx\ssl"

python -c "exec(open('mac/services/_gen_ssl_startup.py').read())" "!LOCAL_IP!" 2>nul
if errorlevel 1 (
    echo  [INFO] Python not found locally, trying via Docker...
    docker run --rm -v "%cd%\nginx\ssl:/ssl" -v "%cd%\mac\services\_gen_ssl_startup.py:/gen.py:ro" python:3.11-slim sh -c "pip install cryptography -q && python /gen.py !LOCAL_IP! /ssl" 2>nul
    if errorlevel 1 (
        echo  [WARN] SSL generation failed. HTTP will still work.
    )
)

if exist "nginx\ssl\mac.crt" (
    echo  [OK] SSL certificates ready.
) else (
    echo  [WARN] No SSL certs. HTTPS unavailable, HTTP will work.
)
echo.

REM ── Install CA cert on this machine ──────────────────────
if exist "nginx\ssl\ca.crt" (
    echo  Installing CA certificate on this PC...
    certutil -user -addstore "Root" "nginx\ssl\ca.crt" >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] CA cert install skipped. Double-click nginx\ssl\ca.crt to install manually.
    ) else (
        echo  [OK] CA certificate trusted. Restart Chrome if already open.
    )
)
echo.

REM ── Open firewall ports ───────────────────────────────────
echo  Opening firewall ports 80, 443, 8000...
netsh advfirewall firewall add rule name="MAC Web HTTP"  dir=in action=allow protocol=TCP localport=80  profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC Web HTTPS" dir=in action=allow protocol=TCP localport=443 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC API"       dir=in action=allow protocol=TCP localport=8000 profile=any >nul 2>&1
echo  [OK] Firewall rules applied.
echo.

REM ── Detect NVIDIA GPU ─────────────────────────────────────
set "GPU_PROFILE="
set "GPU_NAME=None"
nvidia-smi --query-gpu=name --format=csv,noheader 2>nul > "%TEMP%\mac_gpu.tmp"
if not errorlevel 1 (
    set /p GPU_NAME=<"%TEMP%\mac_gpu.tmp"
    del "%TEMP%\mac_gpu.tmp" >nul 2>&1
    echo  [OK] NVIDIA GPU: !GPU_NAME!
    echo       Enabling vllm-speed for local AI inference.
    set "GPU_PROFILE=--profile gpu"
) else (
    del "%TEMP%\mac_gpu.tmp" >nul 2>&1
    echo  [INFO] No NVIDIA GPU detected — running in API-key mode.
    echo         Add your OpenAI/Anthropic/Groq key in Settings to use AI chat.
)
echo.

REM ── Pull latest images (optional — comment out to skip) ───
REM docker compose pull --quiet

REM ── Start services ────────────────────────────────────────
echo  Starting MAC services...
echo  (First run may take 2-3 minutes to download images)
echo.
docker compose !GPU_PROFILE! up -d

if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start MAC services.
    echo  Check Docker logs: docker compose logs --tail=50
    pause
    exit /b 1
)

REM ── Reload nginx to pick up new SSL certs ─────────────────
echo.
echo  Reloading nginx...
docker exec mac-nginx nginx -s reload >nul 2>&1
echo  [OK] nginx reloaded.

REM ── Show running containers ───────────────────────────────
echo.
echo  Running containers:
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>nul
echo.

REM ── Access URLs ───────────────────────────────────────────
echo  ===================================================
echo   MAC is running!
echo.
echo   APP (HTTPS): https://!LOCAL_IP!
echo   APP (HTTP):  http://!LOCAL_IP!
echo   APP (local): http://localhost
echo.
echo   API docs:    http://localhost:8000/docs
echo   Whisper STT: http://localhost:8005
echo   SearXNG:     http://localhost:8888
echo   pgAdmin:     http://localhost:5050
if defined GPU_PROFILE (
echo   vllm-speed:  http://localhost:8001  (GPU enabled)
)
echo.
echo   Worker join: http://!LOCAL_IP!/join
echo   CA cert:     http://!LOCAL_IP!/install-cert
echo  ===================================================
echo.

REM ── Dev credentials hint ──────────────────────────────────
echo  Dev credentials (change in production!):
echo    Admin:   abhisek.cse@mbm.ac.in / Admin@1234
echo    Faculty: raj.cse@mbm.ac.in     / Faculty@1234
echo    Student: 21CS045               / Student@1234
echo.

REM ── Veena TTS info ────────────────────────────────────────
echo  Voice / TTS info:
echo    Whisper STT is running on :8005
echo    Veena TTS (Maya Research) can be started manually:
echo      docker run -p 5002:5002 ghcr.io/mbmuniversity2026/veena-tts:latest
echo    Or pull it inside the container:
echo      docker exec -it mac-api pip install veena-tts
echo.

echo  Press any key to open MAC in your browser...
pause >nul
if not "!LOCAL_IP!"=="127.0.0.1" (
    start https://!LOCAL_IP!
) else (
    start http://localhost
)
