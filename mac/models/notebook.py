"""Notebook, cell, and execution models — durable notebook architecture."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, Text, ForeignKey, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class Notebook(Base):
    """A user-owned notebook containing ordered cells."""
    __tablename__ = "notebooks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="Untitled Notebook")
    description: Mapped[str] = mapped_column(Text, nullable=True)
    language: Mapped[str] = mapped_column(String(30), nullable=False, default="python")
    # python | javascript | bash | markdown
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="private")
    # private | shared | public
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    cell_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    cells: Mapped[list["NotebookCell"]] = relationship(
        back_populates="notebook", cascade="all, delete-orphan", order_by="NotebookCell.position"
    )


class NotebookCell(Base):
    """A single cell in a notebook — code or markdown."""
    __tablename__ = "notebook_cells"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    notebook_id: Mapped[str] = mapped_column(String(36), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False, index=True)
    cell_type: Mapped[str] = mapped_column(String(20), nullable=False, default="code")
    # code | markdown | raw
    language: Mapped[str] = mapped_column(String(30), nullable=True)  # override notebook default
    source: Mapped[str] = mapped_column(Text, nullable=False, default="")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    notebook: Mapped["Notebook"] = relationship(back_populates="cells")
    executions: Mapped[list["CellExecution"]] = relationship(
        back_populates="cell", cascade="all, delete-orphan", order_by="CellExecution.created_at.desc()"
    )


class CellExecution(Base):
    """Execution record for a notebook cell — immutable history."""
    __tablename__ = "cell_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    cell_id: Mapped[str] = mapped_column(String(36), ForeignKey("notebook_cells.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    # queued | running | completed | failed | cancelled | timeout
    source_snapshot: Mapped[str] = mapped_column(Text, nullable=False)  # code at time of execution
    stdout: Mapped[str | None] = mapped_column(Text, nullable=True)
    stderr: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # structured output / display data
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    worker_node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # which node ran it
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    cell: Mapped["NotebookCell"] = relationship(back_populates="executions")
