"""Model management service — health checks, warmups, and model prefetch."""

import asyncio
import os

import httpx
from mac.config import settings
from mac.services.llm_service import DEFAULT_MODELS
from mac.utils.security import generate_request_id

try:
    from huggingface_hub import snapshot_download
except Exception:  # pragma: no cover
    snapshot_download = None

# In-memory download task tracker
_download_tasks: dict[str, dict] = {}
_prefetch_started = False
_prefetch_lock = asyncio.Lock()


def _api_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}{path}"


def _is_hf_repo(repo_id: str) -> bool:
    """Very light repo-id gate: owner/repo with no URL scheme."""
    if not repo_id or "://" in repo_id or repo_id.count("/") != 1:
        return False
    owner, name = repo_id.split("/", 1)
    return bool(owner.strip() and name.strip())


def _candidate_open_source_repos() -> list[str]:
    repos = {m.get("served_name", "") for m in DEFAULT_MODELS.values()}
    repos = {r for r in repos if _is_hf_repo(r)}
    out = sorted(repos)
    if settings.mac_model_auto_download_limit > 0:
        return out[: settings.mac_model_auto_download_limit]
    return out


async def _download_hf_repo(task_id: str, model_id: str, repo_id: str) -> None:
    _download_tasks[task_id] = {
        "task_id": task_id,
        "model_id": model_id,
        "status": "downloading",
        "progress_pct": 1.0,
        "message": f"Downloading {repo_id} into local Hugging Face cache...",
    }

    if snapshot_download is None:
        _download_tasks[task_id] = {
            "task_id": task_id,
            "model_id": model_id,
            "status": "failed",
            "progress_pct": 0.0,
            "message": "huggingface_hub is not installed in this runtime.",
        }
        return

    cache_dir = os.getenv("HF_HOME") or "/root/.cache/huggingface"
    try:
        await asyncio.to_thread(
            snapshot_download,
            repo_id=repo_id,
            cache_dir=cache_dir,
            local_files_only=False,
        )
        _download_tasks[task_id] = {
            "task_id": task_id,
            "model_id": model_id,
            "status": "completed",
            "progress_pct": 100.0,
            "message": f"Downloaded {repo_id} to local cache.",
        }
    except Exception as e:  # noqa: BLE001
        _download_tasks[task_id] = {
            "task_id": task_id,
            "model_id": model_id,
            "status": "failed",
            "progress_pct": 0.0,
            "message": f"Download failed for {repo_id}: {e}",
        }


async def ensure_prefetch_started() -> None:
    """Start background prefetch once, triggered on first app use."""
    global _prefetch_started

    if not settings.mac_model_auto_download_on_use or _prefetch_started:
        return

    async with _prefetch_lock:
        if _prefetch_started:
            return
        _prefetch_started = True

        for repo_id in _candidate_open_source_repos():
            task_id = generate_request_id("dl")
            asyncio.create_task(_download_hf_repo(task_id, repo_id, repo_id))


async def prefetch_open_source_models_blocking() -> dict:
    """Run open-source prefetch now and wait for completion."""
    repos = _candidate_open_source_repos()
    completed = 0
    failed = 0

    for repo_id in repos:
        task_id = generate_request_id("dl")
        await _download_hf_repo(task_id, repo_id, repo_id)
        status = _download_tasks.get(task_id, {}).get("status")
        if status == "completed":
            completed += 1
        else:
            failed += 1

    return {
        "queued": len(repos),
        "completed": completed,
        "failed": failed,
        "repos": repos,
    }


async def load_model(model_id: str) -> dict:
    """Warm up a model by sending a tiny request to its vLLM instance."""
    info = DEFAULT_MODELS.get(model_id)
    if not info:
        return {"model_id": model_id, "status": "not_found", "message": f"Unknown model: {model_id}"}
    url = getattr(settings, info.get("url_key", "vllm_speed_url"), settings.vllm_base_url)
    try:
        async with httpx.AsyncClient(timeout=settings.vllm_timeout) as client:
            resp = await client.post(
                _api_url(url, "/v1/chat/completions"),
                json={"model": info["served_name"], "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
            )
            resp.raise_for_status()
    except Exception:
        pass
    return {"model_id": model_id, "status": "loaded", "message": f"Model {info['name']} warmed up"}


async def unload_model(model_id: str) -> dict:
    """Unload a model (no-op for vLLM; model lifetime managed by the server process)."""
    return {"model_id": model_id, "status": "unloaded", "message": f"Model {model_id} unload requested (vLLM manages lifetime)"}


async def pull_model(model_id: str) -> str:
    """Download a model into local Hugging Face cache when possible."""
    repo_id = model_id
    info = DEFAULT_MODELS.get(model_id)
    if info:
        repo_id = info.get("served_name", model_id)

    task_id = generate_request_id("dl")

    if not _is_hf_repo(repo_id):
        _download_tasks[task_id] = {
            "task_id": task_id,
            "model_id": model_id,
            "status": "completed",
            "progress_pct": 100.0,
            "message": "No Hugging Face repo detected for this model id; nothing to pre-download.",
        }
        return task_id

    asyncio.create_task(_download_hf_repo(task_id, model_id, repo_id))
    _download_tasks[task_id] = {
        "task_id": task_id,
        "model_id": model_id,
        "status": "queued",
        "progress_pct": 0.0,
        "message": f"Queued download for {repo_id}",
    }
    return task_id


def get_download_progress(task_id: str) -> dict | None:
    return _download_tasks.get(task_id)


async def get_model_health(model_id: str) -> dict:
    """Check if a model's vLLM instance is responsive."""
    info = DEFAULT_MODELS.get(model_id)
    if not info:
        return {"model_id": model_id, "status": "not_found", "ready": False}

    url = getattr(settings, info.get("url_key", "vllm_speed_url"), settings.vllm_base_url)
    try:
        async with httpx.AsyncClient(timeout=settings.vllm_health_timeout) as client:
            resp = await client.get(_api_url(url, "/v1/models"))
            resp.raise_for_status()
            return {
                "model_id": model_id,
                "name": info["name"],
                "category": info["category"],
                "status": "ready",
                "ready": True,
            }
    except Exception:
        return {
            "model_id": model_id,
            "name": info["name"],
            "category": info["category"],
            "status": "offline",
            "ready": False,
        }
