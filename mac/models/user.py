"""User, RefreshToken, UsageLog & StudentRegistry models."""

import uuid
import secrets
from datetime import datetime, date, timezone
from sqlalchemy import String, Boolean, Integer, DateTime, Date, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


def _gen_api_key():
    return f"mac_sk_live_{secrets.token_hex(24)}"


class StudentRegistry(Base):
    """Pre‑loaded college registry — only students whose roll numbers exist
    here are allowed to sign up.  Admins bulk‑import this data."""
    __tablename__ = "student_registry"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    roll_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    department: Mapped[str] = mapped_column(String(20), nullable=False, default="CSE")
    dob: Mapped[date] = mapped_column(Date, nullable=False)          # DD‑MM‑YYYY at entry
    batch_year: Mapped[int] = mapped_column(Integer, nullable=True)   # e.g. 2021


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    roll_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(200), nullable=True)
    department: Mapped[str] = mapped_column(String(20), nullable=False, default="CSE")
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="student")  # student | faculty | admin
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    api_key: Mapped[str] = mapped_column(String(100), unique=True, default=_gen_api_key)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── Session 1 additions ─────────────────────────────────
    # Academic placement. FKs are intentionally omitted at column-level
    # to avoid hard ondelete coupling — admins must reassign on delete.
    branch_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    section_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Permissions
    can_create_users: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_founder: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Storage (per-user quotas, MB)
    storage_quota_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=2048)
    storage_used_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Per-user feature toggles
    cc_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # When set, overrides user theme preference (admin-forced "light"/"dark")
    forced_theme: Mapped[str | None] = mapped_column(String(8), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    usage_logs: Mapped[list["UsageLog"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(100), nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    request_id: Mapped[str] = mapped_column(String(50), nullable=False, default=_gen_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)

    user: Mapped["User"] = relationship(back_populates="usage_logs")
