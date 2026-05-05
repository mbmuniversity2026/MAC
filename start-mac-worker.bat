@echo off
setlocal
title MAC Worker Node
cd /d "%~dp0"

if exist "worker.exe" (
  worker.exe
  exit /b %ERRORLEVEL%
)

where python >nul 2>&1
if errorlevel 1 (
  echo Python was not found and worker.exe is missing.
  echo Use dist\worker.exe for one-click worker setup on new PCs.
  pause
  exit /b 1
)

python worker_launcher.py
exit /b %ERRORLEVEL%
