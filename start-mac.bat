@echo off
title MAC — MBM AI Cloud
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC — MBM AI Cloud  ^|  Starting...
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

echo  Starting MAC services (this may take a minute on first run)...
docker compose up -d

if errorlevel 1 (
    echo  [ERROR] Failed to start MAC services.
    pause
    exit /b 1
)

echo.
echo  ===================================================
echo   MAC is running!
echo   Open your browser: http://localhost
echo  ===================================================
echo.
echo  Press any key to open MAC in your browser...
pause >nul
start http://localhost
