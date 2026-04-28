"""Doubts / Q&A system — student-to-faculty messaging."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class Doubt(Base):
    """A question posted by a student to faculty/department."""
    __tablename__ = "doubts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    department: Mapped[str] = mapped_column(String(50), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=True)
    # Target: specific faculty user_id, or null = all dept faculty
    target_faculty_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    # open | answered | closed
    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    attachment_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    replies: Mapped[list["DoubtReply"]] = relationship(
        back_populates="doubt", cascade="all, delete-orphan"
    )


class DoubtReply(Base):
    """A reply to a doubt by faculty or admin."""
    __tablename__ = "doubt_replies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    doubt_id: Mapped[str] = mapped_column(String(36), ForeignKey("doubts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    attachment_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    doubt: Mapped["Doubt"] = relationship(back_populates="replies")
