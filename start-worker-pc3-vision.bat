@echo off
setlocal enabledelayedexpansion
title MAC — PC3 WORKER (Vision AI — Image Analysis)
cd /d "%~dp0"

echo.
echo  ================================================================
echo   MAC — MBM AI Cloud
echo   PC3: WORKER NODE — Vision/Image AI
echo   Role: Image analysis, document scanning, visual Q&A,
echo         copy-check (plagiarism via image), diagram explanation
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
        echo  [WARN] Vision models need 8+ GB VRAM. Your GPU has !GPU_VRAM_MB! MB.
        echo         Consider Moondream2 (2B, 2 GB VRAM) — select option 3 below.
        echo.
    )
) else (
    echo  [ERROR] No NVIDIA GPU detected. Vision inference requires a GPU.
    pause & exit /b 1
)

REM ── Step 3: Verify Docker GPU access ─────────────────────────────────────────
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [WARN] GPU found but Docker cannot access it.
    echo         Fix: Docker Desktop ^> Settings ^> General ^> Use WSL2 backend
    echo              Docker Desktop ^> Settings ^> Resources ^> Enable GPU (WSL2)
    echo.
    pause & exit /b 1
)
echo  [OK] GPU accessible inside Docker.

REM ── Step 4: Get PC1 host URL ──────────────────────────────────────────────────
echo.
echo [4/8] MAC Control Node (PC1) address
set "MASTER="
set /p MASTER="PC1 URL (http://...): "
if "!MASTER!"=="" (echo  [ERROR] URL required. & pause & exit /b 1)
if "!MASTER:~-1!"=="/" set "MASTER=!MASTER:~0,-1!"
echo  [OK] !MASTER!

REM ── Step 5: Enrollment token ─────────────────────────────────────────────────
echo.
echo [5/8] Enrollment Token (Admin Panel ^> Cluster ^> Generate Token on PC1)
set "TOKEN="
set /p TOKEN="Enrollment token: "
if "!TOKEN!"=="" (echo  [ERROR] Token required. & pause & exit /b 1)

REM ── Step 6: Worker name ───────────────────────────────────────────────────────
set "WNAME="
set /p WNAME="Worker name (Enter = %COMPUTERNAME%-Vision): "
if "!WNAME!"=="" set "WNAME=%COMPUTERNAME%-Vision"

REM ── Step 7: Vision model selection ───────────────────────────────────────────
echo.
echo [7/8] Vision model (all support image + text input)
echo.
echo   1  Qwen/Qwen2-VL-7B-Instruct          Best accuracy  ~8 GB VRAM  (recommended)
echo   2  Qwen/Qwen2-VL-2B-Instruct          Light / fast   ~4 GB VRAM
echo   3  vikhyatk/moondream2                 Tiny / fast    ~2 GB VRAM  (low VRAM PCs)
echo   4  llava-hf/llava-v1.6-mistral-7b-hf  LLaVA 7B       ~8 GB VRAM
echo   5  openbmb/MiniCPM-V-2_6              MiniCPM 8B     ~8 GB VRAM
echo.
set "VM_CHOICE="
set /p VM_CHOICE="Choice (1-5, Enter = 1): "
if "!VM_CHOICE!"=="" set "VM_CHOICE=1"

if "!VM_CHOICE!"=="1" (
    set "VLLM_MODEL=Qwen/Qwen2-VL-7B-Instruct"
    set "VLLM_GPU_MEM=0.85"
    set "VLLM_MAX_LEN=4096"
    set "VLLM_DTYPE=bfloat16"
    set "MODEL_LABEL=Qwen2-VL-7B"
)
if "!VM_CHOICE!"=="2" (
    set "VLLM_MODEL=Qwen/Qwen2-VL-2B-Instruct"
    set "VLLM_GPU_MEM=0.80"
    set "VLLM_MAX_LEN=4096"
    set "VLLM_DTYPE=bfloat16"
    set "MODEL_LABEL=Qwen2-VL-2B"
)
if "!VM_CHOICE!"=="3" (
    set "VLLM_MODEL=vikhyatk/moondream2"
    set "VLLM_GPU_MEM=0.75"
    set "VLLM_MAX_LEN=2048"
    set "VLLM_DTYPE=float16"
    set "MODEL_LABEL=Moondream2"
)
if "!VM_CHOICE!"=="4" (
    set "VLLM_MODEL=llava-hf/llava-v1.6-mistral-7b-hf"
    set "VLLM_GPU_MEM=0.88"
    set "VLLM_MAX_LEN=4096"
    set "VLLM_DTYPE=float16"
    set "MODEL_LABEL=LLaVA-1.6-Mistral-7B"
)
if "!VM_CHOICE!"=="5" (
    set "VLLM_MODEL=openbmb/MiniCPM-V-2_6"
    set "VLLM_GPU_MEM=0.85"
    set "VLLM_MAX_LEN=4096"
    set "VLLM_DTYPE=bfloat16"
    set "MODEL_LABEL=MiniCPM-V-2.6"
)
if not defined VLLM_MODEL (
    set "VLLM_MODEL=Qwen/Qwen2-VL-7B-Instruct"
    set "VLLM_GPU_MEM=0.85"
    set "VLLM_MAX_LEN=4096"
    set "VLLM_DTYPE=bfloat16"
    set "MODEL_LABEL=Qwen2-VL-7B"
)
echo  [OK] Using !MODEL_LABEL!

REM ── Step 8: HuggingFace cache check ──────────────────────────────────────────
echo.
echo  Checking HuggingFace cache...
set "HF_CACHE=%USERPROFILE%\.cache\huggingface"
set "MODEL_CACHED=0"
for /f "usebackq" %%d in (`dir /s /b "!HF_CACHE!" 2^>nul ^| findstr /i "Qwen2-VL"`) do set "MODEL_CACHED=1"
if "!MODEL_CACHED!"=="1" (
    echo  [OK] Vision model weights found in cache.
) else (
    echo  [INFO] Vision model not in cache. Will download on first run (~14-16 GB).
)

REM Optional HF token
set "HFT="
echo.
echo  HuggingFace token (optional, speeds up download):
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

netsh advfirewall firewall delete rule name="MAC Worker vLLM" >nul 2>&1
netsh advfirewall firewall add rule name="MAC Worker vLLM" dir=in action=allow protocol=TCP localport=8001 profile=any >nul 2>&1
echo  [OK] Firewall port 8001 opened.

REM ── Start vLLM container ──────────────────────────────────────────────────────
echo.
echo  Starting !MODEL_LABEL! vLLM container...
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --remove-orphans
if errorlevel 1 (echo  [ERROR] Docker Compose failed. & pause & exit /b 1)
echo  [OK] vLLM container started.
echo  Model loading: first run ~5-20 min (download + load). Subsequent runs ~2-3 min.

REM ── Python check ─────────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    winget install -e --id Python.Python.3.11 --accept-source-agreements --accept-package-agreements
    echo  Restart and rerun. & pause & exit /b 0
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
echo   PC3 VISION WORKER STARTING — !MODEL_LABEL!
echo.
echo   This PC handles: image Q&A, document analysis, vision chat,
echo                    copy-check scanning, diagram explanation.
echo.
echo   1. Open !MASTER! in browser
echo   2. Admin Panel ^> Cluster ^> Nodes
echo   3. Find "!WNAME!" and click Approve
echo   4. Vision model appears in Chat (use image upload button)
echo.
echo   vLLM log: docker compose -f docker-compose.worker.yml logs -f
echo  ================================================================
echo.

python worker_agent.py
pause
