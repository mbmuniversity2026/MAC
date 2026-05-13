"""
MAC Worker Agent — MBM AI Cloud
================================
Registers this PC with the MAC control node and sends live heartbeats
so the load balancer can route AI inference requests here.

Runs directly on the worker PC (no Docker needed for this script).

Environment variables (set by setup-worker.bat):
    MAC_MASTER_URL      Control node URL  e.g. http://192.168.1.34
    MAC_ENROLL_TOKEN    Enrollment token from Admin Panel → Cluster → Tokens
    MAC_WORKER_NAME     Display name for this PC
    MAC_WORKER_IP       This PC's LAN IP (detected by setup-worker.bat)
    MAC_VLLM_PORT       Port where vLLM or Ollama is serving (8001 or 11434)
    MAC_VLLM_MODEL      Model ID being served
    MAC_GPU_NAME        GPU name (detected on host by setup-worker.bat)
    MAC_GPU_VRAM_MB     GPU VRAM in MB (detected on host by setup-worker.bat)
    MAC_HEARTBEAT_SEC   Heartbeat interval in seconds (default 10)
    MAC_ENGINE          Inference engine: vllm | ollama (default vllm)
"""

import hashlib
import json
import multiprocessing
import os
import platform
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

STATE_FILE = os.environ.get("MAC_STATE_FILE", ".mac_worker_state.json")
REGISTER_RETRIES = 10
REGISTER_RETRY_DELAY = 15   # seconds between registration attempts


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _my_ip() -> str:
    override = _env("MAC_WORKER_IP")
    if override:
        return override
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "0.0.0.0"


def _detect_gpu() -> dict:
    # Priority 1: env vars set by setup-worker.bat from host nvidia-smi
    name_env = _env("MAC_GPU_NAME")
    vram_env = _env("MAC_GPU_VRAM_MB", "0")
    if name_env and name_env not in ("", "CPU-only", "Unknown"):
        vram = int(vram_env) if vram_env.isdigit() else 0
        return {"name": name_env, "vram_mb": vram}

    # Priority 2: try nvidia-smi directly (works when running on host)
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            line = out.stdout.strip()
            if ", " in line:
                parts = line.split(", ", 1)
            else:
                parts = line.split(",", 1)
            return {
                "name": parts[0].strip(),
                "vram_mb": int(float(parts[1].strip())) if len(parts) > 1 else 0,
            }
    except Exception:
        pass

    return {"name": "CPU-only", "vram_mb": 0}


def _detect_system() -> tuple:
    cpu_cores = multiprocessing.cpu_count()
    ram_mb = 0
    try:
        import psutil
        ram_mb = int(psutil.virtual_memory().total / (1024 * 1024))
    except ImportError:
        try:
            if platform.system() == "Windows":
                out = subprocess.run(
                    ["wmic", "computersystem", "get", "TotalPhysicalMemory", "/value"],
                    capture_output=True, text=True, timeout=5,
                )
                for line in out.stdout.splitlines():
                    if "=" in line:
                        ram_mb = int(line.split("=")[1].strip()) // (1024 * 1024)
        except Exception:
            pass
    return cpu_cores, ram_mb


def _get_gpu_metrics() -> dict:
    try:
        out = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=utilization.gpu,memory.used",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            line = out.stdout.strip()
            if ", " in line:
                parts = line.split(", ", 1)
            else:
                parts = line.split(",", 1)
            return {
                "gpu_util_pct":    float(parts[0].strip()),
                "gpu_vram_used_mb": int(parts[1].strip()) if len(parts) > 1 else 0,
            }
    except Exception:
        pass
    return {}


def _get_cpu_ram_metrics() -> dict:
    try:
        import psutil
        return {
            "cpu_util_pct": psutil.cpu_percent(interval=1),
            "ram_used_mb":  int(psutil.virtual_memory().used / (1024 * 1024)),
        }
    except Exception:
        return {}


def _vllm_health(vllm_url: str) -> bool:
    """Check if vLLM/Ollama is up and healthy."""
    try:
        context = None
        if vllm_url.startswith("https://"):
            context = ssl._create_unverified_context()
        req = urllib.request.Request(f"{vllm_url}/health")
        with urllib.request.urlopen(req, timeout=5, context=context) as r:
            return r.status == 200
    except Exception:
        return False


def _post(url: str, data: dict) -> tuple:
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        context = ssl._create_unverified_context() if url.startswith("https://") else None
        with urllib.request.urlopen(req, timeout=15, context=context) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as exc:
        try:
            err = json.loads(exc.read().decode())
        except Exception:
            err = {"detail": str(exc)}
        return err, exc.code
    except Exception as exc:
        return {"detail": str(exc)}, 0


def _load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_state(state: dict) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def main() -> None:
    master_url    = _env("MAC_MASTER_URL", "http://192.168.1.34").rstrip("/")
    token         = _env("MAC_ENROLL_TOKEN")
    name          = _env("MAC_WORKER_NAME") or platform.node()
    vllm_port     = int(_env("MAC_VLLM_PORT", "8001"))
    vllm_model    = _env("MAC_VLLM_MODEL", "Qwen/Qwen2.5-7B-Instruct-AWQ")
    heartbeat_sec = int(_env("MAC_HEARTBEAT_SEC", "10"))
    engine        = _env("MAC_ENGINE", "vllm")  # vllm | ollama

    if not token:
        print("[ERROR] MAC_ENROLL_TOKEN is not set.")
        print("  Generate a token: Admin Panel → Cluster → Generate Token")
        sys.exit(1)

    token_hash    = _sha256(token)
    gpu           = _detect_gpu()
    cpu_cores, ram_mb = _detect_system()
    my_ip         = _my_ip()
    state         = _load_state()

    # vLLM/Ollama base URL — override with MAC_VLLM_URL when running in Docker
    vllm_base = _env("MAC_VLLM_URL") or f"http://localhost:{vllm_port}"

    print("=" * 56)
    print("  MAC Worker Agent — MBM AI Cloud")
    print("=" * 56)
    print(f"  Name   : {name}")
    print(f"  Master : {master_url}")
    print(f"  IP     : {my_ip}:{vllm_port}")
    print(f"  GPU    : {gpu['name']}  ({gpu['vram_mb']} MB VRAM)")
    print(f"  CPU    : {cpu_cores} cores  RAM: {ram_mb} MB")
    print(f"  Model  : {vllm_model}")
    print(f"  Engine : {engine}")
    print()

    # ── Register (once, with retries) ────────────────────────────────────────
    if "node_id" not in state:
        print(f"[MAC] Registering with {master_url} ...")
        payload = {
            "enrollment_token": token,
            "name":             name,
            "hostname":         platform.node(),
            "ip_address":       my_ip,
            "port":             vllm_port,
            "gpu_name":         gpu["name"],
            "gpu_vram_mb":      gpu["vram_mb"],
            "ram_total_mb":     ram_mb,
            "cpu_cores":        cpu_cores,
            "tags":             f"llm,{engine}",
            "vllm_model":       vllm_model,
        }
        for attempt in range(1, REGISTER_RETRIES + 1):
            resp, status = _post(f"{master_url}/api/v1/cluster/register", payload)
            if status in (200, 201):
                state["node_id"] = resp.get("node_id", "")
                _save_state(state)
                print(f"[MAC] Registered — node_id={state['node_id']}, status={resp.get('status')}")
                if resp.get("status") == "pending":
                    print(f"[MAC] Waiting for admin approval at {master_url}")
                    print("[MAC] Admin Panel → Cluster → Nodes → Approve this PC")
                break
            detail = resp.get("detail", resp)
            code = detail.get("code", "") if isinstance(detail, dict) else str(detail)
            if code == "invalid_token":
                print(f"[MAC] Registration FAILED: Invalid or expired enrollment token.")
                print("      Generate a new token in Admin Panel → Cluster → Generate Token")
                sys.exit(1)
            print(f"[MAC] Registration attempt {attempt}/{REGISTER_RETRIES} failed ({status}): {detail}")
            if attempt < REGISTER_RETRIES:
                print(f"[MAC] Retrying in {REGISTER_RETRY_DELAY}s ...")
                time.sleep(REGISTER_RETRY_DELAY)
        else:
            print(f"[MAC] Could not register after {REGISTER_RETRIES} attempts.")
            print(f"      Is {master_url} reachable from this PC?")
            sys.exit(1)

    node_id = state["node_id"]
    print(f"[MAC] Heartbeat every {heartbeat_sec}s  (node_id={node_id})")
    print()

    # ── Heartbeat loop ────────────────────────────────────────────────────────
    waiting_shown = False
    vllm_ready_reported = False

    while True:
        try:
            # Check if inference engine is up
            alive = _vllm_health(vllm_base)
            active = [vllm_model] if alive else []

            if alive and not vllm_ready_reported:
                print(f"[{time.strftime('%H:%M:%S')}] {engine} is READY — serving {vllm_model}")
                vllm_ready_reported = True
            elif not alive and not waiting_shown:
                print(f"[{time.strftime('%H:%M:%S')}] Waiting for {engine} on port {vllm_port} ...")
                waiting_shown = True
            elif not alive:
                vllm_ready_reported = False

            metrics = {**_get_gpu_metrics(), **_get_cpu_ram_metrics()}
            resp, status = _post(f"{master_url}/api/v1/cluster/heartbeat", {
                "node_id":          node_id,
                "node_token":       token_hash,
                "gpu_util_pct":     metrics.get("gpu_util_pct"),
                "gpu_vram_used_mb": metrics.get("gpu_vram_used_mb"),
                "ram_used_mb":      metrics.get("ram_used_mb"),
                "cpu_util_pct":     metrics.get("cpu_util_pct"),
                "active_models":    active,
                "queue_depth":      0,
            })

            ts = time.strftime("%H:%M:%S")
            if status == 200:
                if alive:
                    print(f"[{ts}] OK — {vllm_model} ready, routing live")
                # else silent — still loading
            elif status == 403:
                detail = resp.get("detail", {})
                code = detail.get("code") if isinstance(detail, dict) else ""
                if code == "not_approved":
                    if not waiting_shown:
                        print(f"[{ts}] Pending admin approval …")
                        waiting_shown = True
                else:
                    print(f"[{ts}] Heartbeat 403: {detail}")
            elif status == 401:
                print(f"[{ts}] Auth failed — token mismatch. Re-register with a new token.")
                break
            elif status == 0:
                print(f"[{ts}] Cannot reach master: {resp.get('detail')}")
            else:
                print(f"[{ts}] Heartbeat {status}: {resp}")

        except Exception as exc:
            print(f"[{time.strftime('%H:%M:%S')}] Error: {exc}")

        time.sleep(heartbeat_sec)


if __name__ == "__main__":
    main()
