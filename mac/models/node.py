"""Worker node and model deployment models for distributed compute cluster."""

import uuid
import secrets
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, Float, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class WorkerNode(Base):
    """A worker PC in the distributed cluster."""
    __tablename__ = "worker_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    hostname: Mapped[str] = mapped_column(String(200), nullable=False)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)  # IPv4/IPv6
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=8001)
    token_hash: Mapped[str] = mapped_column(String(200), nullable=False)  # hashed enrollment token
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # pending | active | draining | offline | error
    gpu_name: Mapped[str] = mapped_column(String(100), nullable=True)
    gpu_vram_mb: Mapped[int] = mapped_column(Integer, nullable=True)
    ram_total_mb: Mapped[int] = mapped_column(Integer, nullable=True)
    cpu_cores: Mapped[int] = mapped_column(Integer, nullable=True)
    # Live metrics (updated by heartbeat)
    gpu_util_pct: Mapped[float] = mapped_column(Float, nullable=True)
    gpu_vram_used_mb: Mapped[int] = mapped_column(Integer, nullable=True)
    ram_used_mb: Mapped[int] = mapped_column(Integer, nullable=True)
    cpu_util_pct: Mapped[float] = mapped_column(Float, nullable=True)
    last_heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_resource_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=85)
    notebook_port: Mapped[int | None] = mapped_column(Integer, nullable=True)  # port for Jupyter kernel gateway
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)  # comma-separated capability tags
    # Metadata
    enrolled_by: Mapped[str] = mapped_column(String(36), nullable=True)  # admin user_id
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    deployments: Mapped[list["NodeModelDeployment"]] = relationship(
        back_populates="node", cascade="all, delete-orphan"
    )


class NodeModelDeployment(Base):
    """A model deployed on a specific worker node."""
    __tablename__ = "node_model_deployments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    node_id: Mapped[str] = mapped_column(String(36), ForeignKey("worker_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)  # e.g. "qwen2.5:7b"
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    served_name: Mapped[str] = mapped_column(String(300), nullable=False)  # HF model path or custom name
    vllm_port: Mapped[int] = mapped_column(Integer, nullable=False, default=8001)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # pending | downloading | loading | ready | error | unloaded
    gpu_memory_util: Mapped[float] = mapped_column(Float, nullable=False, default=0.85)
    max_model_len: Mapped[int] = mapped_column(Integer, nullable=False, default=8192)
    error_message: Mapped[str] = mapped_column(Text, nullable=True)
    deployed_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    node: Mapped["WorkerNode"] = relationship(back_populates="deployments")


class EnrollmentToken(Base):
    """Short-lived token for worker node enrollment."""
    __tablename__ = "enrollment_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    token_hash: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False, default="Worker Node")
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    used_by_node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
