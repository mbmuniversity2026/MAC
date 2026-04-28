"""System-wide key/value configuration store.

Used to persist values that must survive restarts but are generated at runtime
(e.g., the JWT secret created at first boot, the MAC server's UUID, etc).
"""

from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class SystemConfig(Base):
    """Single-row-per-key persistent settings."""
    __tablename__ = "system_config"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
