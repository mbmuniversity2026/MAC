"""
MAC Worker Agent — Registers with admin cluster and sends heartbeats.

Runs as a background service on worker nodes. Detects local GPU/CPU hardware
and reports metrics to the master server for load balancing.

Usage:
    python worker_agent.py

Environment variables:
    MAC_MASTER_URL      - Admin server URL (e.g. http://192.168.1.34)
    MAC_ENROLL_TOKEN    - Enrollment token from admin panel
    MAC_WORKER_NAME     - Display name for this worker node
    MAC_VLLM_PORT       - Local vLLM port (default: 8001)
    MAC_HEARTBEAT_SEC   - Heartbeat interval (default: 10)
"""

import os
import sys
import json
import time
import hashlib
import platform
import urllib.request
import urllib.error

STATE_FILE = ".mac_worker_state.json"

def get_env(key, default=""):
    return os.environ.get(key, default)

def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()

def detect_gpu():
    try:
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            parts = result.stdout.strip().split(", ")
            return {"name": parts[0], "vram_mb": int(float(parts[1]))}
    except Exception:
        pass
    return {"name": "Unknown", "vram_mb": 0}

def detect_system():
    import multiprocessing
    cpu_cores = multiprocessing.cpu_count()
    try:
        import psutil
        ram_mb = psutil.virtual_memory().total // (1024 * 1024)
    except ImportError:
        ram_mb = 0
    return cpu_cores, ram_mb

def api_post(url, data):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode()), resp.status
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode())
        except Exception:
            err_body = {"detail": str(e)}
        return err_body, e.code
    except Exception as e:
        return {"detail": str(e)}, 0

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def main():
    master_url = get_env("MAC_MASTER_URL", "http://192.168.1.34")
    token = get_env("MAC_ENROLL_TOKEN", "")
    name = get_env("MAC_WORKER_NAME", platform.node())
    vllm_port = int(get_env("MAC_VLLM_PORT", "8001"))
    heartbeat_sec = int(get_env("MAC_HEARTBEAT_SEC", "10"))

    if not token:
        print("[ERROR] MAC_ENROLL_TOKEN is required")
        sys.exit(1)

    base_url = master_url.rstrip("/")
    token_hash = sha256(token)
    gpu_info = detect_gpu()
    cpu_cores, ram_mb = detect_system()
    state = load_state()

    print(f"[MAC Worker] Name: {name}")
    print(f"[MAC Worker] Master: {base_url}")
    print(f"[MAC Worker] GPU: {gpu_info['name']} ({gpu_info['vram_mb']} MB)")
    print(f"[MAC Worker] CPU: {cpu_cores} cores, RAM: {ram_mb} MB")
    print()

    if "node_id" not in state:
        print("[MAC Worker] Registering with master...")
        resp, status = api_post(f"{base_url}/api/v1/cluster/register", {
            "hostname": name,
            "ip": "0.0.0.0",
            "token_hash": token_hash,
            "gpu_info": gpu_info,
            "cpu_cores": cpu_cores,
            "ram_mb": ram_mb,
            "tags": ["agent-enrolled"],
        })
        if status in (200, 201):
            state["node_id"] = resp.get("node_id", "")
            state["token_hash"] = token_hash
            save_state(state)
            print(f"[MAC Worker] Registered: node_id={state['node_id']}, status={resp.get('status')}")
        else:
            print(f"[MAC Worker] Registration failed ({status}): {resp.get('detail', resp)}")
            sys.exit(1)

    node_id = state["node_id"]
    print(f"[MAC Worker] Heartbeat loop (every {heartbeat_sec}s) for node {node_id}")

    while True:
        try:
            resp, status = api_post(f"{base_url}/api/v1/cluster/heartbeat", {
                "node_id": node_id,
                "token_hash": token_hash,
                "metrics": {
                    "gpu": gpu_info,
                    "cpu_cores": cpu_cores,
                    "ram_mb": ram_mb,
                    "vllm_port": vllm_port,
                },
            })
            if status == 200:
                print(f"[Heartbeat] OK — {time.strftime('%H:%M:%S')}")
            elif status == 403:
                print(f"[Heartbeat] Pending approval — {time.strftime('%H:%M:%S')}")
            else:
                print(f"[Heartbeat] {status}: {resp.get('detail', '')}")
        except Exception as e:
            print(f"[Heartbeat] Error: {e}")
        time.sleep(heartbeat_sec)

if __name__ == "__main__":
    main()
