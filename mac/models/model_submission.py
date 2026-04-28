"""Model submission and community model registry models.

Lifecycle: submitted → approved | rejected → deploying → live | failed
Any user with admin token can submit a HuggingFace/GitHub model link.
Their PC becomes a worker node hosting that model once approved & deployed.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, Text, ForeignKey, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class ModelSubmission(Base):
    """A user-submitted model for the community registry."""
    __tablename__ = "model_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    submitter_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Model identity
    model_source: Mapped[str] = mapped_column(String(20), nullable=False)
    # huggingface | github | custom
    model_url: Mapped[str] = mapped_column(String(500), nullable=False)
    model_id: Mapped[str] = mapped_column(String(200), nullable=False)
    # e.g. "Qwen/Qwen2.5-7B-Instruct" or "github.com/user/repo"
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="general")
    # speed | code | reasoning | intelligence | general
    parameters: Mapped[str] = mapped_column(String(20), nullable=True)
    # e.g. "7B", "14B", "70B"
    context_length: Mapped[int] = mapped_column(Integer, default=4096)
    quantization: Mapped[str] = mapped_column(String(20), nullable=True)
    # e.g. "AWQ", "GPTQ", "FP16", "BF16", None
    min_vram_gb: Mapped[float] = mapped_column(Float, default=0.0)

    # Worker node assignment
    worker_node_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("worker_nodes.id", ondelete="SET NULL"), nullable=True)
    vllm_port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Review lifecycle
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted", index=True)
    # submitted | approved | rejected | deploying | live | failed | retired
    reviewed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Metadata
    download_size_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_gated: Mapped[bool] = mapped_column(Boolean, default=False)
    hf_token_required: Mapped[bool] = mapped_column(Boolean, default=False)
    capabilities: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # e.g. ["chat", "code", "reasoning"]

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
