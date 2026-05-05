@echo off
setlocal
title MAC Chrome Launcher

set "MAC_HTTP=http://10.10.12.115"
set "MAC_HTTPS=https://10.10.12.115"
set "PROFILE=%LOCALAPPDATA%\MAC\ChromeVoiceProfile"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME%" (
  echo Chrome was not found. Install Google Chrome, then run this launcher again.
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%" >nul 2>&1

start "" "%CHROME%" ^
  --user-data-dir="%PROFILE%" ^
  --unsafely-treat-insecure-origin-as-secure=%MAC_HTTP%,%MAC_HTTPS% ^
  --ignore-certificate-errors ^
  --allow-running-insecure-content ^
  %MAC_HTTP%

endlocal
