@echo off
setlocal enabledelayedexpansion
title MAC — Switch to Offline Mode
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC — Switching to OFFLINE mode
echo   All AI models will load from local cache only.
echo   No internet access required after this point.
echo  ===================================================
echo.

if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo  [INFO] Created .env from .env.example
    ) else (
        echo. > .env
    )
)

powershell -NoProfile -Command ^
  "$path = '.env';" ^
  "$lines = Get-Content $path -ErrorAction SilentlyContinue;" ^
  "if ($lines -eq $null) { $lines = @() };" ^
  "$to = $false; $hd = $false;" ^
  "$lines = $lines | ForEach-Object {" ^
  "  if ($_ -match '^TRANSFORMERS_OFFLINE') { $to = $true; 'TRANSFORMERS_OFFLINE=1' }" ^
  "  elseif ($_ -match '^HF_DATASETS_OFFLINE') { $hd = $true; 'HF_DATASETS_OFFLINE=1' }" ^
  "  else { $_ }" ^
  "};" ^
  "if (-not $to) { $lines += 'TRANSFORMERS_OFFLINE=1' };" ^
  "if (-not $hd) { $lines += 'HF_DATASETS_OFFLINE=1' };" ^
  "$lines | Set-Content $path -Encoding UTF8"

if errorlevel 1 (
    echo  [ERROR] Failed to update .env.
    echo  Manually set in .env:
    echo    TRANSFORMERS_OFFLINE=1
    echo    HF_DATASETS_OFFLINE=1
    pause
    exit /b 1
)

echo  [OK] .env updated — TRANSFORMERS_OFFLINE=1, HF_DATASETS_OFFLINE=1
echo.
echo  Restart MAC for the change to take effect:
echo    stop-mac.bat  then  start-mac.bat
echo.

REM Offer to restart running containers if any are up
docker compose ps --services --filter status=running 2>nul | findstr /i "mac tts whisper vllm" >nul 2>&1
if not errorlevel 1 (
    echo  Running containers detected.
    set /p RESTART="  Restart now to apply offline mode? [Y/N]: "
    if /i "!RESTART!"=="Y" (
        echo.
        echo  Restarting...
        docker compose restart mac tts whisper vllm-speed 2>nul
        echo  [OK] Containers restarted in offline mode.
    )
)

echo.
pause
