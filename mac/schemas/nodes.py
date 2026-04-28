"""Schemas for worker node management and model deployment."""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


# ── Enrollment Tokens ─────────────────────────────────────

class CreateEnrollmentTokenRequest(BaseModel):
    label: str = Field(default="Worker Node", max_length=100)
    expires_in_hours: int = Field(default=24, ge=1, le=168)  # max 7 days


class EnrollmentTokenResponse(BaseModel):
    token: str  # plain token, shown only once
    label: str
    expires_at: datetime


# ── Node Enrollment ───────────────────────────────────────

class NodeEnrollRequest(BaseModel):
    enrollment_token: str
    name: str = Field(max_length=100)
    hostname: str = Field(max_length=200)
    ip_address: str = Field(max_length=45)
    port: int = Field(default=8001, ge=1, le=65535)
    gpu_name: Optional[str] = None
    gpu_vram_mb: Optional[int] = None
    ram_total_mb: Optional[int] = None
    cpu_cores: Optional[int] = None


class NodeInfoResponse(BaseModel):
    id: str
    name: str
    hostname: str
    ip_address: str
    port: int
    status: str
    gpu_name: Optional[str]
    gpu_vram_mb: Optional[int]
    ram_total_mb: Optional[int]
    cpu_cores: Optional[int]
    gpu_util_pct: Optional[float]
    gpu_vram_used_mb: Optional[int]
    ram_used_mb: Optional[int]
    cpu_util_pct: Optional[float]
    last_heartbeat: Optional[datetime]
    max_resource_pct: int
    deployments: list["DeploymentInfoResponse"] = []
    created_at: datetime


# ── Heartbeat ─────────────────────────────────────────────

class NodeHeartbeatRequest(BaseModel):
    gpu_util_pct: Optional[float] = None
    gpu_vram_used_mb: Optional[int] = None
    ram_used_mb: Optional[int] = None
    cpu_util_pct: Optional[float] = None


# ── Model Deployment ──────────────────────────────────────

class DeployModelRequest(BaseModel):
    node_id: str
    model_id: str = Field(max_length=100)
    model_name: str = Field(max_length=200)
    served_name: str = Field(max_length=300)  # HuggingFace model path
    vllm_port: int = Field(default=8001, ge=1, le=65535)
    gpu_memory_util: float = Field(default=0.85, ge=0.1, le=0.95)
    max_model_len: int = Field(default=8192, ge=512, le=131072)


class DeploymentInfoResponse(BaseModel):
    id: str
    node_id: str
    model_id: str
    model_name: str
    served_name: str
    vllm_port: int
    status: str
    gpu_memory_util: float
    max_model_len: int
    error_message: Optional[str]
    deployed_by: str
    created_at: datetime


class NodeListResponse(BaseModel):
    nodes: list[NodeInfoResponse]
    total: int


class ClusterStatusResponse(BaseModel):
    total_nodes: int
    active_nodes: int
    total_models_deployed: int
    models_ready: int
    total_gpu_vram_mb: int
    total_gpu_vram_used_mb: int
