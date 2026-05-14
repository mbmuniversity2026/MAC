"""
MAC Watchdog — automated health monitoring and self-healing.

Runs as a background process on the HOST machine (not inside Docker).
Monitors all MAC containers, restarts unhealthy ones, and ensures
the docker socket permissions stay correct after restarts.

Usage:
    python watchdog.py          # foreground, logs to stdout + watchdog.log
    python watchdog.py --daemon # background (Windows: pythonw.exe watchdog.py)
"""

import subprocess
import time
import logging
import sys
import os
import json
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
CHECK_INTERVAL = 30          # seconds between health checks
RESTART_COOLDOWN = 120       # seconds to wait before restarting same container again
LOG_FILE = os.path.join(os.path.dirname(__file__), "watchdog.log")
COMPOSE_FILE = os.path.join(os.path.dirname(__file__), "docker-compose.yml")

CRITICAL_CONTAINERS = [
    "mac-api",
    "mac-nginx",
    "mac-postgres",
    "mac-redis",
]

OPTIONAL_CONTAINERS = [
    "mac-vllm-speed",
    "mac-vllm-reason",
    "mac-whisper",
    "mac-tts",
    "mac-qdrant",
    "mac-searxng",
]

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("mac-watchdog")

# ── State ────────────────────────────────────────────────────────────────────
_last_restart: dict[str, float] = {}


def run(cmd: list[str], timeout: int = 10) -> tuple[int, str]:
    """Run a command, return (returncode, output)."""
    try:
        env = {**os.environ, "DOCKER_API_VERSION": "1.43"}
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, env=env
        )
        return result.returncode, (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, "timeout"
    except Exception as exc:
        return -1, str(exc)


def get_container_status(name: str) -> str:
    """Return container status string: running/exited/not_found/etc."""
    code, out = run(["docker", "inspect", "--format", "{{.State.Status}}", name])
    if code != 0:
        return "not_found"
    return out.strip().lower()


def get_container_health(name: str) -> str:
    """Return health status: healthy/unhealthy/starting/none."""
    code, out = run(
        ["docker", "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", name]
    )
    if code != 0:
        return "none"
    return out.strip().lower()


def restart_container(name: str, reason: str) -> bool:
    """Restart a container with cooldown guard."""
    now = time.time()
    if now - _last_restart.get(name, 0) < RESTART_COOLDOWN:
        log.warning("Skipping restart of %s — cooldown active", name)
        return False

    log.warning("Restarting %s — reason: %s", name, reason)
    code, out = run(["docker", "restart", name], timeout=60)
    _last_restart[name] = time.time()

    if code == 0:
        log.info("Restarted %s successfully", name)
        # Fix docker socket permissions after mac-api restart
        if name == "mac-api":
            time.sleep(5)
            _fix_docker_socket()
        return True
    else:
        log.error("Failed to restart %s: %s", name, out)
        return False


def _fix_docker_socket():
    """Ensure /var/run/docker.sock is accessible inside mac-api."""
    code, out = run(
        ["docker", "exec", "-u", "root", "mac-api",
         "sh", "-c", "chmod 666 /var/run/docker.sock 2>/dev/null || true"],
        timeout=10,
    )
    if code == 0:
        log.info("Docker socket permissions fixed in mac-api")
    else:
        log.warning("Could not fix docker socket: %s", out)


def check_api_health() -> bool:
    """HTTP health check of mac-api."""
    code, out = run(
        ["docker", "exec", "mac-api",
         "python3", "-c",
         "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5)"],
        timeout=15,
    )
    return code == 0


def check_nginx() -> bool:
    """Verify nginx responds on port 80."""
    code, out = run(
        ["docker", "exec", "mac-nginx",
         "wget", "-q", "-O", "/dev/null", "--timeout=3",
         "http://127.0.0.1/nginx-health"],
        timeout=10,
    )
    return code == 0


def check_and_heal_container(name: str, critical: bool = True) -> None:
    """Check one container and restart if needed."""
    status = get_container_status(name)

    if status == "not_found":
        if critical:
            log.error("Critical container %s not found — attempting compose start", name)
            run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d", name], timeout=120)
        return

    if status in ("exited", "dead", "created"):
        restart_container(name, f"status={status}")
        return

    if status != "running":
        log.warning("Container %s in unexpected state: %s", name, status)
        return

    health = get_container_health(name)
    if health == "unhealthy":
        restart_container(name, "healthcheck=unhealthy")


def watchdog_cycle() -> None:
    """Run one full check cycle."""
    log.debug("Watchdog cycle starting")

    # Check critical containers
    for name in CRITICAL_CONTAINERS:
        check_and_heal_container(name, critical=True)

    # Extra health checks for api + nginx
    time.sleep(2)
    if get_container_status("mac-api") == "running":
        if not check_api_health():
            restart_container("mac-api", "api_health_check_failed")
        else:
            _fix_docker_socket()  # keep socket accessible proactively

    if get_container_status("mac-nginx") == "running":
        if not check_nginx():
            # Try nginx reload first, then restart
            code, _ = run(["docker", "exec", "mac-nginx", "nginx", "-s", "reload"], timeout=10)
            if code != 0:
                restart_container("mac-nginx", "nginx_not_responding")

    # Check optional containers (warn only, no auto-restart)
    for name in OPTIONAL_CONTAINERS:
        status = get_container_status(name)
        if status == "running":
            health = get_container_health(name)
            if health == "unhealthy":
                log.warning("Optional container %s is unhealthy", name)


def main():
    log.info("MAC Watchdog starting — check interval: %ds", CHECK_INTERVAL)
    log.info("Monitoring: %s", ", ".join(CRITICAL_CONTAINERS))

    # Initial fix on startup
    time.sleep(10)
    _fix_docker_socket()

    while True:
        try:
            watchdog_cycle()
        except Exception as exc:
            log.exception("Watchdog cycle error: %s", exc)
        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()
