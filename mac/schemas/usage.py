"""Usage tracking schemas."""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class ModelUsage(BaseModel):
    tokens: int = 0
    requests: int = 0


class PeriodUsage(BaseModel):
    total_tokens: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    requests: int = 0
    by_model: Dict[str, ModelUsage] = {}


class QuotaStatus(BaseModel):
    daily_limit: int
    remaining_today: int
    resets_at: str


class MyUsageResponse(BaseModel):
    roll_number: str
    usage: Dict[str, Any]
    quota: QuotaStatus


class RequestHistoryItem(BaseModel):
    id: str
    model: str
    endpoint: str
    tokens_in: int
    tokens_out: int
    latency_ms: int
    status_code: int
    created_at: str


class HistoryResponse(BaseModel):
    requests: List[RequestHistoryItem]
    total: int
    page: int
    per_page: int


class QuotaResponse(BaseModel):
    role: str
    limits: Dict[str, int]
    current: Dict[str, int]
    resets: Dict[str, str]
    has_override: bool = False


class AdminUserUsage(BaseModel):
    roll_number: str
    name: str
    department: str
    tokens_today: int = 0
    requests_today: int = 0
    quota_used_pct: float = 0.0
    last_active: Optional[str] = None


class AdminAllUsageResponse(BaseModel):
    users: List[AdminUserUsage]
    total_users: int
    page: int


class AdminModelUsage(BaseModel):
    model_id: str
    requests_today: int = 0
    tokens_today: int = 0
    avg_latency_ms: int = 0
    unique_users_today: int = 0
    error_rate_pct: float = 0.0


class AdminModelsResponse(BaseModel):
    models: List[AdminModelUsage]
