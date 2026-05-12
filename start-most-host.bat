@echo off
setlocal enabledelayedexpansion
title MAC MOST — HOST NODE (Load Balancer + Qwen2.5-7B + All Services)
cd /d "%~dp0"

echo.
echo  ================================================================
echo   MAC MOST — MBM AI Cloud
echo   HOST NODE  ^|  Load Balancer + Qwen2.5-7B + All Services
echo   MBM University, Jodhpur, Rajasthan, India
echo   Branch: most  ^|  github.com/mbmuniversity2026/MAC
echo  ================================================================
echo.
echo  This PC runs: MAC API, PostgreSQL, Redis, Qdrant, SearXNG,
echo                Nginx (load balancer), Whisper STT, Veena TTS,
echo                Qwen2.5-7B-AWQ LLM (if GPU present)
echo  Workers:      PC2 (Mistral-7B) + PC3 (Vision AI)
echo.

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 1: Docker
REM ──────────────────────────────────────────────────────────────────────────────
echo [1/13] Checking Docker Desktop...
docker info >nul 2>&1
if errorlevel 1 (
    where docker >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] Docker not installed. Installing via winget...
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        if errorlevel 1 (
            echo  [ERROR] winget install failed.
            echo          Download manually: https://docs.docker.com/desktop/install/windows-install/
            pause & exit /b 1
        )
        echo.
        echo  [ACTION] RESTART your PC, then run start-most-host.bat again.
        pause & exit /b 0
    )
    echo  [INFO] Docker installed but not running. Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
    echo  Waiting 60s for Docker to initialise...
    timeout /t 60 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Docker still not ready. Open Docker Desktop manually and retry.
        pause & exit /b 1
    )
)
echo  [OK] Docker is running.

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 2: Detect LAN IP
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [2/13] Detecting LAN IP...
set "LOCAL_IP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress" 2^>nul`) do set "LOCAL_IP=%%i"
if not defined LOCAL_IP set "LOCAL_IP=127.0.0.1"
echo  [OK] Host LAN IP: !LOCAL_IP!
echo       Workers on the same network will connect to this IP.

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 3: GPU Test (Full Diagnostic)
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [3/13] GPU Diagnostic...
echo  ┌──────────────────────────────────────────────────────────────┐
echo  │  NVIDIA GPU TEST                                             │
echo  └──────────────────────────────────────────────────────────────┘
set "GPU_OK=0"
set "GPU_PROFILE="
set "GPU_NAME=None"
set "GPU_VRAM_MB=0"

nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo  [INFO] No NVIDIA GPU detected (nvidia-smi not found).
    echo         vLLM will NOT start on this PC.
    echo         Qwen2.5-7B inference will be skipped.
    echo         Workers PC2+PC3 will handle ALL LLM requests.
    goto :gpu_done
)

for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=name --format=csv,noheader 2^>nul`) do (
    if "!GPU_NAME!"=="None" set "GPU_NAME=%%a"
)
for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2^>nul`) do (
    if "!GPU_VRAM_MB!"=="0" set /a "GPU_VRAM_MB=%%a"
)
set /a "GPU_VRAM_GB=!GPU_VRAM_MB! / 1024"
echo   GPU     : !GPU_NAME!
echo   VRAM    : !GPU_VRAM_MB! MB (~!GPU_VRAM_GB! GB)

if !GPU_VRAM_MB! GEQ 5000 (
    echo   Status  : PASS — enough VRAM for Qwen2.5-7B-AWQ
) else (
    echo   Status  : WARN — less than 5 GB VRAM, Qwen2.5-7B-AWQ may be slow
)

echo   Testing Docker GPU passthrough...
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi --query-gpu=name --format=csv,noheader >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [WARN] GPU found but Docker cannot access it.
    echo.
    echo   FIX: Docker Desktop ^> Settings ^> General ^> "Use WSL 2 based engine" (ON)
    echo        Docker Desktop ^> Settings ^> Resources ^> WSL Integration ^> GPU (ON)
    echo        Click "Apply and Restart" in Docker Desktop, then rerun this script.
    echo.
    echo   Proceeding WITHOUT GPU. vLLM skipped on this PC.
) else (
    echo  [OK] Docker GPU passthrough confirmed.
    set "GPU_PROFILE=--profile gpu"
    set "GPU_OK=1"
)

:gpu_done
echo.

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 4: Create .env if missing
REM ──────────────────────────────────────────────────────────────────────────────
echo [4/13] Environment configuration (.env)...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo  [INFO] Created .env from .env.example.
        echo         Edit .env to customise before production use.
    ) else (
        (
            echo MAC_ENV=development
            echo MAC_SECRET_KEY=most-cluster-secret-change-in-prod
            echo JWT_SECRET_KEY=most-jwt-secret-change-in-prod
            echo TRANSFORMERS_OFFLINE=0
            echo HF_DATASETS_OFFLINE=0
        ) > ".env"
        echo  [INFO] Minimal .env created.
    )
) else (
    echo  [OK] .env already exists.
)

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 5: SSL certificates
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [5/13] SSL certificates...
if not exist "nginx\ssl" mkdir "nginx\ssl"
if not exist "nginx\ssl\mac.crt" (
    echo  Generating self-signed SSL for !LOCAL_IP!...
    python -c "exec(open('mac/services/_gen_ssl_startup.py').read())" "!LOCAL_IP!" 2>nul
    if errorlevel 1 (
        docker run --rm ^
            -v "%cd%\nginx\ssl:/ssl" ^
            -v "%cd%\mac\services\_gen_ssl_startup.py:/gen.py:ro" ^
            python:3.11-slim sh -c "pip install cryptography -q && python /gen.py !LOCAL_IP! /ssl" 2>nul
    )
)
if exist "nginx\ssl\mac.crt" (
    certutil -user -addstore "Root" "nginx\ssl\ca.crt" >nul 2>&1
    echo  [OK] SSL ready. CA cert trusted on this PC.
) else (
    echo  [WARN] SSL generation skipped. HTTPS will not work — HTTP still works.
)

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 6: Firewall rules
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [6/13] Firewall rules...
netsh advfirewall firewall add rule name="MAC-MOST HTTP"      dir=in action=allow protocol=TCP localport=80   profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC-MOST HTTPS"     dir=in action=allow protocol=TCP localport=443  profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC-MOST API"       dir=in action=allow protocol=TCP localport=8000 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC-MOST vLLM"      dir=in action=allow protocol=TCP localport=8001 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC-MOST Whisper"   dir=in action=allow protocol=TCP localport=8005 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC-MOST TTS"       dir=in action=allow protocol=TCP localport=8006 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC-MOST Cluster"   dir=in action=allow protocol=TCP localport=7700 profile=any >nul 2>&1
netsh advfirewall firewall add rule name="MAC-MOST Discovery" dir=in action=allow protocol=UDP localport=7701 profile=any >nul 2>&1
echo  [OK] Ports opened: 80, 443, 8000, 8001, 8005, 8006, 7700, 7701(UDP)

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 7: Build Veena TTS image (first run only)
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [7/13] Veena TTS image...
docker image inspect mac-tts:latest >nul 2>&1
if errorlevel 1 (
    set "TTS_FOUND=0"
    for %%t in (mac-mac-tts macmac-tts mac_tts newmac-tts) do (
        docker image inspect %%t:latest >nul 2>&1
        if not errorlevel 1 (
            if "!TTS_FOUND!"=="0" (
                docker tag %%t:latest mac-tts:latest
                set "TTS_FOUND=1"
                echo  [OK] Reused existing TTS image (%%t).
            )
        )
    )
    if "!TTS_FOUND!"=="0" (
        echo  [INFO] Building Veena TTS image (first time — ~5-15 min)...
        echo        Subsequent starts are instant.
        docker build -t mac-tts:latest ./veena_tts
        if errorlevel 1 (
            echo  [WARN] Veena TTS build failed. Voice chat disabled.
        ) else (
            echo  [OK] Veena TTS image built.
        )
    )
) else (
    echo  [OK] Veena TTS image ready.
)

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 8: Start all services
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [8/13] Starting MAC services...
if "!GPU_PROFILE!"=="--profile gpu" (
    echo   GPU mode: Qwen2.5-7B-AWQ will start on port 8001.
) else (
    echo   CPU mode: vLLM skipped. Workers PC2+PC3 handle all LLM inference.
)
echo.

docker compose !GPU_PROFILE! up -d --build --remove-orphans
if errorlevel 1 (
    echo.
    echo  [ERROR] docker compose up failed.
    echo.
    echo   Common fixes:
    echo     Port conflict  : netstat -ano ^| findstr ":80 :443 :8000"
    echo     View logs      : docker compose logs --tail=50
    echo     Reset volumes  : docker compose down -v  (WARNING: deletes all DB data)
    echo.
    pause & exit /b 1
)
echo  [OK] Services are starting in background...

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 9: Wait for MAC API health
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [9/13] Waiting for MAC API to be ready (up to 3 min)...
set "READY=0"
set /a "WAIT_SEC=0"
:health_loop
timeout /t 5 /nobreak >nul
set /a "WAIT_SEC+=5"
docker inspect --format="{{.State.Health.Status}}" mac-api 2>nul | findstr /c:"healthy" >nul
if not errorlevel 1 (
    set "READY=1"
    echo  [OK] MAC API is healthy! (took !WAIT_SEC!s)
    goto :api_ready
)
if !WAIT_SEC! GEQ 180 (
    echo  [WARN] Timeout after 180s. API may still be loading — proceeding.
    goto :api_ready
)
<nul set /p "=  Waiting... (!WAIT_SEC!s)"
echo.
goto :health_loop
:api_ready

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 10: Reload nginx
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [10/13] Reloading nginx load balancer...
timeout /t 2 /nobreak >nul
docker exec mac-nginx nginx -s reload >nul 2>&1
if not errorlevel 1 (echo  [OK] Nginx reloaded.) else (echo  [INFO] Nginx reload skipped — it will auto-configure.)

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 11: Auto-generate cluster enrollment token
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [11/13] Generating cluster enrollment token for workers...

REM Load admin credentials (override from cluster.env if already exists)
set "ADMIN_EMAIL=abhisek.cse@mbm.ac.in"
set "ADMIN_PASS=Admin@1234"
if exist "cluster.env" (
    for /f "usebackq tokens=1,* delims==" %%a in ("cluster.env") do (
        if "%%a"=="ADMIN_EMAIL" set "ADMIN_EMAIL=%%b"
        if "%%a"=="ADMIN_PASS"  set "ADMIN_PASS=%%b"
    )
)

set "ENROLL_TOKEN="
for /f "usebackq tokens=*" %%t in (`powershell -NoProfile -Command ^
    "$ea=$env:ADMIN_EMAIL; $ap=$env:ADMIN_PASS; " ^
    "try { " ^
        "$lr=Invoke-RestMethod -Uri 'http://localhost:8000/api/v1/auth/login' -Method POST " ^
            "-Body ([pscustomobject]@{email='!ADMIN_EMAIL!';password='!ADMIN_PASS!'} | ConvertTo-Json) " ^
            "-ContentType 'application/json' -ErrorAction Stop; " ^
        "$er=Invoke-RestMethod -Uri 'http://localhost:8000/api/v1/cluster/enroll-token' -Method POST " ^
            "-Headers @{Authorization='Bearer '+$lr.access_token} " ^
            "-Body ([pscustomobject]@{label='most-workers';expires_hours=168} | ConvertTo-Json) " ^
            "-ContentType 'application/json' -ErrorAction Stop; " ^
        "Write-Output $er.token " ^
    "} catch { Write-Output 'TOKEN_ERROR' }" 2^>nul`) do set "ENROLL_TOKEN=%%t"

if not defined ENROLL_TOKEN set "ENROLL_TOKEN=TOKEN_ERROR"
if "!ENROLL_TOKEN!"=="TOKEN_ERROR" (
    echo  [WARN] Auto-token generation failed.
    echo         Manual step: Open http://!LOCAL_IP! ^> Admin Panel ^> Cluster ^> Generate Token
    echo         Paste the token into cluster.env as ENROLL_TOKEN=^<token^>
    set "ENROLL_TOKEN=GENERATE-MANUALLY-FROM-ADMIN-PANEL"
) else (
    echo  [OK] Enrollment token generated (valid 7 days).
)

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 12: Write cluster.env for workers
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [12/13] Writing cluster.env for worker PCs...
(
    echo # MAC MOST — Cluster Configuration
    echo # Generated: %date% %time%
    echo # ─────────────────────────────────────────────────────────────
    echo # HOW TO USE:
    echo #   1. Copy this file to the MAC repo directory on PC2 and PC3
    echo #   2. Double-click start-most-worker-pc2.bat on PC2
    echo #   3. Double-click start-most-worker-pc3.bat on PC3
    echo #   No other input needed — workers auto-join this host.
    echo # ─────────────────────────────────────────────────────────────
    echo.
    echo HOST_IP=!LOCAL_IP!
    echo HOST_URL=http://!LOCAL_IP!
    echo HOST_HTTPS_URL=https://!LOCAL_IP!
    echo ENROLL_TOKEN=!ENROLL_TOKEN!
    echo.
    echo # Admin credentials (used to auto-refresh tokens if needed)
    echo # Update these if you changed the admin password
    echo ADMIN_EMAIL=abhisek.cse@mbm.ac.in
    echo ADMIN_PASS=Admin@1234
) > "cluster.env"
echo  [OK] cluster.env written.
echo   ^>^> Copy cluster.env to the MAC repo folder on PC2 and PC3 ^<^<
echo      (USB drive, network share, or email)

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 13: Final status
REM ──────────────────────────────────────────────────────────────────────────────
echo.
echo [13/13] Running services:
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>nul

echo.
echo  ================================================================
echo   MAC MOST HOST IS RUNNING
echo.
if not "!LOCAL_IP!"=="127.0.0.1" (
    echo   Web App (HTTPS): https://!LOCAL_IP!
    echo   Web App (HTTP) : http://!LOCAL_IP!
) else (
    echo   Web App        : http://localhost
)
echo   API Docs       : http://!LOCAL_IP!:8000/docs
echo   pgAdmin        : http://localhost:5051
echo   SearXNG        : http://localhost:8888
echo.
if "!GPU_OK!"=="1" (
    echo   Qwen2.5-7B-AWQ : http://!LOCAL_IP!:8001  [GPU — RUNNING]
) else (
    echo   Qwen2.5-7B-AWQ : NOT running (GPU not available)
)
echo   Whisper STT    : http://!LOCAL_IP!:8005
echo   Veena TTS      : http://!LOCAL_IP!:8006
echo.
echo   ── CLUSTER SETUP FOR WORKERS ─────────────────────────────────
echo   Enrollment Token: !ENROLL_TOKEN!
echo.
echo   PC2 (Mistral-7B):
echo     1. Copy cluster.env to PC2 MAC folder
echo     2. Run start-most-worker-pc2.bat on PC2
echo.
echo   PC3 (Vision AI):
echo     1. Copy cluster.env to PC3 MAC folder
echo     2. Run start-most-worker-pc3.bat on PC3
echo.
echo   ── DEFAULT LOGIN ─────────────────────────────────────────────
echo   Admin  : abhisek.cse@mbm.ac.in  /  Admin@1234
echo   Faculty: raj.cse@mbm.ac.in      /  Faculty@1234
echo   Student: 21CS045                /  Student@1234
echo  ================================================================
echo.

REM Open browser
if not "!LOCAL_IP!"=="127.0.0.1" (
    start https://!LOCAL_IP! 2>nul
    timeout /t 1 /nobreak >nul
    start http://!LOCAL_IP!
) else (
    start http://localhost
)

echo  Showing live logs (Ctrl+C stops watching, services keep running):
echo  To stop all services: stop-mac.bat
echo.
docker compose !GPU_PROFILE! logs -f --tail=30 --no-color 2>nul
echo.
echo  Services are still running in background.
pause
