"""Copy Check models — answer-sheet evaluation & plagiarism detection."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class CopyCheckSession(Base):
    """One exam evaluation round (e.g. 'DSA Mid-Term, CSE, Nov 2025')."""
    __tablename__ = "copy_check_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    class_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    department: Mapped[str] = mapped_column(String(50), nullable=False, default="CSE")
    total_marks: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    # Syllabus context uploaded by faculty
    syllabus_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    syllabus_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # active | evaluating | done | archived
    sheet_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    evaluated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    plagiarism_run: Mapped[bool] = mapped_column(String(1), nullable=False, default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class CopyCheckSheet(Base):
    """One student's answer sheet within a session."""
    __tablename__ = "copy_check_sheets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("copy_check_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    student_roll: Mapped[str] = mapped_column(String(50), nullable=False)
    student_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    department: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    # AI evaluation results
    ai_marks: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # AI-extracted answers for plagiarism
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="uploaded")
    # uploaded | evaluating | done | error
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class CopyCheckPlagiarism(Base):
    """Pairwise plagiarism result between two students in a session."""
    __tablename__ = "copy_check_plagiarism"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("copy_check_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    roll_a: Mapped[str] = mapped_column(String(50), nullable=False)
    roll_b: Mapped[str] = mapped_column(String(50), nullable=False)
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)  # 0.0–1.0
    matched_sections: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list of matching text snippets
    verdict: Mapped[str] = mapped_column(String(20), nullable=False, default="unlikely")
    # confirmed (>90%) | suspected (70-90%) | unlikely (<70%)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
