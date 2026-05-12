@echo off
setlocal enabledelayedexpansion
title MAC MOST — GPU Diagnostic
cd /d "%~dp0"

echo.
echo  ================================================================
echo   MAC MOST — GPU DIAGNOSTIC TOOL
echo   MBM University, Jodhpur, Rajasthan, India
echo  ================================================================
echo.

REM ── Check nvidia-smi ─────────────────────────────────────────────────────────
echo [1/5] Checking NVIDIA driver (nvidia-smi)...
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo  [FAIL] nvidia-smi not found.
    echo         Either no NVIDIA GPU is installed, or the driver is not installed.
    echo.
    echo  FIX: Download NVIDIA driver from https://www.nvidia.com/Download/index.aspx
    echo       Install and restart, then rerun this test.
    goto :docker_check
)
echo  [PASS] NVIDIA driver found.

REM ── GPU details ───────────────────────────────────────────────────────────────
echo.
echo [2/5] GPU Details:
echo  ┌────────────────────────────────────────────────────────────────┐
nvidia-smi --query-gpu=index,name,memory.total,driver_version,compute_cap,temperature.gpu,power.draw --format=csv,noheader 2>nul | (
    set /p LINE=
    echo   GPU 0: !LINE!
)
echo  └────────────────────────────────────────────────────────────────┘
echo.

REM Full nvidia-smi summary
echo  Full nvidia-smi output:
nvidia-smi
echo.

REM ── VRAM check for Qwen2.5-7B-AWQ ────────────────────────────────────────────
echo [3/5] VRAM check for Qwen2.5-7B-AWQ (~5 GB required)...
set "GPU_VRAM_MB=0"
for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2^>nul`) do (
    if "!GPU_VRAM_MB!"=="0" set /a "GPU_VRAM_MB=%%a"
)
set /a "GPU_VRAM_GB=!GPU_VRAM_MB! / 1024"
echo   Total VRAM: !GPU_VRAM_MB! MB (~!GPU_VRAM_GB! GB)
if !GPU_VRAM_MB! GEQ 5000 (
    echo  [PASS] Enough VRAM for Qwen2.5-7B-AWQ (needs ~5 GB).
) else (
    echo  [WARN] Low VRAM (!GPU_VRAM_MB! MB). Qwen2.5-7B-AWQ needs ~5 GB.
    echo         Consider: Qwen2.5-3B-AWQ (~3 GB) or use worker PCs for LLM.
)

REM ── Docker check ──────────────────────────────────────────────────────────────
:docker_check
echo.
echo [4/5] Docker GPU passthrough test...
docker info >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Docker not running. Cannot test GPU passthrough.
    echo         Start Docker Desktop and rerun this test.
    goto :cuda_test
)

echo   Running: docker run --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>nul
if errorlevel 1 (
    echo.
    echo  [FAIL] Docker cannot access the GPU.
    echo.
    echo  FIX (Docker Desktop):
    echo    1. Open Docker Desktop
    echo    2. Settings ^> General ^> Use WSL 2 based engine  (enable)
    echo    3. Settings ^> Resources ^> WSL Integration       (enable GPU)
    echo    4. Apply and Restart
    echo    5. Rerun test-gpu.bat
    echo.
    echo  FIX (Linux/WSL2 host):
    echo    sudo apt install nvidia-container-toolkit
    echo    sudo nvidia-ctk runtime configure --runtime=docker
    echo    sudo systemctl restart docker
) else (
    echo  [PASS] Docker GPU passthrough is working.
    echo         vLLM can use the GPU inside Docker containers.
)

REM ── CUDA test ─────────────────────────────────────────────────────────────────
:cuda_test
echo.
echo [5/5] CUDA version check...
for /f "usebackq tokens=*" %%a in (`nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2^>nul`) do (
    echo   Compute Capability: %%a
    REM vLLM requires compute capability >= 7.0 (Volta or newer)
    for /f "usebackq tokens=1 delims=." %%v in ("%%a") do (
        if %%v GEQ 7 (
            echo  [PASS] Compute capability %%a ^>= 7.0 — vLLM compatible.
        ) else (
            echo  [WARN] Compute capability %%a ^< 7.0 — vLLM may not work.
            echo         vLLM requires Volta (V100), Turing (RTX 20xx), Ampere (RTX 30xx), or newer.
        )
    )
)

echo.
echo  ================================================================
echo   DIAGNOSTIC COMPLETE
echo.
echo   If all tests passed:
echo     Run start-most-host.bat to launch MAC with GPU acceleration.
echo.
echo   If Docker GPU test failed:
echo     Fix Docker Desktop GPU settings (see instructions above),
echo     then rerun this script to confirm before launching services.
echo  ================================================================
echo.
pause
