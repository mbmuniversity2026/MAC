@echo off
setlocal enabledelayedexpansion
title MAC Worker — MBM AI Cloud
cd /d "%~dp0"

if exist ".env.worker" (
    echo  Found .env.worker — loading config and starting worker agent...
    echo.
    for /f "usebackq tokens=1,* delims==" %%a in (".env.worker") do set "%%a=%%b"
    python worker_agent.py
) else (
    echo  No .env.worker found. Running first-time setup...
    echo.
    call setup-worker.bat
)
pause
