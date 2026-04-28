"""Quota management schemas (Phase 4)."""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict


class QuotaLimitsResponse(BaseModel):
    roles: Dict[str, Dict[str, int]]  # role -> {daily_tokens, requests_per_hour, max_tokens_per_request}


class PersonalQuotaResponse(BaseModel):
    role: str
    limits: Dict[str, int]
    current: Dict[str, int]
    has_override: bool = False
    override_details: Optional[Dict[str, int]] = None


class QuotaOverrideRequest(BaseModel):
    daily_tokens: int = Field(..., ge=1000, le=10_000_000)
    requests_per_hour: int = Field(..., ge=10, le=10_000)
    max_tokens_per_request: int = Field(default=4096, ge=256, le=32768)
    reason: str = Field(default="Admin override", max_length=200)


class QuotaOverrideResponse(BaseModel):
    roll_number: str
    daily_tokens: int
    requests_per_hour: int
    max_tokens_per_request: int
    reason: str
    message: str = "Quota override applied"


class ExceededUserInfo(BaseModel):
    roll_number: str
    name: str
    department: str
    tokens_used: int
    daily_limit: int
    exceeded_by: int


class ExceededUsersResponse(BaseModel):
    users: List[ExceededUserInfo]
    total: int
