@echo off
setlocal enabledelayedexpansion
title MAC Worker Setup — MBM AI Cloud
cd /d "%~dp0"

echo.
echo  ======================================================
echo   MAC WORKER SETUP — MBM AI Cloud
echo   MBM University, Jodhpur, Rajasthan
echo   This PC will contribute its GPU to the campus cluster
echo  ======================================================
echo.

REM ============================================================
REM STEP 1 — Docker check
REM ============================================================
echo [1/9] Checking Docker Desktop...
docker info >nul 2>&1
if errorlevel 1 (
    where docker >nul 2>&1
    if errorlevel 1 (
        echo  Docker not installed. Installing via winget...
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        echo.
        echo  *** RESTART your PC, then run setup-worker.bat again. ***
        pause
        exit /b 0
    )
    echo  Docker found but not running. Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
    echo  Waiting 40 seconds for Docker to start...
    timeout /t 40 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Docker still not ready. Open Docker Desktop manually and retry.
        pause
        exit /b 1
    )
)
echo  [OK] Docker is running.
echo.

REM ============================================================
REM STEP 2 — Detect GPU (on host, before Docker)
REM ============================================================
echo [2/9] Detecting GPU...
set "GPU_NAME=CPU-only"
set "GPU_VRAM_MB=0"
set "HAS_NVIDIA=0"

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits >"%TEMP%\macgpu.tmp" 2>nul
if not errorlevel 1 (
    for /f "tokens=1,* delims=," %%a in ('type "%TEMP%\macgpu.tmp"') do (
        if "!HAS_NVIDIA!"=="0" (
            set "GPU_NAME=%%a"
            set /a "GPU_VRAM_MB=%%b" 2>nul
            set "HAS_NVIDIA=1"
        )
    )
    del "%TEMP%\macgpu.tmp" >nul 2>&1
    echo  [OK] GPU: !GPU_NAME! — !GPU_VRAM_MB! MB VRAM
    echo  INFO: GPU Docker support required for vLLM.
    echo        Docker Desktop ^> Settings ^> Resources ^> Enable GPU (WSL2 backend)
) else (
    del "%TEMP%\macgpu.tmp" >nul 2>&1
    echo  [INFO] No NVIDIA GPU detected. Will use Ollama on CPU.
)
echo.

REM ============================================================
REM STEP 3 — MAC server URL
REM ============================================================
echo [3/9] MAC Control Node address
echo  (The IP of the main MAC server PC, same campus WiFi)
echo  Example: http://192.168.1.34
echo.
set "MASTER="
set /p MASTER="MAC server URL (http://...): "
if "!MASTER!"=="" (
    echo  [ERROR] Server URL is required.
    pause
    exit /b 1
)
REM Strip trailing slash
if "!MASTER:~-1!"=="/" set "MASTER=!MASTER:~0,-1!"
echo  [OK] Control node: !MASTER!
echo.

REM ============================================================
REM STEP 4 — Download worker files
REM ============================================================
echo [4/9] Downloading worker files from !MASTER!...
curl -f -k -L --retry 3 -o docker-compose.worker.yml "!MASTER!/api/v1/cluster/join/compose" 2>nul
if errorlevel 1 (
    echo.
    echo  [ERROR] Cannot reach !MASTER!
    echo  Check:
    echo    - Connected to same WiFi as the MAC server?
    echo    - MAC server running? (run start-mac.bat on that PC)
    echo    - Try: curl -k "!MASTER!/api/v1/explore/health"
    echo.
    pause
    exit /b 1
)
curl -f -k -L --retry 3 -o worker_agent.py "!MASTER!/api/v1/cluster/join/agent" 2>nul
if errorlevel 1 (
    echo  [ERROR] Failed to download worker_agent.py
    pause
    exit /b 1
)
echo  [OK] Files downloaded.
echo.

REM ============================================================
REM STEP 5 — Enrollment token
REM ============================================================
echo [5/9] Enrollment Token
echo  1. Open !MASTER! in a browser
echo  2. Log in as Admin
echo  3. Go to Admin Panel ^> Cluster ^> Generate Token
echo  4. Copy the token and paste it below
echo.
set "TOKEN="
set /p TOKEN="Enrollment token: "
if "!TOKEN!"=="" (
    echo  [ERROR] Token cannot be empty.
    pause
    exit /b 1
)
echo  [OK] Token received.
echo.

REM ============================================================
REM STEP 6 — Worker name
REM ============================================================
echo [6/9] Worker name (shown in Admin Panel)
set "WNAME="
set /p WNAME="Name for this PC (Enter to use %COMPUTERNAME%): "
if "!WNAME!"=="" set "WNAME=%COMPUTERNAME%"
echo  [OK] Name: !WNAME!
echo.

REM ============================================================
REM STEP 7 — Model selection
REM ============================================================
echo [7/9] Choose AI model this PC will serve
echo.
if "!HAS_NVIDIA!"=="1" (
    echo  GPU detected: !GPU_NAME! ^(!GPU_VRAM_MB! MB^)
    echo  Running via vLLM in Docker ^(NVIDIA GPU^)
    echo.
    echo   1  Qwen2.5-Coder-7B-AWQ    Programming / Code     ^(8 GB VRAM^)
    echo   2  DeepSeek-R1-7B           Logic and Math         ^(8 GB VRAM^)
    echo   3  Qwen2.5-7B-AWQ           General Chat           ^(5 GB VRAM^)
    echo   4  Llama-3.1-8B             General Education      ^(8 GB VRAM^)
    echo   5  Mistral-7B               Creative Writing       ^(8 GB VRAM^)
) else (
    echo  No NVIDIA GPU. Running via Ollama on CPU.
    echo.
    echo   1  qwen2.5:3b         Fast general chat   ^(CPU, ~2 GB RAM^)
    echo   2  qwen2.5-coder:3b   Code assistant      ^(CPU, ~2 GB RAM^)
    echo   3  tinyllama           Ultra-light         ^(CPU, ~600 MB RAM^)
    echo   4  mistral:7b          General use         ^(CPU, ~5 GB RAM^)
    echo   5  qwen2.5:7b          Full chat           ^(CPU, ~5 GB RAM^)
)
echo.
set "M="
set /p M="Choice (1-5, Enter for 1): "
if "!M!"=="" set "M=1"

if "!HAS_NVIDIA!"=="1" (
    set "ENGINE=vllm"
    set "WPORT=8001"
    if "!M!"=="1" (set "VM=Qwen/Qwen2.5-Coder-7B-Instruct-AWQ"        & set "GM=0.88" & set "ML=8192" & set "LB=Qwen2.5-Coder-7B-AWQ")
    if "!M!"=="2" (set "VM=deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"   & set "GM=0.88" & set "ML=4096" & set "LB=DeepSeek-R1-7B")
    if "!M!"=="3" (set "VM=Qwen/Qwen2.5-7B-Instruct-AWQ"              & set "GM=0.85" & set "ML=4096" & set "LB=Qwen2.5-7B-AWQ")
    if "!M!"=="4" (set "VM=meta-llama/Llama-3.1-8B-Instruct"          & set "GM=0.88" & set "ML=4096" & set "LB=Llama-3.1-8B")
    if "!M!"=="5" (set "VM=mistralai/Mistral-7B-Instruct-v0.3"        & set "GM=0.88" & set "ML=8192" & set "LB=Mistral-7B")
    if not defined VM (set "VM=Qwen/Qwen2.5-Coder-7B-Instruct-AWQ" & set "GM=0.88" & set "ML=8192" & set "LB=Qwen2.5-Coder-7B-AWQ")
) else (
    set "ENGINE=ollama"
    set "WPORT=11434"
    if "!M!"=="1" (set "VM=qwen2.5:3b"        & set "LB=Qwen2.5-3B")
    if "!M!"=="2" (set "VM=qwen2.5-coder:3b"  & set "LB=Qwen2.5-Coder-3B")
    if "!M!"=="3" (set "VM=tinyllama"          & set "LB=TinyLlama")
    if "!M!"=="4" (set "VM=mistral:7b"         & set "LB=Mistral-7B-CPU")
    if "!M!"=="5" (set "VM=qwen2.5:7b"         & set "LB=Qwen2.5-7B-CPU")
    if not defined VM (set "VM=qwen2.5:3b" & set "LB=Qwen2.5-3B")
)
echo  [OK] Model: !LB! via !ENGINE!
echo.

REM HuggingFace token (vLLM only, for gated models like Llama)
set "HFT="
if "!ENGINE!"=="vllm" (
    echo  HuggingFace token ^(only needed for Llama — skip for Qwen/DeepSeek/Mistral^)
    set /p HFT="HF token (Enter to skip): "
    echo.
)

REM ============================================================
REM STEP 8 — Detect LAN IP and save config
REM ============================================================
echo [8/9] Detecting LAN IP and saving config...

set "WIP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress" 2^>nul`) do set "WIP=%%i"
if "!WIP!"=="" set "WIP=0.0.0.0"
echo  [OK] LAN IP: !WIP!

(
    echo MAC_MASTER_URL=!MASTER!
    echo MAC_ENROLL_TOKEN=!TOKEN!
    echo MAC_WORKER_NAME=!WNAME!
    echo MAC_WORKER_IP=!WIP!
    echo MAC_VLLM_PORT=!WPORT!
    echo MAC_HEARTBEAT_SEC=10
    echo MAC_ENGINE=!ENGINE!
    echo MAC_GPU_NAME=!GPU_NAME!
    echo MAC_GPU_VRAM_MB=!GPU_VRAM_MB!
    echo VLLM_PORT=!WPORT!
    echo VLLM_MODEL=!VM!
    echo MAC_VLLM_MODEL=!VM!
    echo VLLM_GPU_MEM=!GM!
    echo VLLM_MAX_LEN=!ML!
) > .env.worker
if not "!HFT!"=="" echo HF_TOKEN=!HFT!>> .env.worker
echo  [OK] Config saved to .env.worker

REM Open firewall for inference port
netsh advfirewall firewall delete rule name="MAC Worker vLLM" >nul 2>&1
netsh advfirewall firewall add rule name="MAC Worker vLLM" dir=in action=allow protocol=TCP localport=!WPORT! profile=any >nul 2>&1
echo  [OK] Firewall port !WPORT! opened.
echo.

REM ============================================================
REM STEP 9 — Start inference engine + worker agent
REM ============================================================
echo [9/9] Starting services...
echo.

if "!ENGINE!"=="ollama" (
    REM ── Ollama path: native Windows, no Docker GPU needed ────────────────────
    echo  Using Ollama ^(CPU/GPU native^)...
    where ollama >nul 2>&1
    if errorlevel 1 (
        echo  Ollama not installed. Installing via winget...
        winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
        echo  Waiting 15s for Ollama service to start...
        timeout /t 15 /nobreak >nul
    )
    echo  Pulling model !VM! ^(first run downloads model, may take minutes^)...
    ollama pull !VM!
    if errorlevel 1 (
        echo  [ERROR] Failed to pull model. Check internet and try: ollama pull !VM!
        pause
        exit /b 1
    )
    echo  [OK] Model !VM! ready on Ollama port 11434.
) else (
    REM ── vLLM path: Docker GPU ─────────────────────────────────────────────────
    echo  Starting vLLM in Docker ^(GPU^)...
    echo  Model: !LB! ^(!VM!^)
    echo.

    REM Quick GPU-in-Docker test
    docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi >nul 2>&1
    if errorlevel 1 (
        echo  [WARN] GPU is not accessible inside Docker containers.
        echo.
        echo  To fix: Docker Desktop ^> Settings ^> General
        echo    - Enable "Use WSL 2 based engine"
        echo  Then:   Docker Desktop ^> Settings ^> Resources
        echo    - Enable "GPU"
        echo  Then restart Docker Desktop and run this script again.
        echo.
        echo  Alternatively press Enter to continue without GPU
        echo  ^(vLLM will fail, but worker-agent will still register^)
        pause
    )

    docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --remove-orphans
    if errorlevel 1 (
        echo  [ERROR] Docker Compose failed. Check errors above.
        echo  Common fix: Docker Desktop ^> Settings ^> Resources ^> Enable GPU
        pause
        exit /b 1
    )
    echo  [OK] vLLM container started.
    echo  First run: downloads model weights from HuggingFace ^(5-15 min^).
)

echo.
echo  Starting worker agent ^(this window^)...
echo.

REM Set env vars for worker_agent.py
set "MAC_MASTER_URL=!MASTER!"
set "MAC_ENROLL_TOKEN=!TOKEN!"
set "MAC_WORKER_NAME=!WNAME!"
set "MAC_WORKER_IP=!WIP!"
set "MAC_VLLM_PORT=!WPORT!"
set "MAC_VLLM_MODEL=!VM!"
set "MAC_GPU_NAME=!GPU_NAME!"
set "MAC_GPU_VRAM_MB=!GPU_VRAM_MB!"
set "MAC_HEARTBEAT_SEC=10"
set "MAC_ENGINE=!ENGINE!"

REM Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo  Python not found. Installing via winget...
    winget install -e --id Python.Python.3.11 --accept-source-agreements --accept-package-agreements
    echo  Restart needed. Rerun this script after restart.
    pause
    exit /b 0
)

REM Install psutil if missing (for RAM metrics)
python -c "import psutil" >nul 2>&1
if errorlevel 1 (
    echo  Installing psutil...
    python -m pip install psutil -q
)

echo.
echo  ======================================================
echo   WORKER STARTING — !LB! via !ENGINE!
echo.
echo   ADMIN ACTION REQUIRED:
echo     1. Open !MASTER!
echo     2. Admin Panel ^> Cluster ^> Nodes
echo     3. Find "!WNAME!" and click Approve
echo     4. "!LB!" appears in the Chat model list
echo.
echo   After approval, requests route here automatically.
echo   This window shows live heartbeat status.
echo   Close this window to stop the worker agent.
echo  ======================================================
echo.

python worker_agent.py

pause
