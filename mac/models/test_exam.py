"""Test / Exam ORM models."""

import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Boolean, Integer, Float, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class TestExam(Base):
    """A test/exam created by faculty or admin."""
    __tablename__ = "test_exams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    subject: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # draft → scheduled → active → ended → graded
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    questions: Mapped[list["TestQuestion"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="TestQuestion.order_index"
    )
    submissions: Mapped[list["TestSubmission"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan"
    )


class TestQuestion(Base):
    """A question belonging to a test exam."""
    __tablename__ = "test_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    exam_id: Mapped[str] = mapped_column(String(36), ForeignKey("test_exams.id", ondelete="CASCADE"), nullable=False, index=True)
    # mcq | msq | written
    question_type: Mapped[str] = mapped_column(String(20), nullable=False, default="mcq")
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    marks: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model_answer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    exam: Mapped["TestExam"] = relationship(back_populates="questions")
    options: Mapped[list["TestOption"]] = relationship(
        back_populates="question", cascade="all, delete-orphan", order_by="TestOption.order_index"
    )
    answers: Mapped[list["StudentAnswer"]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )


class TestOption(Base):
    """An option for an MCQ or MSQ question."""
    __tablename__ = "test_options"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("test_questions.id", ondelete="CASCADE"), nullable=False, index=True)
    option_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    question: Mapped["TestQuestion"] = relationship(back_populates="options")


class TestSubmission(Base):
    """A student's submission for an exam."""
    __tablename__ = "test_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    exam_id: Mapped[str] = mapped_column(String(36), ForeignKey("test_exams.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # in_progress | submitted | graded
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")
    total_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    exam: Mapped["TestExam"] = relationship(back_populates="submissions")
    student_answers: Mapped[list["StudentAnswer"]] = relationship(
        back_populates="submission", cascade="all, delete-orphan"
    )


class StudentAnswer(Base):
    """A student's answer to one question in a submission."""
    __tablename__ = "student_answers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    submission_id: Mapped[str] = mapped_column(String(36), ForeignKey("test_submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("test_questions.id", ondelete="CASCADE"), nullable=False, index=True)
    # JSON array of selected option IDs for MCQ/MSQ
    selected_option_ids: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    written_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ai_feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manual_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    submission: Mapped["TestSubmission"] = relationship(back_populates="student_answers")
    question: Mapped["TestQuestion"] = relationship(back_populates="answers")
