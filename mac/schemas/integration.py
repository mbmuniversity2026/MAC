"""Integration schemas (Phase 3)."""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict


class RoutingRule(BaseModel):
    task_type: str  # code | math | vision | audio | general
    target_model: str
    priority: int = 1
    enabled: bool = True


class RoutingRulesResponse(BaseModel):
    rules: List[RoutingRule]


class RoutingRulesUpdateRequest(BaseModel):
    rules: List[RoutingRule]


class WorkerInfo(BaseModel):
    node_id: str
    host: str
    gpu: str = "CPU"
    gpu_temp_c: int = 0
    vram_used_gb: float = 0.0
    vram_total_gb: float = 0.0
    models_loaded: List[str] = []
    requests_in_flight: int = 0
    status: str = "active"  # active | draining | offline


class WorkersResponse(BaseModel):
    workers: List[WorkerInfo]
    total: int


class QueueStatusResponse(BaseModel):
    queue_depth: int = 0
    avg_wait_ms: int = 0
    processing: int = 0
    pending: int = 0
