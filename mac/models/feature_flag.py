"""Feature flag model — master switches for app features.

Each flag controls one feature (ai_chat, image_gen, etc) and which roles
may access it. Read by `feature_flag_service` and gated via the
`feature_required(key)` middleware dependency.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class FeatureFlag(Base):
    """A feature toggle. `enabled=False` shuts the feature off entirely.
    `allowed_roles` further restricts who may use it when enabled.
    """
    __tablename__ = "feature_flags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # JSON list of role strings; empty list = no role allowed (effectively disabled)
    allowed_roles: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
