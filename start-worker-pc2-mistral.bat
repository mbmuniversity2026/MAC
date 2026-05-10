@echo off
setlocal enabledelayedexpansion
title MAC — PC2 WORKER (Mistral-7B Creative/General Chat)
cd /d "%~dp0"

echo.
echo  ================================================================
echo   MAC — MBM AI Cloud
echo   PC2: WORKER NODE — Mistral-7B-Instruct
echo   Role: Creative writing, general chat, essays, language tasks
echo   Requires: NVIDIA GPU with 8+ GB VRAM
echo  ================================================================
echo.

REM ── Step 1: Docker check ──────────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    where docker >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] Installing Docker Desktop...
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        echo  RESTART required. Run this script again after restart.
        pause & exit /b 0
    )
    echo  Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
    timeout /t 45 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (echo  [ERROR] Docker not ready. & pause & exit /b 1)
)
echo  [OK] Docker running.

REM ── Step 2: GPU detection ─────────────────────────────────────────────────────
set "GPU_NAME=None"
set "GPU_VRAM_MB=0"
set "HAS_GPU=0"
for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=name --format=csv,noheader 2^>nul`) do (
    if "!HAS_GPU!"=="0" ( set "GPU_NAME=%%a" & set "HAS_GPU=1" )
)
if "!HAS_GPU!"=="1" (
    for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2^>nul`) do (
        if "!GPU_VRAM_MB!"=="0" set /a "GPU_VRAM_MB=%%a"
    )
    echo  [OK] GPU: !GPU_NAME! (!GPU_VRAM_MB! MB VRAM)
    if !GPU_VRAM_MB! LSS 7500 (
        echo.
        echo  [WARN] Mistral-7B needs ~8 GB VRAM. Your GPU has !GPU_VRAM_MB! MB.
        echo         Consider using Mistral-7B-AWQ (5 GB) — edit VLLM_MODEL below.
        echo         Proceeding with Mistral-7B fp16 — may fail if VRAM insufficient.
        echo.
    )
) else (
    echo  [ERROR] No NVIDIA GPU detected. Mistral-7B requires a GPU.
    echo          Without GPU, use setup-worker.bat to set up a CPU (Ollama) worker.
    pause & exit /b 1
)

REM ── Step 3: Verify Docker GPU access ─────────────────────────────────────────
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [WARN] GPU found but Docker cannot access it.
    echo         Fix: Docker Desktop ^> Settings ^> General ^> Use WSL2 backend
    echo              Docker Desktop ^> Settings ^> Resources ^> Enable GPU (WSL2)
    echo              Then restart Docker Desktop and rerun this script.
    echo.
    pause & exit /b 1
)
echo  [OK] GPU accessible inside Docker.

REM ── Step 4: Get PC1 host URL ──────────────────────────────────────────────────
echo.
echo [4/8] MAC Control Node (PC1) address
echo  Example: http://192.168.1.34  (the PC running start-host-pc1.bat)
echo.
set "MASTER="
set /p MASTER="PC1 URL (http://...): "
if "!MASTER!"=="" (echo  [ERROR] URL required. & pause & exit /b 1)
if "!MASTER:~-1!"=="/" set "MASTER=!MASTER:~0,-1!"
echo  [OK] !MASTER!

REM ── Step 5: Enrollment token ─────────────────────────────────────────────────
echo.
echo [5/8] Enrollment Token
echo  1. Open !MASTER! in browser
echo  2. Log in as Admin
echo  3. Admin Panel ^> Cluster ^> Generate Token
echo  4. Paste it here
echo.
set "TOKEN="
set /p TOKEN="Enrollment token: "
if "!TOKEN!"=="" (echo  [ERROR] Token required. & pause & exit /b 1)

REM ── Step 6: Worker name ───────────────────────────────────────────────────────
set "WNAME="
set /p WNAME="Worker name (Enter = %COMPUTERNAME%): "
if "!WNAME!"=="" set "WNAME=%COMPUTERNAME%-Mistral"

REM ── Step 7: Model selection ───────────────────────────────────────────────────
echo.
echo [7/8] Mistral model variant
echo   1  mistralai/Mistral-7B-Instruct-v0.3      fp16  ~8 GB VRAM  (recommended for 8+ GB)
echo   2  mistralai/Mistral-7B-v0.3-AWQ            AWQ   ~5 GB VRAM  (recommended for 8 GB)
echo   3  mistralai/Mistral-7B-Instruct-v0.2        fp16  ~8 GB VRAM
echo.
set "MC="
set /p MC="Choice (1-3, Enter = 2): "
if "!MC!"=="" set "MC=2"

if "!MC!"=="1" (
    set "VLLM_MODEL=mistralai/Mistral-7B-Instruct-v0.3"
    set "VLLM_GPU_MEM=0.88"
    set "VLLM_MAX_LEN=8192"
    set "VLLM_DTYPE=auto"
    set "MODEL_LABEL=Mistral-7B-Instruct-v0.3"
)
if "!MC!"=="2" (
    set "VLLM_MODEL=TheBloke/Mistral-7B-Instruct-v0.2-AWQ"
    set "VLLM_GPU_MEM=0.85"
    set "VLLM_MAX_LEN=8192"
    set "VLLM_DTYPE=auto"
    set "MODEL_LABEL=Mistral-7B-AWQ"
)
if "!MC!"=="3" (
    set "VLLM_MODEL=mistralai/Mistral-7B-Instruct-v0.2"
    set "VLLM_GPU_MEM=0.88"
    set "VLLM_MAX_LEN=8192"
    set "VLLM_DTYPE=auto"
    set "MODEL_LABEL=Mistral-7B-Instruct-v0.2"
)
if not defined VLLM_MODEL (
    set "VLLM_MODEL=TheBloke/Mistral-7B-Instruct-v0.2-AWQ"
    set "VLLM_GPU_MEM=0.85"
    set "VLLM_MAX_LEN=8192"
    set "VLLM_DTYPE=auto"
    set "MODEL_LABEL=Mistral-7B-AWQ"
)
echo  [OK] Using !MODEL_LABEL!

REM ── Step 8: Check HuggingFace cache for this model ────────────────────────────
echo.
echo  Checking HuggingFace cache for !VLLM_MODEL!...
set "HF_CACHE=%USERPROFILE%\.cache\huggingface"
set "MODEL_CACHED=0"
for /f "usebackq" %%d in (`dir /s /b "!HF_CACHE!" 2^>nul ^| findstr /i "Mistral"`) do set "MODEL_CACHED=1"
if "!MODEL_CACHED!"=="1" (
    echo  [OK] Mistral weights found in local cache.
) else (
    echo  [INFO] Mistral not in cache. Will download on first run (~14 GB fp16 / ~4.5 GB AWQ).
    echo         Keep internet connected. Use HF_TOKEN for faster access.
)
echo.

REM Optional HF token
set "HFT="
echo  HuggingFace token (optional — speeds up download, skip with Enter):
set /p HFT="HF_TOKEN (Enter to skip): "

REM ── Detect LAN IP ─────────────────────────────────────────────────────────────
set "WIP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress" 2^>nul`) do set "WIP=%%i"
if "!WIP!"=="" set "WIP=0.0.0.0"
echo  [OK] LAN IP: !WIP!

REM ── Save .env.worker ──────────────────────────────────────────────────────────
(
    echo MAC_MASTER_URL=!MASTER!
    echo MAC_ENROLL_TOKEN=!TOKEN!
    echo MAC_WORKER_NAME=!WNAME!
    echo MAC_WORKER_IP=!WIP!
    echo MAC_VLLM_PORT=8001
    echo MAC_HEARTBEAT_SEC=10
    echo MAC_ENGINE=vllm
    echo MAC_GPU_NAME=!GPU_NAME!
    echo MAC_GPU_VRAM_MB=!GPU_VRAM_MB!
    echo VLLM_PORT=8001
    echo VLLM_MODEL=!VLLM_MODEL!
    echo MAC_VLLM_MODEL=!VLLM_MODEL!
    echo VLLM_GPU_MEM=!VLLM_GPU_MEM!
    echo VLLM_MAX_LEN=!VLLM_MAX_LEN!
    echo VLLM_DTYPE=!VLLM_DTYPE!
    echo VLLM_SERVED_NAME=!VLLM_MODEL!
) > .env.worker
if not "!HFT!"=="" echo HF_TOKEN=!HFT!>> .env.worker
echo  [OK] Config saved to .env.worker.

REM ── Firewall ──────────────────────────────────────────────────────────────────
netsh advfirewall firewall delete rule name="MAC Worker vLLM" >nul 2>&1
netsh advfirewall firewall add rule name="MAC Worker vLLM" dir=in action=allow protocol=TCP localport=8001 profile=any >nul 2>&1
echo  [OK] Firewall port 8001 opened.

REM ── Start vLLM container ──────────────────────────────────────────────────────
echo.
echo  Starting Mistral-7B vLLM container...
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --remove-orphans
if errorlevel 1 (
    echo  [ERROR] Docker Compose failed.
    pause & exit /b 1
)
echo  [OK] vLLM container started.
echo  Model loading: first run ~5-15 min (download + load). Subsequent runs ~2 min.

REM ── Python check for worker agent ─────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo  Installing Python 3.11...
    winget install -e --id Python.Python.3.11 --accept-source-agreements --accept-package-agreements
    echo  Restart and rerun this script.
    pause & exit /b 0
)
python -c "import psutil" >nul 2>&1
if errorlevel 1 python -m pip install psutil -q

REM ── Start worker agent ────────────────────────────────────────────────────────
set "MAC_MASTER_URL=!MASTER!"
set "MAC_ENROLL_TOKEN=!TOKEN!"
set "MAC_WORKER_NAME=!WNAME!"
set "MAC_WORKER_IP=!WIP!"
set "MAC_VLLM_PORT=8001"
set "MAC_VLLM_MODEL=!VLLM_MODEL!"
set "MAC_GPU_NAME=!GPU_NAME!"
set "MAC_GPU_VRAM_MB=!GPU_VRAM_MB!"
set "MAC_HEARTBEAT_SEC=10"
set "MAC_ENGINE=vllm"

echo.
echo  ================================================================
echo   PC2 WORKER STARTING — !MODEL_LABEL!
echo.
echo   1. Open !MASTER! in browser
echo   2. Admin Panel ^> Cluster ^> Nodes
echo   3. Find "!WNAME!" and click Approve
echo   4. "!MODEL_LABEL!" then appears in the Chat model list
echo.
echo   This window = live agent log. Keep it open.
echo   vLLM container log: docker compose -f docker-compose.worker.yml logs -f
echo  ================================================================
echo.

python worker_agent.py
pause
