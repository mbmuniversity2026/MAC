"""
MAC Worker Agent — registers with the admin cluster and sends heartbeats.

Runs on worker PCs. Detects GPU/CPU, registers via enrollment token, then
sends live metrics every N seconds so the master can route requests here.

Environment variables:
    MAC_MASTER_URL      Admin server URL  (e.g. http://192.168.1.34)
    MAC_ENROLL_TOKEN    Enrollment token from admin panel → Cluster → Tokens
    MAC_WORKER_NAME     Display name for this node (default: hostname)
    MAC_VLLM_PORT       Port where local vLLM is listening (default: 8001)
    MAC_VLLM_MODEL      HF model ID served by local vLLM
    MAC_HEARTBEAT_SEC   Heartbeat interval in seconds (default: 10)
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

STATE_FILE = ".mac_worker_state.json"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _my_ip() -> str:
    """Best-effort LAN IP (not 127.0.0.1)."""
    override = _env("MAC_WORKER_IP", "").strip()
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
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            parts = out.stdout.strip().split(", ")
            return {"name": parts[0].strip(), "vram_mb": int(float(parts[1].strip()))}
    except Exception:
        pass
    return {"name": "CPU-only", "vram_mb": 0}


def _detect_system() -> tuple[int, int]:
    cpu_cores = multiprocessing.cpu_count()
    try:
        import psutil
        ram_mb = int(psutil.virtual_memory().total / (1024 * 1024))
    except ImportError:
        ram_mb = 0
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
            parts = out.stdout.strip().split(", ")
            return {
                "gpu_util_pct":   float(parts[0].strip()),
                "gpu_vram_used_mb": int(parts[1].strip()),
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


def _post(url: str, data: dict) -> tuple[dict, int]:
    body = json.dumps(data).encode("utf-8")
    req  = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        context = ssl._create_unverified_context() if url.lower().startswith("https://") else None
        with urllib.request.urlopen(req, timeout=10, context=context) as resp:
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


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    master_url    = _env("MAC_MASTER_URL", "http://192.168.1.34").rstrip("/")
    token         = _env("MAC_ENROLL_TOKEN", "")
    name          = _env("MAC_WORKER_NAME", platform.node())
    vllm_port     = int(_env("MAC_VLLM_PORT", "8001"))
    vllm_model    = _env("MAC_VLLM_MODEL", "sarvamai/sarvam-2b-v0.5")
    heartbeat_sec = int(_env("MAC_HEARTBEAT_SEC", "10"))

    if not token:
        print("[ERROR] MAC_ENROLL_TOKEN is required.")
        print("  Get a token from: Admin Panel → Cluster → Generate Token")
        sys.exit(1)

    token_hash = _sha256(token)   # stored in DB; sent in heartbeats as node_token
    gpu        = _detect_gpu()
    cpu_cores, ram_mb = _detect_system()
    my_ip      = _my_ip()
    state      = _load_state()

    print(f"[MAC Worker] Name   : {name}")
    print(f"[MAC Worker] Master : {master_url}")
    print(f"[MAC Worker] IP     : {my_ip}:{vllm_port}")
    print(f"[MAC Worker] GPU    : {gpu['name']}  ({gpu['vram_mb']} MB)")
    print(f"[MAC Worker] Model  : {vllm_model}")
    print()

    # ── Register (once) ──────────────────────────────────────────────────────
    if "node_id" not in state:
        print("[MAC Worker] Registering with master …")
        resp, status = _post(f"{master_url}/api/v1/cluster/register", {
            "enrollment_token": token,        # ← plain token (not hash)
            "name":             name,
            "hostname":         platform.node(),
            "ip_address":       my_ip,        # ← correct field name
            "port":             vllm_port,
            "gpu_name":         gpu["name"],
            "gpu_vram_mb":      gpu["vram_mb"],
            "ram_total_mb":     ram_mb,
            "cpu_cores":        cpu_cores,
            "tags":             "llm,agent",
        })
        if status in (200, 201):
            state["node_id"] = resp.get("node_id", "")
            _save_state(state)
            print(f"[MAC Worker] Registered — node_id={state['node_id']}, status={resp.get('status')}")
            if resp.get("status") == "pending":
                print("[MAC Worker] Waiting for admin approval in Admin Panel → Cluster …")
        else:
            print(f"[MAC Worker] Registration FAILED ({status}): {resp.get('detail', resp)}")
            sys.exit(1)

    node_id = state["node_id"]
    print(f"[MAC Worker] Heartbeat every {heartbeat_sec}s  (node_id={node_id})")

    # ── Heartbeat loop ────────────────────────────────────────────────────────
    while True:
        try:
            metrics = {**_get_gpu_metrics(), **_get_cpu_ram_metrics()}
            resp, status = _post(f"{master_url}/api/v1/cluster/heartbeat", {
                "node_id":          node_id,
                "node_token":       token_hash,   # ← sha256(token), correct field
                "gpu_util_pct":     metrics.get("gpu_util_pct"),
                "gpu_vram_used_mb": metrics.get("gpu_vram_used_mb"),
                "ram_used_mb":      metrics.get("ram_used_mb"),
                "cpu_util_pct":     metrics.get("cpu_util_pct"),
                "active_models":    [vllm_model],
                "queue_depth":      0,
            })
            ts = time.strftime("%H:%M:%S")
            if status == 200:
                print(f"[{ts}] Heartbeat OK")
            elif status == 403:
                detail = resp.get("detail", {})
                code = detail.get("code") if isinstance(detail, dict) else ""
                if code == "not_approved":
                    print(f"[{ts}] Pending admin approval …")
                else:
                    print(f"[{ts}] Heartbeat 403: {detail}")
            else:
                print(f"[{ts}] Heartbeat {status}: {resp.get('detail', resp)}")
        except Exception as exc:
            print(f"[{time.strftime('%H:%M:%S')}] Heartbeat error: {exc}")

        time.sleep(heartbeat_sec)


if __name__ == "__main__":
    main()
