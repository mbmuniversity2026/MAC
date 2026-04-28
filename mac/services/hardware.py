"""Hardware detection — CPU, RAM, disk, GPUs, Docker.

Every probe is wrapped in try/except and returns sensible defaults.
Never raises. Tier classification picks the strongest available accelerator;
falls back to CPU_ONLY when nothing else works.
"""

import asyncio
import logging
import platform
import shutil
import socket
import subprocess
from typing import Any

log = logging.getLogger(__name__)


def _safe_cpu_info() -> dict:
    out = {"brand": "Unknown", "cores_physical": 0, "cores_logical": 0, "freq_mhz": 0.0}
    try:
        import psutil
        out["cores_physical"] = psutil.cpu_count(logical=False) or 0
        out["cores_logical"] = psutil.cpu_count(logical=True) or 0
        try:
            f = psutil.cpu_freq()
            if f:
                out["freq_mhz"] = float(f.max or f.current or 0)
        except Exception:  # noqa: BLE001
            pass
    except Exception:  # noqa: BLE001
        pass
    try:
        import cpuinfo
        info = cpuinfo.get_cpu_info()
        out["brand"] = info.get("brand_raw") or info.get("brand", "Unknown")
    except Exception:  # noqa: BLE001
        out["brand"] = platform.processor() or "Unknown"
    return out


def _safe_ram_info() -> dict:
    out = {"total_mb": 0, "available_mb": 0}
    try:
        import psutil
        m = psutil.virtual_memory()
        out["total_mb"] = int(m.total / (1024 * 1024))
        out["available_mb"] = int(m.available / (1024 * 1024))
    except Exception:  # noqa: BLE001
        pass
    return out


def _safe_disk_info() -> dict:
    out = {"total_gb": 0.0, "free_gb": 0.0}
    try:
        usage = shutil.disk_usage("/")
        out["total_gb"] = round(usage.total / (1024 ** 3), 2)
        out["free_gb"] = round(usage.free / (1024 ** 3), 2)
    except Exception:  # noqa: BLE001
        pass
    return out


def _nvidia_smi_gpus() -> list[dict]:
    """Parse `nvidia-smi --query-gpu=...` if available."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,utilization.gpu,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
        gpus = []
        for line in result.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            gpus.append({
                "name": parts[0],
                "vram_total_mb": int(float(parts[1])),
                "vram_free_mb": int(float(parts[2])),
                "utilization_pct": float(parts[3]),
                "cuda_version": parts[4] if len(parts) > 4 else None,
                "vendor": "nvidia",
            })
        return gpus
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError, Exception):  # noqa: BLE001
        return []


def _gputil_gpus() -> list[dict]:
    try:
        import GPUtil
        out = []
        for g in GPUtil.getGPUs():
            out.append({
                "name": g.name,
                "vram_total_mb": int(g.memoryTotal),
                "vram_free_mb": int(g.memoryFree),
                "utilization_pct": float(g.load * 100),
                "cuda_version": None,
                "vendor": "nvidia",
            })
        return out
    except Exception:  # noqa: BLE001
        return []


def _safe_gpus() -> list[dict]:
    gpus = _nvidia_smi_gpus()
    if gpus:
        return gpus
    return _gputil_gpus()


def _safe_docker_info() -> dict:
    out = {"available": False, "version": None}
    try:
        result = subprocess.run(
            ["docker", "--version"], capture_output=True, text=True, timeout=3
        )
        if result.returncode == 0:
            out["available"] = True
            out["version"] = result.stdout.strip()
    except Exception:  # noqa: BLE001
        pass
    return out


def _classify_tier(gpus: list[dict]) -> str:
    if not gpus:
        return "CPU_ONLY"
    vendors = {g.get("vendor", "unknown") for g in gpus}
    if "nvidia" in vendors:
        return "GPU_NVIDIA"
    if "amd" in vendors:
        return "GPU_AMD"
    return "CPU_ONLY"


def _build_profile() -> dict:
    gpus = _safe_gpus()
    return {
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
        "tier": _classify_tier(gpus),
        "cpu": _safe_cpu_info(),
        "ram": _safe_ram_info(),
        "disk": _safe_disk_info(),
        "gpus": gpus,
        "docker": _safe_docker_info(),
    }


async def get_hardware_profile() -> dict:
    """Async wrapper around the (largely sync, subprocess-heavy) probe."""
    return await asyncio.to_thread(_build_profile)


# ── Model recommendations ─────────────────────────────────
RECOMMENDED_MODELS = [
    {"id": "Qwen/Qwen2.5-7B-Instruct-AWQ",        "size_gb": 4.9, "min_vram_gb": 6, "tier": "GPU_NVIDIA", "specialty": "General Chat"},
    {"id": "Qwen/Qwen2.5-Coder-7B-Instruct-AWQ",  "size_gb": 4.9, "min_vram_gb": 6, "tier": "GPU_NVIDIA", "specialty": "Code"},
    {"id": "vikhyatk/moondream2",                  "size_gb": 1.9, "min_vram_gb": 3, "tier": "GPU_NVIDIA", "specialty": "Vision"},
    {"id": "nomic-ai/nomic-embed-text-v1.5",       "size_gb": 0.5, "min_vram_gb": 1, "tier": "GPU_NVIDIA", "specialty": "Embeddings"},
    {"id": "bartowski/Qwen2.5-1.5B-Instruct-GGUF", "size_gb": 0.9, "min_vram_gb": 0, "tier": "CPU_ONLY",   "specialty": "Light Chat"},
    {"id": "openai/whisper-base",                  "size_gb": 0.15,"min_vram_gb": 0, "tier": "CPU_ONLY",   "specialty": "Speech-to-Text"},
]

RESERVE_DISK_GB = 15
RESERVE_RAM_MB = 2048


def _classify_model(model: dict, profile: dict) -> tuple[str, str]:
    """Return (tag, reason). tag is RECOMMENDED | POSSIBLE | NOT_RECOMMENDED | CPU_ONLY."""
    free_disk = profile.get("disk", {}).get("free_gb", 0) - RESERVE_DISK_GB
    if free_disk < model["size_gb"]:
        return ("NOT_RECOMMENDED", f"Insufficient disk (need {model['size_gb']:.1f}GB, have {free_disk:.1f}GB free)")
    gpus = profile.get("gpus", [])
    best_vram_gb = max((g.get("vram_total_mb", 0) for g in gpus), default=0) / 1024
    if model["min_vram_gb"] == 0:
        return ("CPU_ONLY", "Runs on CPU — slow but functional")
    if best_vram_gb >= model["min_vram_gb"] + 2:
        return ("RECOMMENDED", f"GPU has {best_vram_gb:.1f}GB VRAM (need {model['min_vram_gb']})")
    if best_vram_gb >= model["min_vram_gb"]:
        return ("POSSIBLE", f"GPU just barely fits ({best_vram_gb:.1f}GB / {model['min_vram_gb']}GB)")
    return ("NOT_RECOMMENDED", f"Insufficient VRAM (need {model['min_vram_gb']}GB, have {best_vram_gb:.1f}GB)")


async def get_model_recommendations(profile: dict | None = None) -> list[dict]:
    if profile is None:
        profile = await get_hardware_profile()
    out = []
    for m in RECOMMENDED_MODELS:
        tag, reason = _classify_model(m, profile)
        out.append({**m, "tag": tag, "reason": reason})
    return out
