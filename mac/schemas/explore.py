"""Explore schemas."""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class ModelInfo(BaseModel):
    id: str
    name: str
    model_type: str = "chat"  # chat, stt, tts, embedding, vision
    specialty: str = ""
    parameters: str = ""
    context_length: int = 4096
    quantisation: str = ""
    vram_mb: int = 0
    status: str = "loaded"
    capabilities: List[str] = []
    loaded_at: Optional[str] = None


class ModelDetail(ModelInfo):
    benchmarks: Dict[str, float] = {}
    example_prompt: str = ""
    supported_languages: List[str] = []
    total_requests_served: int = 0


class ModelsListResponse(BaseModel):
    models: List[ModelInfo]
    total: int
    page: int = 1
    per_page: int = 20


class EndpointInfo(BaseModel):
    method: str
    path: str
    auth_required: bool
    description: str
    request_content_type: str = "application/json"


class EndpointsResponse(BaseModel):
    endpoints: List[EndpointInfo]
    total: int


class NodeHealth(BaseModel):
    id: str
    gpu: str = "CPU"
    gpu_temp_c: int = 0
    vram_used_gb: float = 0
    vram_total_gb: float = 0
    models_loaded: List[str] = []
    requests_in_flight: int = 0
    status: str = "active"
    context_window: int = 8192


class HealthResponse(BaseModel):
    status: str = "healthy"
    uptime_seconds: int = 0
    version: str = "1.0.0"
    nodes: List[NodeHealth] = []
    queue_depth: int = 0
    models_loaded: int = 0
    models_total: int = 0


class UsageStatsResponse(BaseModel):
    today: Dict[str, Any] = {}
    this_week: Dict[str, Any] = {}
    top_models: List[Dict[str, Any]] = []
    peak_hour: str = ""
