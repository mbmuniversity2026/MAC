@echo off
title MAC Watchdog
cd /d "%~dp0"
echo Starting MAC Watchdog...
echo Logs: %~dp0watchdog.log
python watchdog.py
pause
