@echo off
title MAC Worker — Stopping
cd /d "%~dp0"

echo.
echo  ===================================================
echo   MAC Worker — Stopping vLLM container
echo  ===================================================
echo.

docker compose -f docker-compose.worker.yml down
echo  [OK] vLLM container stopped.
echo  Note: worker_agent.py process must be closed manually (Ctrl+C in its window).
echo.
pause
