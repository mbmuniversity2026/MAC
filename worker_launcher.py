"""MAC Worker launcher.

Builds to worker.exe. It configures one Windows GPU PC as a MAC worker,
starts Docker/vLLM, and runs the heartbeat agent for the selected model.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


MASTER_DEFAULT = "http://10.10.12.115"
APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))

MODELS = [
    {
        "title": "Logic/Math",
        "label": "DeepSeek-R1-Distill-Llama-8B",
        "model": "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
        "gpu_mem": "0.90",
        "max_len": "4096",
    },
    {
        "title": "Programming",
        "label": "Qwen2.5-Coder-7B-Instruct",
        "model": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "gpu_mem": "0.90",
        "max_len": "8192",
    },
    {
        "title": "Speed/Chat",
        "label": "Sarvam-2B",
        "model": "sarvamai/sarvam-2b-v0.5",
        "gpu_mem": "0.55",
        "max_len": "4096",
    },
    {
        "title": "General Ed",
        "label": "Llama-3.1-8B-Instruct",
        "model": "meta-llama/Llama-3.1-8B-Instruct",
        "gpu_mem": "0.90",
        "max_len": "4096",
    },
    {
        "title": "Creative Arts",
        "label": "Mistral-7B-v0.3",
        "model": "mistralai/Mistral-7B-v0.3",
        "gpu_mem": "0.90",
        "max_len": "8192",
    },
]


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print("> " + " ".join(cmd))
    return subprocess.run(cmd, cwd=APP_DIR, check=check)


def lan_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("10.10.12.115", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return socket.gethostbyname(socket.gethostname())


def ensure_docker() -> None:
    if shutil.which("docker") and subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        print("[OK] Docker is running.")
        return

    docker_desktop = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe"
    if docker_desktop.exists():
        print("[INFO] Starting Docker Desktop...")
        subprocess.Popen([str(docker_desktop)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        input("Wait until Docker Desktop says it is running, then press Enter...")
        if subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            print("[OK] Docker is running.")
            return

    winget = shutil.which("winget")
    if winget:
        print("[INFO] Docker Desktop is not installed. Installing it now with winget...")
        run([
            winget,
            "install",
            "-e",
            "--id",
            "Docker.DockerDesktop",
            "--accept-source-agreements",
            "--accept-package-agreements",
        ])
        print("[INFO] Starting Docker Desktop...")
        docker_desktop = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe"
        if docker_desktop.exists():
            subprocess.Popen([str(docker_desktop)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("[INFO] Docker may need WSL2 setup or a Windows restart after first install.")
        input("After Docker Desktop finishes starting, press Enter to continue...")
        for _ in range(24):
            if shutil.which("docker") and subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                print("[OK] Docker is running.")
                return
            time.sleep(5)

    print("[ERROR] Docker Desktop could not be started automatically.")
    print("Restart this PC if Docker was just installed, then run worker.exe again.")
    raise SystemExit(1)


def choose_model() -> dict:
    print()
    print("Select the model this PC will host:")
    for idx, item in enumerate(MODELS, 1):
        print(f"  {idx}. {item['title']}: {item['label']}")
    raw = input("Choice [1-5, default 3]: ").strip() or "3"
    try:
        index = max(1, min(len(MODELS), int(raw))) - 1
    except ValueError:
        index = 2
    return MODELS[index]


def write_env(model: dict) -> None:
    master = (input(f"MAC host URL [{MASTER_DEFAULT}]: ").strip() or MASTER_DEFAULT).rstrip("/")
    token = input("Enrollment token from Admin > Cluster: ").strip()
    if not token:
        print("[ERROR] Enrollment token is required.")
        raise SystemExit(1)
    name = input("Worker name [this PC hostname]: ").strip() or os.environ.get("COMPUTERNAME", "MAC-Worker")
    hf_token = input("Hugging Face token if the model is gated [optional]: ").strip()

    lines = [
        f"MAC_MASTER_URL={master}",
        f"MAC_ENROLL_TOKEN={token}",
        f"MAC_WORKER_NAME={name}",
        f"MAC_WORKER_IP={lan_ip()}",
        "VLLM_PORT=8001",
        "MAC_VLLM_PORT=8001",
        "MAC_HEARTBEAT_SEC=10",
        f"VLLM_MODEL={model['model']}",
        f"MAC_VLLM_MODEL={model['model']}",
        f"VLLM_GPU_MEM={model['gpu_mem']}",
        f"VLLM_MAX_LEN={model['max_len']}",
    ]
    if hf_token:
        lines.append(f"HF_TOKEN={hf_token}")
    (APP_DIR / ".env.worker").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[OK] Saved worker config for {model['label']}.")


def main() -> None:
    print("===================================================")
    print(" MAC Worker Node | MBM AI Cloud")
    print(" Contribute one GPU model to 10.10.12.115")
    print("===================================================")
    print()

    for bundled in ("docker-compose.worker.yml", "worker_agent.py"):
        src = BUNDLE_DIR / bundled
        dst = APP_DIR / bundled
        if src.exists() and not dst.exists():
            shutil.copy2(src, dst)

    needed = ["docker-compose.worker.yml", "worker_agent.py"]
    missing = [name for name in needed if not (APP_DIR / name).exists()]
    if missing:
        print("[ERROR] Missing files next to worker.exe: " + ", ".join(missing))
        raise SystemExit(1)

    ensure_docker()
    model = choose_model()
    write_env(model)

    run(["netsh", "advfirewall", "firewall", "add", "rule", "name=MAC Worker vLLM", "dir=in", "action=allow", "protocol=TCP", "localport=8001", "profile=any"], check=False)
    print()
    print("[INFO] Starting vLLM. First run downloads the model from Hugging Face.")
    print("[INFO] Keep this window open for logs, or use Docker Desktop to monitor containers.")
    run(["docker", "compose", "-f", "docker-compose.worker.yml", "--env-file", ".env.worker", "up", "-d", "--remove-orphans"])
    run(["docker", "compose", "-f", "docker-compose.worker.yml", "--env-file", ".env.worker", "logs", "-f", "--tail=80"], check=False)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] Command failed with exit code {exc.returncode}.")
        input("Press Enter to exit...")
        raise SystemExit(exc.returncode)
    except KeyboardInterrupt:
        print("\nStopped.")
