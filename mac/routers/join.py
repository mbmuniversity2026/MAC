"""Cluster join endpoints — downloadable worker setup files.

GET /api/v1/cluster/join/bat      → join-mac-cluster.bat (master URL embedded)
GET /api/v1/cluster/join/compose  → docker-compose.worker.yml
GET /api/v1/cluster/join/agent    → worker_agent.py
"""

from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import Response, FileResponse

router = APIRouter(prefix="/cluster/join", tags=["Cluster Join"])

_ROOT = Path(__file__).resolve().parent.parent.parent  # D:\mac


def _bat(master: str) -> str:
    return f"""@echo off
setlocal enabledelayedexpansion
title MAC — Join Cluster
set "MASTER={master}"
set "WORKDIR=%USERPROFILE%\\MAC-Worker"

echo.
echo  ===================================================
echo   MAC — MBM AI Cloud  ^|  Worker Node Setup
echo   MBM University, Jodhpur, Rajasthan
echo  ===================================================
echo.
echo  This PC will contribute its GPU to the MAC cluster.
echo  Master: !MASTER!
echo.

mkdir "!WORKDIR!" 2>nul
cd /d "!WORKDIR!"

REM ── Check Docker ─────────────────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    where docker >nul 2>&1
    if errorlevel 1 (
        echo [INFO] Docker not found. Installing Docker Desktop via winget...
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        echo.
        echo [ACTION] RESTART this PC to finish Docker setup, then run this script again.
        pause
        exit /b 0
    )
    echo [INFO] Starting Docker Desktop...
    start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"
    echo  Waiting 40s for Docker to start...
    timeout /t 40 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Docker is not ready. Open Docker Desktop manually and retry.
        pause
        exit /b 1
    )
)
echo [OK] Docker is running.
echo.

REM ── Download worker files from master ─────────────────────────────────────────
echo [INFO] Downloading worker files from !MASTER!...
curl -fsSL "!MASTER!/api/v1/cluster/join/compose" -o docker-compose.worker.yml 2>nul
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot reach !MASTER!
    echo         Make sure you are connected to the MBM campus WiFi/LAN.
    pause
    exit /b 1
)
curl -fsSL "!MASTER!/api/v1/cluster/join/agent" -o worker_agent.py 2>nul
echo [OK] Files downloaded to !WORKDIR!
echo.

REM ── Model selection ───────────────────────────────────────────────────────────
echo  Choose the AI model this GPU PC will serve:
echo.
echo    1.  Logic ^& Math        DeepSeek-R1-Distill-Llama-8B   (needs 8 GB+ VRAM)
echo    2.  Programming         Qwen2.5-Coder-7B-Instruct       (needs 8 GB+ VRAM)
echo    3.  General Chat        Qwen2.5-7B-Instruct-AWQ         (needs 5 GB+ VRAM)
echo    4.  General Education   Llama-3.1-8B-Instruct           (needs 8 GB+ VRAM)
echo    5.  Creative Writing    Mistral-7B-v0.3                 (needs 8 GB+ VRAM)
echo.
set /p "M=Choice [1-5, default 2]: "
if "!M!"=="" set "M=2"

if "!M!"=="1" (set "VM=deepseek-ai/DeepSeek-R1-Distill-Llama-8B" & set "GM=0.90" & set "ML=4096" & set "LB=DeepSeek-R1-Llama-8B")
if "!M!"=="2" (set "VM=Qwen/Qwen2.5-Coder-7B-Instruct"           & set "GM=0.90" & set "ML=8192" & set "LB=Qwen2.5-Coder-7B")
if "!M!"=="3" (set "VM=Qwen/Qwen2.5-7B-Instruct-AWQ"             & set "GM=0.85" & set "ML=4096" & set "LB=Qwen2.5-7B-AWQ")
if "!M!"=="4" (set "VM=meta-llama/Llama-3.1-8B-Instruct"         & set "GM=0.90" & set "ML=4096" & set "LB=Llama-3.1-8B")
if "!M!"=="5" (set "VM=mistralai/Mistral-7B-v0.3"                & set "GM=0.90" & set "ML=8192" & set "LB=Mistral-7B")
if not defined VM (set "VM=Qwen/Qwen2.5-Coder-7B-Instruct" & set "GM=0.90" & set "ML=8192" & set "LB=Qwen2.5-Coder-7B")
echo [OK] Model: !LB!
echo.

REM ── Config prompts ────────────────────────────────────────────────────────────
set /p "TOK=Enrollment token (Admin Panel → Cluster → Generate Token): "
if "!TOK!"=="" (echo [ERROR] Token is required. & pause & exit /b 1)

set /p "WN=Name for this PC [!COMPUTERNAME!]: "
if "!WN!"=="" set "WN=!COMPUTERNAME!"

set /p "HFT=HuggingFace token if model is gated [leave blank to skip]: "

REM ── Detect LAN IP ─────────────────────────────────────────────────────────────
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {{ $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Docker|Hyper-V' -and $_.IPAddress -ne '127.0.0.1' }} | Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress"`) do set "WIP=%%i"
if not defined WIP set "WIP=0.0.0.0"
echo [OK] Worker LAN IP: !WIP!
echo.

REM ── Write .env.worker ─────────────────────────────────────────────────────────
(
  echo MAC_MASTER_URL=!MASTER!
  echo MAC_ENROLL_TOKEN=!TOK!
  echo MAC_WORKER_NAME=!WN!
  echo MAC_WORKER_IP=!WIP!
  echo VLLM_PORT=8001
  echo MAC_VLLM_PORT=8001
  echo MAC_HEARTBEAT_SEC=10
  echo VLLM_MODEL=!VM!
  echo MAC_VLLM_MODEL=!VM!
  echo VLLM_GPU_MEM=!GM!
  echo VLLM_MAX_LEN=!ML!
) > .env.worker
if not "!HFT!"=="" echo HF_TOKEN=!HFT!>> .env.worker
echo [OK] Config saved to !WORKDIR!\\.env.worker
echo.

REM ── Firewall ──────────────────────────────────────────────────────────────────
netsh advfirewall firewall add rule name="MAC Worker vLLM" dir=in action=allow protocol=TCP localport=8001 profile=any >nul 2>&1
echo [OK] Firewall port 8001 opened.
echo.

REM ── Start containers ──────────────────────────────────────────────────────────
echo [INFO] Pulling vLLM image and starting containers...
echo        Model  : !LB! (!VM!)
echo        LAN IP : !WIP!:8001
echo.
echo  FIRST RUN downloads model weights from HuggingFace (~5-10 GB).
echo  Keep this window open — it will show live logs.
echo.
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --remove-orphans
if errorlevel 1 (
    echo [ERROR] Docker failed. Check Docker Desktop is fully started and retry.
    pause
    exit /b 1
)

echo.
echo  ===================================================
echo   Worker is starting!
echo.
echo   NEXT STEPS:
echo     1. Open !MASTER!
echo     2. Admin Panel → Cluster → Nodes
echo     3. Approve "!WN!" (appears within 30 seconds)
echo     4. "!LB!" shows up in the Chat model list
echo  ===================================================
echo.
docker compose -f docker-compose.worker.yml --env-file .env.worker logs -f --tail=80
"""


@router.get("/bat")
async def download_bat(request: Request):
    """Generate and download join-mac-cluster.bat with this server's URL embedded."""
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    if host:
        master = f"{scheme}://{host}"
    else:
        master = str(request.base_url).rstrip("/")
    content = _bat(master)
    return Response(
        content=content.encode("utf-8"),
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="join-mac-cluster.bat"'},
    )


@router.get("/compose")
async def download_compose():
    """Serve docker-compose.worker.yml for worker PCs to download."""
    path = _ROOT / "docker-compose.worker.yml"
    return FileResponse(path, filename="docker-compose.worker.yml", media_type="text/plain")


@router.get("/agent")
async def download_agent():
    """Serve worker_agent.py for worker PCs to download."""
    path = _ROOT / "worker_agent.py"
    return FileResponse(path, filename="worker_agent.py", media_type="text/plain")


@router.get("/setup")
async def download_setup_bat():
    """Serve setup-worker.bat — the one-click worker setup script."""
    path = _ROOT / "setup-worker.bat"
    return FileResponse(
        path,
        filename="setup-worker.bat",
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="setup-worker.bat"'},
    )
