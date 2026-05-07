@echo off
setlocal enabledelayedexpansion
title MAC Worker Setup — MBM AI Cloud
cd /d "%~dp0"

echo.
echo  ======================================================
echo   MAC WORKER SETUP — MBM AI Cloud
echo   MBM University, Jodhpur, Rajasthan
echo  ======================================================
echo.

REM ============================================================
REM STEP 1 — Docker
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
        pause & exit /b 0
    )
    echo  Docker found but not running. Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
    echo  Waiting 40 seconds...
    timeout /t 40 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Docker still not ready. Open Docker Desktop manually then retry.
        pause & exit /b 1
    )
)
echo  [OK] Docker is running.
echo.

REM ============================================================
REM STEP 2 — GPU detection  (usebackq backtick = no quote conflict)
REM ============================================================
echo [2/9] Detecting GPU...
set "GPU_NAME=CPU-only"
set "GPU_VRAM_MB=0"
set "HAS_NVIDIA=0"

for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=name --format=csv,noheader 2^>nul`) do (
    if "!GPU_NAME!"=="CPU-only" (
        set "GPU_NAME=%%a"
        set "HAS_NVIDIA=1"
    )
)
if "!HAS_NVIDIA!"=="1" (
    for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2^>nul`) do (
        if "!GPU_VRAM_MB!"=="0" set /a "GPU_VRAM_MB=%%a"
    )
    echo  [OK] GPU: !GPU_NAME! ^(!GPU_VRAM_MB! MB VRAM^)
    echo  NOTE: Docker GPU support required for vLLM.
    echo        Docker Desktop ^> Settings ^> Resources ^> Enable GPU ^(WSL2 backend^)
) else (
    echo  [INFO] No NVIDIA GPU detected — will use Ollama on CPU.
)
echo.

REM ============================================================
REM STEP 3 — MAC server URL
REM ============================================================
echo [3/9] MAC Control Node address
echo  Same campus WiFi as this PC. Example: http://192.168.1.34
echo.
set "MASTER="
set /p MASTER="MAC server URL (http://...): "
if "!MASTER!"=="" (echo  [ERROR] URL required. & pause & exit /b 1)
if "!MASTER:~-1!"=="/" set "MASTER=!MASTER:~0,-1!"
echo  [OK] !MASTER!
echo.

REM ============================================================
REM STEP 4 — Download worker files
REM Try port 80 (nginx) first, fallback to port 8000 (FastAPI direct)
REM ============================================================
echo [4/9] Downloading worker files...

set "MASTER_API=!MASTER!"
curl -f -k -L --connect-timeout 10 --retry 2 -o docker-compose.worker.yml "!MASTER_API!/api/v1/cluster/join/compose" 2>nul
if errorlevel 1 (
    echo  Port 80 failed — trying port 8000 directly...
    set "MASTER_API=!MASTER!:8000"
    curl -f -k -L --connect-timeout 10 --retry 2 -o docker-compose.worker.yml "!MASTER_API!/api/v1/cluster/join/compose" 2>nul
    if errorlevel 1 (
        echo.
        echo  [ERROR] Cannot reach MAC server at !MASTER! or !MASTER!:8000
        echo.
        echo  Checklist:
        echo    1. Is this PC on the SAME WiFi as the MAC server?
        echo    2. Is the MAC server running? ^(start-mac.bat on that PC^)
        echo    3. Is the URL correct? You entered: !MASTER!
        echo    4. Manual test: open a browser and go to:
        echo         !MASTER!/api/v1/explore/health
        echo         !MASTER!:8000/api/v1/explore/health
        echo.
        ping -n 2 !MASTER:http://=! 2>nul
        echo.
        pause & exit /b 1
    )
    echo  [OK] Connected via port 8000.
)

curl -f -k -L --connect-timeout 10 --retry 2 -o worker_agent.py "!MASTER_API!/api/v1/cluster/join/agent" 2>nul
if errorlevel 1 (
    echo  [ERROR] Failed to download worker_agent.py
    pause & exit /b 1
)
echo  [OK] Files downloaded from !MASTER_API!
echo.

REM ============================================================
REM STEP 5 — Enrollment token
REM ============================================================
echo [5/9] Enrollment Token
echo  1. Open  !MASTER!  in a browser
echo  2. Log in as Admin
echo  3. Admin Panel ^> Cluster ^> Generate Token
echo  4. Copy the token and paste below
echo.
set "TOKEN="
set /p TOKEN="Enrollment token: "
if "!TOKEN!"=="" (echo  [ERROR] Token required. & pause & exit /b 1)
echo  [OK] Token received.
echo.

REM ============================================================
REM STEP 6 — Worker name
REM ============================================================
echo [6/9] Worker name
set "WNAME="
set /p WNAME="Name for this PC (Enter = %COMPUTERNAME%): "
if "!WNAME!"=="" set "WNAME=%COMPUTERNAME%"
echo  [OK] !WNAME!
echo.

REM ============================================================
REM STEP 7 — Model selection
REM ============================================================
echo [7/9] AI model this PC will serve
echo.
if "!HAS_NVIDIA!"=="1" (
    echo  NVIDIA GPU detected: !GPU_NAME! ^(!GPU_VRAM_MB! MB^)
    echo  Running via vLLM in Docker ^(GPU accelerated^)
    echo.
    echo   1  Qwen2.5-Coder-7B-AWQ    Programming / Code      ^(8 GB VRAM^)
    echo   2  DeepSeek-R1-7B           Logic and Math          ^(8 GB VRAM^)
    echo   3  Qwen2.5-7B-AWQ           General Chat            ^(5 GB VRAM^)
    echo   4  Llama-3.1-8B             General Education       ^(8 GB VRAM^)
    echo   5  Mistral-7B               Creative Writing        ^(8 GB VRAM^)
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
set /p M="Choice (1-5, Enter = 1): "
if "!M!"=="" set "M=1"

if "!HAS_NVIDIA!"=="1" (
    set "ENGINE=vllm" & set "WPORT=8001"
    if "!M!"=="1" (set "VM=Qwen/Qwen2.5-Coder-7B-Instruct-AWQ"        & set "GM=0.88" & set "ML=8192" & set "LB=Qwen2.5-Coder-7B-AWQ")
    if "!M!"=="2" (set "VM=deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"   & set "GM=0.88" & set "ML=4096" & set "LB=DeepSeek-R1-7B")
    if "!M!"=="3" (set "VM=Qwen/Qwen2.5-7B-Instruct-AWQ"              & set "GM=0.85" & set "ML=4096" & set "LB=Qwen2.5-7B-AWQ")
    if "!M!"=="4" (set "VM=meta-llama/Llama-3.1-8B-Instruct"          & set "GM=0.88" & set "ML=4096" & set "LB=Llama-3.1-8B")
    if "!M!"=="5" (set "VM=mistralai/Mistral-7B-Instruct-v0.3"        & set "GM=0.88" & set "ML=8192" & set "LB=Mistral-7B")
    if not defined VM (set "VM=Qwen/Qwen2.5-Coder-7B-Instruct-AWQ" & set "GM=0.88" & set "ML=8192" & set "LB=Qwen2.5-Coder-7B-AWQ")
) else (
    set "ENGINE=ollama" & set "WPORT=11434"
    if "!M!"=="1" (set "VM=qwen2.5:3b"        & set "LB=Qwen2.5-3B-CPU")
    if "!M!"=="2" (set "VM=qwen2.5-coder:3b"  & set "LB=Qwen2.5-Coder-3B-CPU")
    if "!M!"=="3" (set "VM=tinyllama"          & set "LB=TinyLlama-CPU")
    if "!M!"=="4" (set "VM=mistral:7b"         & set "LB=Mistral-7B-CPU")
    if "!M!"=="5" (set "VM=qwen2.5:7b"         & set "LB=Qwen2.5-7B-CPU")
    if not defined VM (set "VM=qwen2.5:3b" & set "LB=Qwen2.5-3B-CPU")
)
echo  [OK] !LB! via !ENGINE!
echo.

set "HFT="
if "!ENGINE!"=="vllm" (
    echo  HuggingFace token ^(only for Llama gated model, skip for Qwen/DeepSeek/Mistral^)
    set /p HFT="HF token (Enter to skip): "
    echo.
)

REM ============================================================
REM STEP 8 — LAN IP + save config
REM ============================================================
echo [8/9] Config...

set "WIP="
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' } | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress" 2^>nul`) do set "WIP=%%i"
if "!WIP!"=="" set "WIP=0.0.0.0"
echo  LAN IP: !WIP!

(
    echo MAC_MASTER_URL=!MASTER_API!
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
echo  Config saved.

netsh advfirewall firewall delete rule name="MAC Worker vLLM" >nul 2>&1
netsh advfirewall firewall add rule name="MAC Worker vLLM" dir=in action=allow protocol=TCP localport=!WPORT! profile=any >nul 2>&1
echo  Firewall port !WPORT! opened.
echo.

REM ============================================================
REM STEP 9 — Start inference engine + worker agent
REM ============================================================
echo [9/9] Starting services...
echo.

if "!ENGINE!"=="ollama" (
    where ollama >nul 2>&1
    if errorlevel 1 (
        echo  Installing Ollama ^(no Docker GPU needed^)...
        winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
        timeout /t 15 /nobreak >nul
    )
    echo  Pulling model !VM!...
    ollama pull !VM!
    if errorlevel 1 (
        echo  [ERROR] Model pull failed. Try manually: ollama pull !VM!
        pause & exit /b 1
    )
    echo  [OK] Model ready on port 11434.
) else (
    echo  Starting vLLM container ^(GPU^)...
    docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi >nul 2>&1
    if errorlevel 1 (
        echo  [WARN] GPU not accessible inside Docker containers.
        echo  Fix: Docker Desktop ^> Settings ^> General ^> Use WSL2 backend
        echo       Docker Desktop ^> Settings ^> Resources ^> Enable GPU
        echo  Then restart Docker Desktop and re-run this script.
        echo.
        echo  Press Enter to continue anyway ^(agent will register, vLLM may fail^)
        echo  or Ctrl+C to cancel and fix Docker GPU first.
        pause
    )
    docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --remove-orphans
    if errorlevel 1 (
        echo  [ERROR] Docker Compose failed. Check Docker Desktop is running.
        pause & exit /b 1
    )
    echo  [OK] vLLM container started.
    echo  First run downloads model weights from HuggingFace ^(5-15 min^).
)

echo.
echo  Checking Python for worker agent...
python --version >nul 2>&1
if errorlevel 1 (
    echo  Python not found — installing...
    winget install -e --id Python.Python.3.11 --accept-source-agreements --accept-package-agreements
    echo  Restart and re-run script.
    pause & exit /b 0
)
python -c "import psutil" >nul 2>&1
if errorlevel 1 python -m pip install psutil -q

REM Set env vars then run worker agent
set "MAC_MASTER_URL=!MASTER_API!"
set "MAC_ENROLL_TOKEN=!TOKEN!"
set "MAC_WORKER_NAME=!WNAME!"
set "MAC_WORKER_IP=!WIP!"
set "MAC_VLLM_PORT=!WPORT!"
set "MAC_VLLM_MODEL=!VM!"
set "MAC_GPU_NAME=!GPU_NAME!"
set "MAC_GPU_VRAM_MB=!GPU_VRAM_MB!"
set "MAC_HEARTBEAT_SEC=10"
set "MAC_ENGINE=!ENGINE!"

echo.
echo  ======================================================
echo   WORKER STARTING — !LB!
echo.
echo   Next: Open !MASTER!
echo         Admin Panel ^> Cluster ^> Nodes
echo         Find "!WNAME!" and click Approve
echo         "!LB!" then appears in the Chat model list
echo.
echo   This window = live agent log. Keep it open.
echo   Close to stop worker agent.
echo  ======================================================
echo.

python worker_agent.py
pause
