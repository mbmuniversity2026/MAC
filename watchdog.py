"""
MAC Watchdog — automated health monitoring and self-healing.

Runs inside Docker (or on the host) and monitors all MAC containers.
Uses the Docker Python SDK via /var/run/docker.sock for reliability.
"""

import time
import logging
import sys
import os

CHECK_INTERVAL = 30
RESTART_COOLDOWN = 120
LOG_FILE = os.path.join(os.path.dirname(__file__), "watchdog.log")

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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("mac-watchdog")

_last_restart: dict[str, float] = {}
_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client
    try:
        import docker
        _client = docker.from_env()
        return _client
    except Exception as exc:
        log.error("Docker SDK unavailable: %s", exc)
        return None


def _install_sdk():
    """Install docker SDK if not already available."""
    try:
        import docker  # noqa
        return True
    except ImportError:
        import subprocess
        log.info("Installing docker Python SDK...")
        r = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "docker>=7.0.0"],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode == 0:
            log.info("docker SDK installed")
            return True
        log.error("pip install docker failed: %s", r.stderr)
        return False


def get_container(name: str):
    client = _get_client()
    if not client:
        return None
    try:
        return client.containers.get(name)
    except Exception:
        return None


def restart_container(name: str, reason: str) -> bool:
    now = time.time()
    if now - _last_restart.get(name, 0) < RESTART_COOLDOWN:
        log.warning("Skipping restart of %s — cooldown active", name)
        return False

    log.warning("Restarting %s — reason: %s", name, reason)
    c = get_container(name)
    if not c:
        log.error("Container %s not found for restart", name)
        return False

    try:
        c.restart(timeout=30)
        _last_restart[name] = time.time()
        log.info("Restarted %s successfully", name)
        if name == "mac-api":
            time.sleep(5)
            _fix_docker_socket()
        return True
    except Exception as exc:
        log.error("Failed to restart %s: %s", name, exc)
        _last_restart[name] = time.time()
        return False


def _fix_docker_socket():
    c = get_container("mac-api")
    if not c:
        return
    try:
        code, out = c.exec_run(
            "sh -c 'chmod 666 /var/run/docker.sock 2>/dev/null || true'",
            user="root",
        )
        if code == 0:
            log.info("Docker socket permissions fixed in mac-api")
        else:
            log.warning("Could not fix docker socket: %s", out)
    except Exception as exc:
        log.warning("Socket fix error: %s", exc)


def check_api_health() -> bool:
    c = get_container("mac-api")
    if not c:
        return False
    try:
        code, _ = c.exec_run(
            "python3 -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5)\"",
            timeout=15,
        )
        return code == 0
    except Exception:
        return False


def check_nginx() -> bool:
    c = get_container("mac-nginx")
    if not c:
        return False
    try:
        code, _ = c.exec_run(
            "wget -q -O /dev/null --timeout=3 http://127.0.0.1/nginx-health",
            timeout=10,
        )
        return code == 0
    except Exception:
        return False


def check_and_heal(name: str, critical: bool = True) -> None:
    c = get_container(name)

    if c is None:
        if critical:
            log.error("Critical container %s not found", name)
        return

    c.reload()
    status = c.status  # running / exited / dead / created / paused / restarting
    health = "none"
    if c.attrs.get("State", {}).get("Health"):
        health = c.attrs["State"]["Health"]["Status"]

    if status in ("exited", "dead", "created"):
        restart_container(name, f"status={status}")
        return

    if status != "running":
        log.warning("Container %s in unexpected state: %s", name, status)
        return

    if health == "unhealthy":
        restart_container(name, "healthcheck=unhealthy")


def watchdog_cycle() -> None:
    for name in CRITICAL_CONTAINERS:
        check_and_heal(name, critical=True)

    time.sleep(2)

    if get_container("mac-api") and get_container("mac-api").status == "running":
        if not check_api_health():
            restart_container("mac-api", "api_health_check_failed")
        else:
            _fix_docker_socket()

    nginx = get_container("mac-nginx")
    if nginx:
        nginx.reload()
        if nginx.status == "running" and not check_nginx():
            try:
                code, _ = nginx.exec_run("nginx -s reload", timeout=10)
                if code != 0:
                    restart_container("mac-nginx", "nginx_not_responding")
            except Exception:
                restart_container("mac-nginx", "nginx_exec_failed")

    for name in OPTIONAL_CONTAINERS:
        c = get_container(name)
        if c:
            c.reload()
            if c.status == "running":
                health = c.attrs.get("State", {}).get("Health", {})
                if health and health.get("Status") == "unhealthy":
                    log.warning("Optional container %s is unhealthy", name)


def main():
    _install_sdk()

    log.info("MAC Watchdog starting — check interval: %ds", CHECK_INTERVAL)
    log.info("Monitoring: %s", ", ".join(CRITICAL_CONTAINERS))

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
