@echo off
setlocal enabledelayedexpansion
title MAC — MBM AI Cloud
cd /d "%~dp0"

echo.
echo     ___________
echo    /           \
echo   ^|  O     O  ^|
echo   ^|    ___    ^|   Hi! I'm MAC
echo   ^|   ^|   ^|   ^|   MBM AI Cloud
echo    \   ---   /
echo     \_______/
echo      ^|^| ^|^|
echo  ===================================================
echo   MAC — MBM AI Cloud  ^|  Host Server Starting...
echo  ===================================================
echo.

REM Check Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker Desktop is not running.
    echo  Please start Docker Desktop and try again.
    pause
    exit /b 1
)

REM ── Detect the real WiFi/Ethernet LAN IP (skip Docker, WSL, vEthernet) ──
set "LOCAL_IP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress"`) do (
    set "LOCAL_IP=%%i"
)

if not defined LOCAL_IP (
    echo  [WARN] Could not detect WiFi/LAN IP. Using localhost only.
    set "LOCAL_IP=127.0.0.1"
)

echo  Detected LAN IP: !LOCAL_IP!
echo.

REM ── Generate SSL certificates for this LAN IP ──
echo  Generating SSL certificates for !LOCAL_IP!...
if not exist "nginx\ssl" mkdir "nginx\ssl"

python -c "exec(open('mac/services/_gen_ssl_startup.py').read())" "!LOCAL_IP!" 2>nul
if errorlevel 1 (
    echo  [INFO] Python not found locally, trying via Docker...
    docker run --rm -v "%cd%\nginx\ssl:/ssl" -v "%cd%\mac\services\_gen_ssl_startup.py:/gen.py:ro" python:3.11-slim sh -c "pip install cryptography -q && python /gen.py !LOCAL_IP! /ssl" 2>nul
    if errorlevel 1 (
        echo  [WARN] SSL generation failed. HTTPS may not work.
        echo  You can still access MAC over HTTP at http://!LOCAL_IP!
    )
)

if exist "nginx\ssl\mac.crt" (
    echo  [OK] SSL certificates ready for !LOCAL_IP!
) else (
    echo  [WARN] No SSL certificates found. HTTPS will be unavailable.
)
echo.

REM ── Install CA cert on THIS machine so Chrome trusts our HTTPS ──
if exist "nginx\ssl\ca.crt" (
    echo  Installing CA certificate on this PC...
    echo  ^(A security dialog may appear — click YES to trust MAC certificates^)
    certutil -user -addstore "Root" "nginx\ssl\ca.crt" >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] CA cert install skipped or was declined.
        echo         You can manually install it: double-click nginx\ssl\ca.crt
        echo         Or visit http://!LOCAL_IP!/install-cert for instructions.
    ) else (
        echo  [OK] CA certificate trusted on this PC. Restart Chrome if open.
    )
)
echo.

REM ── Open firewall ports (requires admin — silent fail if not admin) ──
echo  Opening firewall ports 80, 443 for LAN access...
netsh advfirewall firewall add rule name="MAC Web (HTTP)" dir=in action=allow protocol=TCP localport=80 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC Web (HTTPS)" dir=in action=allow protocol=TCP localport=443 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC API (8000)" dir=in action=allow protocol=TCP localport=8000 profile=any >nul 2>&1
echo  [OK] Firewall rules applied.
echo.

REM ── Detect NVIDIA GPU ──
set "GPU_PROFILE="
nvidia-smi >nul 2>&1
if not errorlevel 1 (
    echo  [OK] NVIDIA GPU detected — enabling local AI models.
    set "GPU_PROFILE=--profile gpu"
) else (
    echo  [INFO] No NVIDIA GPU found — running in API-key-only mode.
    echo         Add your OpenAI/Anthropic key in Settings to use AI chat.
)
echo.

REM ── Start services ──
echo  Starting MAC services (this may take a minute on first run)...
docker compose !GPU_PROFILE! up -d

if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start MAC services.
    pause
    exit /b 1
)

REM ── Force nginx to reload config (picks up new SSL certs + routes) ──
echo  Reloading nginx configuration...
docker exec mac-nginx nginx -s reload >nul 2>&1
echo  [OK] Nginx reloaded.

echo.
echo  ===================================================
echo   MAC is running!
echo.
echo   Local:     http://localhost
if not "!LOCAL_IP!"=="127.0.0.1" (
echo   Network:   https://!LOCAL_IP!
echo   HTTP:      http://!LOCAL_IP!
echo   Workers:   http://!LOCAL_IP!/join
echo   Cert:      http://!LOCAL_IP!/install-cert
)
echo  ===================================================
echo.
echo  For other devices on this WiFi:
echo    1. Open  http://!LOCAL_IP!/install-cert  on the device
echo    2. Download and install the CA certificate ^(one-time^)
echo    3. Open  https://!LOCAL_IP!  — tap Install!
echo.
echo  Press any key to open MAC in your browser...
pause >nul
if not "!LOCAL_IP!"=="127.0.0.1" (
    start https://!LOCAL_IP!
) else (
    start http://localhost
)
