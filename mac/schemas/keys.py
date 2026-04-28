"""API key management schemas (Phase 4)."""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ApiKeyInfo(BaseModel):
    key_prefix: str  # first 12 chars
    key_suffix: str  # last 4 chars
    created_at: str
    last_used: Optional[str] = None
    status: str = "active"


class ApiKeyGenerateResponse(BaseModel):
    api_key: str  # full key (shown only once)
    message: str = "Store this key securely — it will not be shown again."


class ApiKeyStatsResponse(BaseModel):
    tokens_today: int = 0
    tokens_this_week: int = 0
    tokens_this_month: int = 0
    requests_today: int = 0


class AdminKeyInfo(BaseModel):
    roll_number: str
    name: str
    key_prefix: str
    status: str = "active"
    tokens_today: int = 0
    last_used: Optional[str] = None


class AdminKeysResponse(BaseModel):
    keys: List[AdminKeyInfo]
    total: int

class AdminRevokeRequest(BaseModel):
    roll_number: str
    reason: str = "Admin revocation"
