@echo off
title MAC — MBM AI Cloud — Stopping
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC — MBM AI Cloud  ^|  Stopping...
echo  ===================================================
echo.

docker compose down

echo.
echo  All MAC services stopped.
echo.
pause
