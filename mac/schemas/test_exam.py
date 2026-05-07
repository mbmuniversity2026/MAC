"""Pydantic schemas for the Test/Exam feature."""

from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ── Option schemas ───────────────────────────────────────────────────────────

class OptionCreate(BaseModel):
    option_text: str = Field(min_length=1, max_length=2000)
    is_correct: bool = False
    order_index: int = 0


class OptionResponse(BaseModel):
    id: str
    option_text: str
    is_correct: bool
    order_index: int

    model_config = {"from_attributes": True}


class OptionResponseStudent(BaseModel):
    """Option response for students — no is_correct field."""
    id: str
    option_text: str
    order_index: int

    model_config = {"from_attributes": True}


# ── Question schemas ─────────────────────────────────────────────────────────

class QuestionCreate(BaseModel):
    question_type: str = Field(pattern="^(mcq|msq|written)$")
    question_text: str = Field(min_length=1, max_length=5000)
    marks: float = Field(default=1.0, ge=0)
    order_index: int = 0
    model_answer: Optional[str] = None
    explanation: Optional[str] = None
    options: List[OptionCreate] = []


class QuestionUpdate(BaseModel):
    question_type: Optional[str] = Field(default=None, pattern="^(mcq|msq|written)$")
    question_text: Optional[str] = Field(default=None, min_length=1, max_length=5000)
    marks: Optional[float] = Field(default=None, ge=0)
    order_index: Optional[int] = None
    model_answer: Optional[str] = None
    explanation: Optional[str] = None
    options: Optional[List[OptionCreate]] = None


class QuestionResponse(BaseModel):
    id: str
    exam_id: str
    question_type: str
    question_text: str
    marks: float
    order_index: int
    model_answer: Optional[str]
    explanation: Optional[str]
    options: List[OptionResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class QuestionResponseStudent(BaseModel):
    """Question response for students — no model_answer, no is_correct on options."""
    id: str
    exam_id: str
    question_type: str
    question_text: str
    marks: float
    order_index: int
    options: List[OptionResponseStudent] = []

    model_config = {"from_attributes": True}


# ── Exam schemas ─────────────────────────────────────────────────────────────

class CreateExamRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    subject: str = Field(min_length=1, max_length=150)
    description: Optional[str] = None
    instructions: Optional[str] = None
    duration_minutes: int = Field(default=60, ge=5, le=480)
    scheduled_at: Optional[datetime] = None


class UpdateExamRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    subject: Optional[str] = Field(default=None, min_length=1, max_length=150)
    description: Optional[str] = None
    instructions: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=5, le=480)
    scheduled_at: Optional[datetime] = None


class ExamResponse(BaseModel):
    id: str
    title: str
    subject: str
    description: Optional[str]
    instructions: Optional[str]
    duration_minutes: int
    scheduled_at: Optional[datetime]
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    question_count: int = 0
    total_marks: float = 0.0

    model_config = {"from_attributes": True}


class ExamDetailResponse(BaseModel):
    id: str
    title: str
    subject: str
    description: Optional[str]
    instructions: Optional[str]
    duration_minutes: int
    scheduled_at: Optional[datetime]
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    questions: List[QuestionResponse] = []

    model_config = {"from_attributes": True}


class ExamDetailStudentResponse(BaseModel):
    """Exam detail for students — questions have no correct answers."""
    id: str
    title: str
    subject: str
    description: Optional[str]
    instructions: Optional[str]
    duration_minutes: int
    scheduled_at: Optional[datetime]
    status: str
    questions: List[QuestionResponseStudent] = []

    model_config = {"from_attributes": True}


# ── AI generation schemas ────────────────────────────────────────────────────

class GenerateQuestionsRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=150)
    topic: str = Field(min_length=1, max_length=300)
    num_questions: int = Field(default=10, ge=1, le=50)
    difficulty: str = Field(default="medium", pattern="^(easy|medium|hard)$")
    marks_per_question: float = Field(default=1.0, ge=0.5)
    question_types: Optional[List[str]] = None  # ["mcq", "msq", "written"] or None for mixed


# ── Publish / control schemas ────────────────────────────────────────────────

class PublishExamRequest(BaseModel):
    mode: str = Field(pattern="^(scheduled|active)$")  # "scheduled" or "active"


# ── Submission schemas ───────────────────────────────────────────────────────

class AnswerSubmit(BaseModel):
    question_id: str
    selected_option_ids: Optional[List[str]] = None
    written_text: Optional[str] = None


class SubmitExamRequest(BaseModel):
    answers: List[AnswerSubmit]


class StartSubmissionResponse(BaseModel):
    submission_id: str
    started_at: datetime
    exam: ExamDetailStudentResponse


# ── Result schemas ───────────────────────────────────────────────────────────

class AnswerResultItem(BaseModel):
    question_id: str
    question_text: str
    question_type: str
    marks: float
    explanation: Optional[str]
    model_answer: Optional[str]
    # Student's answer
    selected_option_ids: Optional[List[str]]
    written_text: Optional[str]
    # Grading
    is_correct: Optional[bool]
    ai_score: Optional[float]
    ai_feedback: Optional[str]
    manual_score: Optional[float]
    earned_marks: Optional[float]
    # Correct options for review
    correct_option_ids: Optional[List[str]] = None
    all_options: Optional[List[OptionResponse]] = None


class ExamResultResponse(BaseModel):
    submission_id: str
    exam_id: str
    exam_title: str
    exam_subject: str
    status: str
    started_at: datetime
    submitted_at: Optional[datetime]
    total_score: Optional[float]
    max_score: float
    percentage: Optional[float]
    answers: List[AnswerResultItem] = []


# ── Submission list / detail schemas ────────────────────────────────────────

class SubmissionListItem(BaseModel):
    id: str
    student_id: str
    student_name: Optional[str] = None
    student_roll: Optional[str] = None
    started_at: datetime
    submitted_at: Optional[datetime]
    status: str
    total_score: Optional[float]


class SubmissionDetailResponse(BaseModel):
    id: str
    exam_id: str
    student_id: str
    student_name: Optional[str] = None
    student_roll: Optional[str] = None
    started_at: datetime
    submitted_at: Optional[datetime]
    status: str
    total_score: Optional[float]
    answers: List[AnswerResultItem] = []


# ── Grade override ────────────────────────────────────────────────────────────

class AnswerGradeOverride(BaseModel):
    question_id: str
    manual_score: float = Field(ge=0)


class GradeOverrideRequest(BaseModel):
    overrides: List[AnswerGradeOverride]
    mark_graded: bool = True
