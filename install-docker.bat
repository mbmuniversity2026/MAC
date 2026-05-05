@echo off
title Install Docker Desktop
echo.
echo  ===================================================
echo   Installing Docker Desktop for MAC
echo  ===================================================
echo.
echo  A UAC (admin permission) dialog will appear.
echo  Click YES to allow Docker Desktop to install.
echo.

REM Check if already downloaded
set "INSTALLER=%TEMP%\DockerDesktopInstaller.exe"
if not exist "%INSTALLER%" (
    echo  Downloading Docker Desktop installer (600 MB)...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://desktop.docker.com/win/main/amd64/Docker%%20Desktop%%20Installer.exe' -OutFile '%INSTALLER%' -UseBasicParsing"
    if errorlevel 1 (
        echo  [ERROR] Download failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo  [OK] Downloaded.
)

echo  Launching Docker Desktop installer...
echo  IMPORTANT: Click YES on the Windows security prompt!
echo.
"%INSTALLER%" install --accept-license --backend=wsl-2

if errorlevel 1 (
    echo.
    echo  [INFO] Installer returned exit code %errorlevel%
    echo  If Docker Desktop shows "Installation succeeded", you're done.
    echo  Restart your PC, then run start-mac.bat
) else (
    echo.
    echo  [OK] Docker Desktop installed!
    echo  You may need to RESTART your PC.
    echo  After restart, run start-mac.bat
)
echo.
pause
