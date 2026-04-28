"""Hardware detection schemas."""

from typing import Optional
from pydantic import BaseModel, Field


class CPUInfo(BaseModel):
    brand: str = "Unknown"
    cores_physical: int = 0
    cores_logical: int = 0
    freq_mhz: float = 0.0


class RAMInfo(BaseModel):
    total_mb: int = 0
    available_mb: int = 0


class DiskInfo(BaseModel):
    total_gb: float = 0.0
    free_gb: float = 0.0


class GPUInfo(BaseModel):
    name: str
    vram_total_mb: int = 0
    vram_free_mb: int = 0
    utilization_pct: float = 0.0
    cuda_version: Optional[str] = None
    vendor: str = "unknown"  # nvidia | amd | intel | unknown


class DockerInfo(BaseModel):
    available: bool = False
    version: Optional[str] = None


class HardwareProfile(BaseModel):
    hostname: str
    os: str
    tier: str  # GPU_NVIDIA | GPU_AMD | CPU_ONLY
    cpu: CPUInfo
    ram: RAMInfo
    disk: DiskInfo
    gpus: list[GPUInfo] = Field(default_factory=list)
    docker: DockerInfo


class ModelRecommendation(BaseModel):
    id: str
    size_gb: float
    min_vram_gb: int
    tier: str
    tag: str  # RECOMMENDED | POSSIBLE | NOT_RECOMMENDED | CPU_ONLY
    specialty: str
    reason: Optional[str] = None
