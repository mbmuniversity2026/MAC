"""Attendance models — face-based daily attendance system."""

import uuid
from datetime import datetime, date, timezone
from sqlalchemy import String, Boolean, Integer, Float, DateTime, Date, Text, ForeignKey, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column, relationship
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class FaceTemplate(Base):
    """Stored face encoding for a user, captured during registration."""
    __tablename__ = "face_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    face_encoding: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)  # serialized face encoding
    photo_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # SHA-256 of original photo
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class AttendanceSession(Base):
    """A daily attendance session created by faculty for a department."""
    __tablename__ = "attendance_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str] = mapped_column(String(50), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=True)
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    opened_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    records: Mapped[list["AttendanceRecord"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class AttendanceRecord(Base):
    """Individual student attendance record with face verification."""
    __tablename__ = "attendance_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    face_match_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    face_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    photo_hash: Mapped[str] = mapped_column(String(64), nullable=True)  # hash of the live photo
    ip_address: Mapped[str] = mapped_column(String(45), nullable=True)
    marked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    session: Mapped["AttendanceSession"] = relationship(back_populates="records")


class AttendanceSettings(Base):
    """Global attendance window settings — only one row (singleton, id='default')."""
    __tablename__ = "attendance_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default="default")
    # Window open: default 00:01 IST
    open_hour: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    open_minute: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # Window close: default 12:01 IST
    close_hour: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    close_minute: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
