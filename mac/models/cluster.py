"""Cluster heartbeat ring buffer — time-series snapshots of worker node health.

Latest live metrics are stored on `worker_nodes` (see node.py); this table
keeps a rolling history for charts and alerts. Old rows can be pruned.
"""

from datetime import datetime, timezone
from sqlalchemy import String, Integer, BigInteger, SmallInteger, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class ClusterHeartbeat(Base):
    """Time-series sample of one worker node's resource usage."""
    __tablename__ = "cluster_heartbeats"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    node_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("worker_nodes.id", ondelete="CASCADE"), nullable=False
    )
    gpu_util: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)         # 0-100
    cpu_util: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)         # 0-100
    ram_used_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vram_used_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    queue_depth: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("idx_hb_node_time", "node_id", "recorded_at"),
    )
