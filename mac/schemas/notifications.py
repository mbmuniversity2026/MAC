"""Schemas for notifications and audit logs."""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


# ── Notifications ─────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: str
    title: str
    body: str
    category: str
    link: Optional[str]
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    total: int
    unread_count: int


class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh_key: str
    auth_key: str


# ── Audit Logs ────────────────────────────────────────────

class AuditLogResponse(BaseModel):
    id: str
    actor_id: Optional[str]
    actor_role: str
    action: str
    resource_type: str
    resource_id: Optional[str]
    details: Optional[str]
    ip_address: Optional[str]
    created_at: datetime


class AuditLogListResponse(BaseModel):
    logs: list[AuditLogResponse]
    total: int
    page: int
    per_page: int


# ── Scoped API Keys ──────────────────────────────────────

class CreateScopedKeyRequest(BaseModel):
    name: str = Field(max_length=100)
    allowed_models: Optional[list[str]] = None  # null = all
    allowed_endpoints: Optional[list[str]] = None  # null = all
    requests_per_hour: int = Field(default=100, ge=1, le=10000)
    tokens_per_day: int = Field(default=50000, ge=1000, le=5000000)
    max_tokens_per_request: int = Field(default=4096, ge=256, le=32768)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=365)


class ScopedKeyResponse(BaseModel):
    id: str
    name: str
    key_prefix: str
    key: Optional[str] = None  # full key shown only on creation
    allowed_models: Optional[list[str]]
    allowed_endpoints: Optional[list[str]]
    requests_per_hour: int
    tokens_per_day: int
    max_tokens_per_request: int
    is_active: bool
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]
    total_requests: int
    total_tokens: int
    created_at: datetime


class ScopedKeyListResponse(BaseModel):
    keys: list[ScopedKeyResponse]
    total: int
