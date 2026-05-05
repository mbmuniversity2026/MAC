@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python 3.11+ is required to build worker.exe.
  pause
  exit /b 1
)

python -m pip show pyinstaller >nul 2>&1
if errorlevel 1 (
  python -m pip install --user pyinstaller
  if errorlevel 1 exit /b 1
)

python -m PyInstaller ^
  --onefile ^
  --clean ^
  --name worker ^
  --add-data "docker-compose.worker.yml;." ^
  --add-data "worker_agent.py;." ^
  worker_launcher.py

if errorlevel 1 exit /b 1
echo.
echo Built dist\worker.exe
endlocal
