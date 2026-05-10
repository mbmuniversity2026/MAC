@echo off
setlocal enabledelayedexpansion
title MAC — Switch to Online Mode
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC — Switching to ONLINE mode
echo   Models can be updated / new models downloaded.
echo   Internet access will be used on next startup.
echo  ===================================================
echo.

if not exist .env (
    echo  [WARN] .env not found — nothing to change.
    pause
    exit /b 0
)

powershell -NoProfile -Command ^
  "$path = '.env';" ^
  "$lines = Get-Content $path -ErrorAction SilentlyContinue;" ^
  "if ($lines -eq $null) { $lines = @() };" ^
  "$lines = $lines | ForEach-Object {" ^
  "  if ($_ -match '^TRANSFORMERS_OFFLINE') { 'TRANSFORMERS_OFFLINE=0' }" ^
  "  elseif ($_ -match '^HF_DATASETS_OFFLINE') { 'HF_DATASETS_OFFLINE=0' }" ^
  "  else { $_ }" ^
  "};" ^
  "$lines | Set-Content $path -Encoding UTF8"

if errorlevel 1 (
    echo  [ERROR] Failed to update .env.
    echo  Manually set in .env:
    echo    TRANSFORMERS_OFFLINE=0
    echo    HF_DATASETS_OFFLINE=0
    pause
    exit /b 1
)

echo  [OK] .env updated — TRANSFORMERS_OFFLINE=0, HF_DATASETS_OFFLINE=0
echo.
echo  Restart MAC for the change to take effect:
echo    stop-mac.bat  then  start-mac.bat
echo.

REM Offer to restart running containers if any are up
docker compose ps --services --filter status=running 2>nul | findstr /i "mac tts whisper vllm" >nul 2>&1
if not errorlevel 1 (
    echo  Running containers detected.
    set /p RESTART="  Restart now to apply online mode? [Y/N]: "
    if /i "!RESTART!"=="Y" (
        echo.
        echo  Restarting...
        docker compose restart mac tts whisper vllm-speed 2>nul
        echo  [OK] Containers restarted in online mode.
    )
)

echo.
pause
