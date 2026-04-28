"""Quota override models."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class QuotaOverride(Base):
    __tablename__ = "quota_overrides"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    daily_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    requests_per_hour: Mapped[int] = mapped_column(Integer, nullable=False)
    max_tokens_per_request: Mapped[int] = mapped_column(Integer, nullable=False, default=4096)
    reason: Mapped[str] = mapped_column(String(200), nullable=False, default="Admin override")
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
