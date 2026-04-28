"""Notification and audit log models."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class Notification(Base):
    """Push/in-app notification for a user."""
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="general")
    # general | doubt_reply | attendance | system | admin
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class PushSubscription(Base):
    """Web Push subscription for browser notifications."""
    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh_key: Mapped[str] = mapped_column(String(200), nullable=False)
    auth_key: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class AuditLog(Base):
    """Comprehensive audit trail for admin/faculty/system actions."""
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # user_id or "system"
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False, default="system")
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    # e.g. user.login, key.create, node.enroll, model.deploy, attendance.mark, doubt.reply
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, default="system")
    resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    details: Mapped[str] = mapped_column(Text, nullable=True)  # JSON-encoded before/after or extra info
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)


class ScopedApiKey(Base):
    """Advanced API key with scoped permissions, rate limits, and expiry."""
    __tablename__ = "scoped_api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False)  # first 8 chars for display
    key_hash: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    # Scoping
    allowed_models: Mapped[str] = mapped_column(Text, nullable=True)  # JSON list of model IDs, null = all
    allowed_endpoints: Mapped[str] = mapped_column(Text, nullable=True)  # JSON list, null = all
    # Limits
    requests_per_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    tokens_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=50000)
    max_tokens_per_request: Mapped[int] = mapped_column(Integer, nullable=False, default=4096)
    # State
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_requests: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
