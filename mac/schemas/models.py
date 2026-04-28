"""Model management schemas (Phase 2)."""

from pydantic import BaseModel, Field
from typing import Optional, List


class ModelLoadRequest(BaseModel):
    """Load a model into GPU memory."""
    pass


class ModelUnloadRequest(BaseModel):
    """Unload model from GPU memory."""
    pass


class ModelDownloadRequest(BaseModel):
    """Download a model from registry."""
    model_id: str = Field(..., examples=["qwen2.5-coder:7b"])


class ModelStatusResponse(BaseModel):
    model_id: str
    status: str  # loaded | downloading | queued | offline | unloaded
    message: str = ""


class ModelHealthResponse(BaseModel):
    model_id: str
    status: str = "ready"
    latency_ms: int = 0
    memory_mb: int = 0
    ready: bool = True


class DownloadProgressResponse(BaseModel):
    task_id: str
    model_id: str
    status: str = "downloading"  # downloading | completed | error
    progress_pct: float = 0.0
    downloaded_gb: float = 0.0
    total_gb: float = 0.0
    message: str = ""
