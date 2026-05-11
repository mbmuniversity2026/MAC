"""MBM Book IDE — per-user container session model."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class MBMBookSession(Base):
    """One Docker workspace container per user."""
    __tablename__ = "mbmbook_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True, index=True)

    # Docker container
    container_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    container_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Workspace volume (persists across sessions, deleted only on explicit clear)
    volume_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Cluster node where container lives
    node_ip: Mapped[str] = mapped_column(String(45), nullable=False, default="local")
    node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Status lifecycle: starting → running → stopped → error
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="starting")

    # Resource snapshot at allocation time
    cpu_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ram_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_activity: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
