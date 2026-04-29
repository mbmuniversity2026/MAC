@echo off
title MAC — Worker Node
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC — Worker Node Starting...
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

REM Create .env.worker if missing
if not exist ".env.worker" (
    echo  First-time worker setup — please provide cluster details.
    echo.
    set /p MASTER_IP="  Admin Server IP (e.g. 192.168.1.34): "
    set /p ENROLL_TOKEN="  Enrollment Token: "
    set /p WORKER_NAME="  Worker Name (e.g. Lab-PC-01): "
    (
        echo MAC_MASTER_URL=http://!MASTER_IP!
        echo MAC_ENROLL_TOKEN=!ENROLL_TOKEN!
        echo MAC_WORKER_NAME=!WORKER_NAME!
        echo MAC_VLLM_PORT=8001
        echo MAC_HEARTBEAT_SEC=10
    ) > .env.worker
    echo.
    echo  [OK] Configuration saved to .env.worker
    echo.
)

echo  Starting worker services...
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d

if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start worker services.
    pause
    exit /b 1
)

echo.
echo  ===================================================
echo   Worker node is running!
echo   GPU inference is available on port 8001.
echo  ===================================================
echo.
pause
