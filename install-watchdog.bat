@echo off
:: MAC Nginx Watchdog Installer
:: Registers nginx-watchdog.ps1 as a Windows Scheduled Task
:: Runs every 2 minutes — auto-restarts nginx when port proxy breaks
:: Run as Administrator

cd /d "%~dp0"

echo.
echo  Installing MAC Nginx Watchdog...

set "SCRIPT=%~dp0nginx-watchdog.ps1"
set "TASK_NAME=MAC-Nginx-Watchdog"

:: Remove existing task if any
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create task: run every 2 minutes, any time, no user login needed
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "powershell.exe -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%SCRIPT%\"" ^
  /sc minute /mo 2 ^
  /ru SYSTEM ^
  /rl HIGHEST ^
  /f >nul 2>&1

if errorlevel 1 (
    echo  [ERROR] Failed to create scheduled task. Run this as Administrator.
    pause & exit /b 1
)

echo  [OK] Watchdog installed as Scheduled Task: %TASK_NAME%
echo       Runs every 2 minutes — auto-restarts nginx if port proxy breaks.
echo.
echo  To check logs: type "%~dp0nginx-watchdog.log"
echo  To uninstall:  schtasks /delete /tn "%TASK_NAME%" /f
echo.

:: Run it once immediately
powershell.exe -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "%SCRIPT%"
echo  [OK] First check done.
pause
