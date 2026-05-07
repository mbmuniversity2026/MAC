"""Tests / Exams router.

Prefix: /tests
Tags: ["tests"]

Faculty/Admin: full CRUD + AI question generation + submission review + grade override.
Students: list available exams, start, submit, view results.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user, require_faculty_or_admin
from mac.middleware.feature_gate import feature_required
from mac.models.user import User
from mac.models.test_exam import TestExam, TestQuestion, TestOption, TestSubmission, StudentAnswer
from mac.schemas.test_exam import (
    CreateExamRequest, UpdateExamRequest, ExamResponse, ExamDetailResponse,
    ExamDetailStudentResponse, QuestionCreate, QuestionUpdate, QuestionResponse,
    QuestionResponseStudent, OptionResponse, OptionResponseStudent,
    GenerateQuestionsRequest, PublishExamRequest,
    SubmitExamRequest, StartSubmissionResponse,
    ExamResultResponse, AnswerResultItem, SubmissionListItem, SubmissionDetailResponse,
    GradeOverrideRequest,
)

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tests",
    tags=["tests"],
    dependencies=[Depends(feature_required("tests"))],
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _require_faculty_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("faculty", "admin"):
        raise HTTPException(status_code=403, detail="Faculty or admin access required")
    return user


async def _get_exam_or_404(db: AsyncSession, exam_id: str) -> TestExam:
    result = await db.execute(
        select(TestExam)
        .options(selectinload(TestExam.questions).selectinload(TestQuestion.options))
        .where(TestExam.id == exam_id)
    )
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    return exam


def _exam_to_response(exam: TestExam) -> ExamResponse:
    total_marks = sum(q.marks for q in exam.questions) if exam.questions else 0.0
    return ExamResponse(
        id=exam.id,
        title=exam.title,
        subject=exam.subject,
        description=exam.description,
        instructions=exam.instructions,
        duration_minutes=exam.duration_minutes,
        scheduled_at=exam.scheduled_at,
        status=exam.status,
        created_by=exam.created_by,
        created_at=exam.created_at,
        updated_at=exam.updated_at,
        question_count=len(exam.questions) if exam.questions else 0,
        total_marks=total_marks,
    )


def _question_to_response(q: TestQuestion) -> QuestionResponse:
    return QuestionResponse(
        id=q.id,
        exam_id=q.exam_id,
        question_type=q.question_type,
        question_text=q.question_text,
        marks=q.marks,
        order_index=q.order_index,
        model_answer=q.model_answer,
        explanation=q.explanation,
        options=[OptionResponse(id=o.id, option_text=o.option_text, is_correct=o.is_correct, order_index=o.order_index) for o in (q.options or [])],
        created_at=q.created_at,
    )


def _question_to_student_response(q: TestQuestion) -> QuestionResponseStudent:
    return QuestionResponseStudent(
        id=q.id,
        exam_id=q.exam_id,
        question_type=q.question_type,
        question_text=q.question_text,
        marks=q.marks,
        order_index=q.order_index,
        options=[OptionResponseStudent(id=o.id, option_text=o.option_text, order_index=o.order_index) for o in (q.options or [])],
    )


def _parse_json_from_llm(text: str) -> list:
    """Extract JSON array from LLM response, handling markdown code blocks."""
    # Strip markdown code fences
    cleaned = re.sub(r"```(?:json)?\s*", "", text)
    cleaned = cleaned.replace("```", "").strip()
    # Find first [ ... ] block
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1:
        raise ValueError("No JSON array found in LLM response")
    return json.loads(cleaned[start:end + 1])


async def _auto_grade_written(question: TestQuestion, written_text: str) -> tuple[float, str]:
    """Use local vLLM to grade a written answer. Returns (score, feedback)."""
    from mac.services.llm_service import chat_completion
    prompt = (
        f"You are a teacher grading a student's written answer.\n"
        f"Question: {question.question_text}\n"
        f"Model Answer: {question.model_answer or '(No model answer provided)'}\n"
        f"Student's Answer: {written_text}\n\n"
        f"Grade this answer out of {question.marks} marks. "
        f"Return ONLY valid JSON with exactly two fields: "
        f'{{\"score\": <float 0 to {question.marks}>, \"feedback\": \"<brief feedback>\"}}'
    )
    try:
        result = await chat_completion(
            model="auto",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=256,
        )
        content = result["choices"][0]["message"]["content"]
        # Parse JSON from response
        cleaned = re.sub(r"```(?:json)?\s*", "", content).replace("```", "").strip()
        j_start = cleaned.find("{")
        j_end = cleaned.rfind("}")
        if j_start != -1 and j_end != -1:
            data = json.loads(cleaned[j_start:j_end + 1])
            score = float(data.get("score", 0))
            score = max(0.0, min(score, question.marks))
            feedback = str(data.get("feedback", ""))
            return score, feedback
    except Exception as e:
        log.warning("Auto-grade written failed: %s", e)
    return 0.0, "Could not auto-grade. Pending manual review."


# ═════════════════════════════════════════════════════════════════════════════
#  FACULTY / ADMIN ENDPOINTS
# ═════════════════════════════════════════════════════════════════════════════

@router.post("", response_model=ExamResponse)
async def create_exam(
    req: CreateExamRequest,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new exam (faculty/admin)."""
    exam = TestExam(
        title=req.title,
        subject=req.subject,
        description=req.description,
        instructions=req.instructions,
        duration_minutes=req.duration_minutes,
        scheduled_at=req.scheduled_at,
        status="draft",
        created_by=user.id,
    )
    db.add(exam)
    await db.flush()
    # Re-query with eager load so _exam_to_response can access exam.questions
    result = await db.execute(
        select(TestExam)
        .options(selectinload(TestExam.questions))
        .where(TestExam.id == exam.id)
    )
    exam = result.scalar_one()
    return _exam_to_response(exam)


@router.get("", response_model=List[ExamResponse])
async def list_exams(
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List exams. Faculty sees own; admin sees all; students → use /tests/available."""
    if user.role == "student":
        raise HTTPException(status_code=403, detail="Students: use /tests/available")

    q = select(TestExam).options(selectinload(TestExam.questions))
    if user.role == "faculty":
        q = q.where(TestExam.created_by == user.id)
    if status:
        q = q.where(TestExam.status == status)
    q = q.order_by(TestExam.created_at.desc())

    result = await db.execute(q)
    exams = result.scalars().all()
    return [_exam_to_response(e) for e in exams]


@router.get("/available", response_model=List[ExamResponse])
async def list_available_exams(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List scheduled/active exams visible to a student (or anyone)."""
    q = (
        select(TestExam)
        .options(selectinload(TestExam.questions))
        .where(TestExam.status.in_(["scheduled", "active"]))
        .order_by(TestExam.scheduled_at.asc().nullslast(), TestExam.created_at.desc())
    )
    result = await db.execute(q)
    exams = result.scalars().all()
    return [_exam_to_response(e) for e in exams]


@router.get("/{exam_id}", response_model=ExamDetailResponse)
async def get_exam(
    exam_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full exam with questions and options. Faculty/Admin only for draft exams."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "student" and exam.status not in ("scheduled", "active", "ended", "graded"):
        raise HTTPException(status_code=403, detail="Access denied")
    if user.role == "faculty" and exam.created_by != user.id and exam.status not in ("scheduled", "active"):
        raise HTTPException(status_code=403, detail="Access denied")
    return ExamDetailResponse(
        id=exam.id,
        title=exam.title,
        subject=exam.subject,
        description=exam.description,
        instructions=exam.instructions,
        duration_minutes=exam.duration_minutes,
        scheduled_at=exam.scheduled_at,
        status=exam.status,
        created_by=exam.created_by,
        created_at=exam.created_at,
        updated_at=exam.updated_at,
        questions=[_question_to_response(q) for q in exam.questions],
    )


@router.put("/{exam_id}", response_model=ExamResponse)
async def update_exam(
    exam_id: str,
    req: UpdateExamRequest,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update exam metadata."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if exam.status in ("active", "ended", "graded"):
        raise HTTPException(status_code=400, detail="Cannot edit an active/ended exam")

    if req.title is not None:
        exam.title = req.title
    if req.subject is not None:
        exam.subject = req.subject
    if req.description is not None:
        exam.description = req.description
    if req.instructions is not None:
        exam.instructions = req.instructions
    if req.duration_minutes is not None:
        exam.duration_minutes = req.duration_minutes
    if req.scheduled_at is not None:
        exam.scheduled_at = req.scheduled_at

    await db.flush()
    return _exam_to_response(exam)


@router.post("/{exam_id}/questions", response_model=QuestionResponse)
async def add_question(
    exam_id: str,
    req: QuestionCreate,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Add a question with options to an exam."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if exam.status in ("active", "ended", "graded"):
        raise HTTPException(status_code=400, detail="Cannot add questions to active/ended exam")

    # Determine next order index
    order_index = req.order_index
    if not exam.questions:
        order_index = 0
    else:
        max_idx = max(q.order_index for q in exam.questions)
        order_index = max_idx + 1

    question = TestQuestion(
        exam_id=exam_id,
        question_type=req.question_type,
        question_text=req.question_text,
        marks=req.marks,
        order_index=order_index,
        model_answer=req.model_answer,
        explanation=req.explanation,
    )
    db.add(question)
    await db.flush()

    for i, opt in enumerate(req.options):
        option = TestOption(
            question_id=question.id,
            option_text=opt.option_text,
            is_correct=opt.is_correct,
            order_index=i,
        )
        db.add(option)

    await db.flush()

    # Re-query with eager load to avoid lazy-load in sync context
    q_result = await db.execute(
        select(TestQuestion)
        .options(selectinload(TestQuestion.options))
        .where(TestQuestion.id == question.id)
    )
    question = q_result.scalar_one()
    return _question_to_response(question)


@router.put("/{exam_id}/questions/{question_id}", response_model=QuestionResponse)
async def update_question(
    exam_id: str,
    question_id: str,
    req: QuestionUpdate,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a question (and optionally replace its options)."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if exam.status in ("active", "ended", "graded"):
        raise HTTPException(status_code=400, detail="Cannot edit active/ended exam")

    q_result = await db.execute(
        select(TestQuestion)
        .options(selectinload(TestQuestion.options))
        .where(TestQuestion.id == question_id, TestQuestion.exam_id == exam_id)
    )
    question = q_result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    if req.question_type is not None:
        question.question_type = req.question_type
    if req.question_text is not None:
        question.question_text = req.question_text
    if req.marks is not None:
        question.marks = req.marks
    if req.order_index is not None:
        question.order_index = req.order_index
    if req.model_answer is not None:
        question.model_answer = req.model_answer
    if req.explanation is not None:
        question.explanation = req.explanation

    if req.options is not None:
        # Delete old options and replace
        for opt in question.options:
            await db.delete(opt)
        await db.flush()
        new_opts = []
        for i, opt_data in enumerate(req.options):
            new_opt = TestOption(
                question_id=question.id,
                option_text=opt_data.option_text,
                is_correct=opt_data.is_correct,
                order_index=i,
            )
            db.add(new_opt)
            new_opts.append(new_opt)
        await db.flush()
        question.options = new_opts

    return _question_to_response(question)


@router.delete("/{exam_id}/questions/{question_id}")
async def delete_question(
    exam_id: str,
    question_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a question from an exam."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if exam.status in ("active", "ended", "graded"):
        raise HTTPException(status_code=400, detail="Cannot delete from active/ended exam")

    q_result = await db.execute(
        select(TestQuestion).where(TestQuestion.id == question_id, TestQuestion.exam_id == exam_id)
    )
    question = q_result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    await db.delete(question)
    return {"status": "deleted"}


@router.post("/{exam_id}/generate", response_model=List[QuestionResponse])
async def generate_questions(
    exam_id: str,
    req: GenerateQuestionsRequest,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Use local LLM to generate questions for review. Inserts them immediately as draft questions."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if exam.status in ("active", "ended", "graded"):
        raise HTTPException(status_code=400, detail="Cannot modify active/ended exam")

    types_requested = req.question_types or ["mcq", "msq", "written"]
    types_str = ", ".join(types_requested)

    prompt = f"""Generate exactly {req.num_questions} exam questions about "{req.topic}" in the subject "{req.subject}".
Difficulty level: {req.difficulty}.
Use these question types (distribute evenly): {types_str}.

Return ONLY a valid JSON array. Each element must be exactly this structure:
{{
  "question_text": "...",
  "question_type": "mcq" | "msq" | "written",
  "marks": {req.marks_per_question},
  "options": [
    {{"text": "Option A", "is_correct": true}},
    {{"text": "Option B", "is_correct": false}},
    {{"text": "Option C", "is_correct": false}},
    {{"text": "Option D", "is_correct": false}}
  ],
  "model_answer": "Full answer for written questions (empty string for mcq/msq)",
  "explanation": "Brief explanation of the correct answer"
}}

Rules:
- MCQ must have exactly 4 options, exactly 1 correct.
- MSQ must have 3-5 options, 2 or more correct.
- Written must have empty options array.
- Return ONLY the JSON array, no other text."""

    from mac.services.llm_service import chat_completion
    try:
        result = await chat_completion(
            model="auto",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=4096,
        )
        content = result["choices"][0]["message"]["content"]
        questions_data = _parse_json_from_llm(content)
    except Exception as e:
        log.error("AI question generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"AI generation failed: {e}")

    # Determine starting order index
    existing_max = max((q.order_index for q in exam.questions), default=-1)
    created_questions: list[QuestionResponse] = []

    for i, qd in enumerate(questions_data[:req.num_questions]):
        try:
            q_type = str(qd.get("question_type", "mcq")).lower()
            if q_type not in ("mcq", "msq", "written"):
                q_type = "mcq"

            question = TestQuestion(
                exam_id=exam_id,
                question_type=q_type,
                question_text=str(qd.get("question_text", "")).strip(),
                marks=float(qd.get("marks", req.marks_per_question)),
                order_index=existing_max + 1 + i,
                model_answer=str(qd.get("model_answer", "")).strip() or None,
                explanation=str(qd.get("explanation", "")).strip() or None,
            )
            db.add(question)
            await db.flush()

            opts_data = qd.get("options", [])
            question_opts = []
            for j, opt in enumerate(opts_data):
                new_opt = TestOption(
                    question_id=question.id,
                    option_text=str(opt.get("text", "")).strip(),
                    is_correct=bool(opt.get("is_correct", False)),
                    order_index=j,
                )
                db.add(new_opt)
                question_opts.append(new_opt)

            await db.flush()
            question.options = question_opts
            created_questions.append(_question_to_response(question))
        except Exception as qe:
            log.warning("Skipping malformed generated question: %s", qe)
            continue

    return created_questions


@router.post("/{exam_id}/publish")
async def publish_exam(
    exam_id: str,
    req: PublishExamRequest,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Set exam status to scheduled or active."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if exam.status not in ("draft", "scheduled"):
        raise HTTPException(status_code=400, detail=f"Cannot publish exam in status: {exam.status}")
    if not exam.questions:
        raise HTTPException(status_code=400, detail="Exam has no questions")

    if req.mode == "scheduled":
        if not exam.scheduled_at:
            raise HTTPException(status_code=400, detail="scheduled_at is required for scheduled mode")
        if exam.scheduled_at <= _utcnow():
            raise HTTPException(status_code=400, detail="scheduled_at must be in the future")
        exam.status = "scheduled"
    else:
        exam.status = "active"

    return {"status": exam.status, "exam_id": exam.id}


@router.post("/{exam_id}/end")
async def end_exam(
    exam_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """End an active exam."""
    exam = await _get_exam_or_404(db, exam_id)
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if exam.status != "active":
        raise HTTPException(status_code=400, detail="Exam is not active")
    exam.status = "ended"
    return {"status": "ended", "exam_id": exam.id}


@router.get("/{exam_id}/submissions", response_model=List[SubmissionListItem])
async def list_submissions(
    exam_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all submissions for an exam."""
    exam_result = await db.execute(select(TestExam).where(TestExam.id == exam_id))
    exam = exam_result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(TestSubmission).where(TestSubmission.exam_id == exam_id).order_by(TestSubmission.submitted_at.desc())
    )
    submissions = result.scalars().all()

    # Load student info
    from mac.models.user import User as UserModel
    student_ids = list({s.student_id for s in submissions})
    users_result = await db.execute(select(UserModel).where(UserModel.id.in_(student_ids)))
    users_map = {u.id: u for u in users_result.scalars().all()}

    items = []
    for sub in submissions:
        stu = users_map.get(sub.student_id)
        items.append(SubmissionListItem(
            id=sub.id,
            student_id=sub.student_id,
            student_name=stu.name if stu else None,
            student_roll=stu.roll_number if stu else None,
            started_at=sub.started_at,
            submitted_at=sub.submitted_at,
            status=sub.status,
            total_score=sub.total_score,
        ))
    return items


@router.get("/{exam_id}/submissions/{submission_id}", response_model=SubmissionDetailResponse)
async def get_submission_detail(
    exam_id: str,
    submission_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get detailed submission for faculty/admin review."""
    exam_result = await db.execute(select(TestExam).where(TestExam.id == exam_id))
    exam = exam_result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    sub_result = await db.execute(
        select(TestSubmission)
        .options(selectinload(TestSubmission.student_answers).selectinload(StudentAnswer.question).selectinload(TestQuestion.options))
        .where(TestSubmission.id == submission_id, TestSubmission.exam_id == exam_id)
    )
    sub = sub_result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    from mac.models.user import User as UserModel
    stu_result = await db.execute(select(UserModel).where(UserModel.id == sub.student_id))
    stu = stu_result.scalar_one_or_none()

    answers = _build_answer_result_items(sub.student_answers, include_correct=True)
    return SubmissionDetailResponse(
        id=sub.id,
        exam_id=sub.exam_id,
        student_id=sub.student_id,
        student_name=stu.name if stu else None,
        student_roll=stu.roll_number if stu else None,
        started_at=sub.started_at,
        submitted_at=sub.submitted_at,
        status=sub.status,
        total_score=sub.total_score,
        answers=answers,
    )


@router.put("/{exam_id}/submissions/{submission_id}/grade")
async def grade_submission(
    exam_id: str,
    submission_id: str,
    req: GradeOverrideRequest,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Faculty manually overrides scores for individual answers."""
    exam_result = await db.execute(select(TestExam).where(TestExam.id == exam_id))
    exam = exam_result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if user.role == "faculty" and exam.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    sub_result = await db.execute(
        select(TestSubmission)
        .options(selectinload(TestSubmission.student_answers))
        .where(TestSubmission.id == submission_id, TestSubmission.exam_id == exam_id)
    )
    sub = sub_result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Build answer map
    answer_map = {a.question_id: a for a in sub.student_answers}

    # Load max marks per question
    q_ids = list(answer_map.keys())
    q_result = await db.execute(select(TestQuestion).where(TestQuestion.id.in_(q_ids)))
    q_map = {q.id: q for q in q_result.scalars().all()}

    for override in req.overrides:
        ans = answer_map.get(override.question_id)
        if not ans:
            continue
        q = q_map.get(override.question_id)
        max_marks = q.marks if q else override.manual_score
        ans.manual_score = max(0.0, min(override.manual_score, max_marks))

    # Recompute total score
    total = 0.0
    for ans in sub.student_answers:
        q = q_map.get(ans.question_id)
        if q and q.question_type in ("mcq", "msq"):
            total += (q.marks if ans.is_correct else 0.0)
        else:
            score = ans.manual_score if ans.manual_score is not None else (ans.ai_score or 0.0)
            total += score

    sub.total_score = total
    if req.mark_graded:
        sub.status = "graded"

    return {"status": sub.status, "total_score": sub.total_score}


# ═════════════════════════════════════════════════════════════════════════════
#  STUDENT ENDPOINTS
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/{exam_id}/start", response_model=StartSubmissionResponse)
async def start_exam(
    exam_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start an exam. Creates a submission if none exists; returns existing in_progress one."""
    exam = await _get_exam_or_404(db, exam_id)
    if exam.status not in ("scheduled", "active"):
        raise HTTPException(status_code=400, detail="Exam is not available")

    # If scheduled, check time
    if exam.status == "scheduled" and exam.scheduled_at:
        if exam.scheduled_at > _utcnow():
            raise HTTPException(status_code=400, detail="Exam has not started yet")

    # Check for existing in_progress submission
    existing_result = await db.execute(
        select(TestSubmission).where(
            TestSubmission.exam_id == exam_id,
            TestSubmission.student_id == user.id,
            TestSubmission.status == "in_progress",
        )
    )
    existing = existing_result.scalar_one_or_none()

    if not existing:
        # Check if already submitted
        submitted_result = await db.execute(
            select(TestSubmission).where(
                TestSubmission.exam_id == exam_id,
                TestSubmission.student_id == user.id,
                TestSubmission.status.in_(["submitted", "graded"]),
            )
        )
        already_submitted = submitted_result.scalar_one_or_none()
        if already_submitted:
            raise HTTPException(status_code=400, detail="You have already submitted this exam")

        existing = TestSubmission(
            exam_id=exam_id,
            student_id=user.id,
            status="in_progress",
        )
        db.add(existing)
        await db.flush()

    exam_detail = ExamDetailStudentResponse(
        id=exam.id,
        title=exam.title,
        subject=exam.subject,
        description=exam.description,
        instructions=exam.instructions,
        duration_minutes=exam.duration_minutes,
        scheduled_at=exam.scheduled_at,
        status=exam.status,
        questions=[_question_to_student_response(q) for q in exam.questions],
    )

    return StartSubmissionResponse(
        submission_id=existing.id,
        started_at=existing.started_at,
        exam=exam_detail,
    )


@router.post("/{exam_id}/submit", response_model=ExamResultResponse)
async def submit_exam(
    exam_id: str,
    req: SubmitExamRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit exam answers. MCQ/MSQ graded instantly; written graded async by AI."""
    exam = await _get_exam_or_404(db, exam_id)

    # Find in-progress submission
    sub_result = await db.execute(
        select(TestSubmission)
        .options(selectinload(TestSubmission.student_answers))
        .where(
            TestSubmission.exam_id == exam_id,
            TestSubmission.student_id == user.id,
            TestSubmission.status == "in_progress",
        )
    )
    sub = sub_result.scalar_one_or_none()
    if not sub:
        # Check if already submitted
        done_result = await db.execute(
            select(TestSubmission).where(
                TestSubmission.exam_id == exam_id,
                TestSubmission.student_id == user.id,
                TestSubmission.status.in_(["submitted", "graded"]),
            )
        )
        done = done_result.scalar_one_or_none()
        if done:
            raise HTTPException(status_code=400, detail="Exam already submitted")
        raise HTTPException(status_code=404, detail="No active submission found. Please start the exam first.")

    # Build question map
    questions_map = {q.id: q for q in exam.questions}

    total_score = 0.0
    written_tasks = []  # (StudentAnswer, TestQuestion) to grade async

    for answer_data in req.answers:
        q = questions_map.get(answer_data.question_id)
        if not q:
            continue

        student_ans = StudentAnswer(
            submission_id=sub.id,
            question_id=q.id,
            selected_option_ids=answer_data.selected_option_ids,
            written_text=answer_data.written_text,
        )

        if q.question_type in ("mcq", "msq"):
            # Instant grading
            selected = set(answer_data.selected_option_ids or [])
            correct = {o.id for o in q.options if o.is_correct}
            is_correct = selected == correct and len(correct) > 0
            student_ans.is_correct = is_correct
            if is_correct:
                total_score += q.marks
        elif q.question_type == "written":
            student_ans.ai_score = None  # pending AI grading
            written_tasks.append((student_ans, q))

        db.add(student_ans)

    sub.submitted_at = _utcnow()
    sub.status = "submitted"
    sub.total_score = total_score
    await db.flush()

    ans_result = await db.execute(
        select(StudentAnswer)
        .options(selectinload(StudentAnswer.question).selectinload(TestQuestion.options))
        .where(StudentAnswer.submission_id == sub.id)
    )
    all_answers = ans_result.scalars().all()

    # Start async AI grading for written answers (fire-and-forget)
    if written_tasks:
        async def _grade_written_bg():
            from mac.database import async_session
            try:
                async with async_session() as bg_db:
                    for ans, q in written_tasks:
                        score, feedback = await _auto_grade_written(q, ans.written_text or "")
                        # Re-fetch the answer
                        ans_fetch = await bg_db.execute(
                            select(StudentAnswer).where(StudentAnswer.id == ans.id)
                        )
                        db_ans = ans_fetch.scalar_one_or_none()
                        if db_ans:
                            db_ans.ai_score = score
                            db_ans.ai_feedback = feedback
                    # Recompute total
                    sub_fetch = await bg_db.execute(
                        select(TestSubmission)
                        .options(selectinload(TestSubmission.student_answers))
                        .where(TestSubmission.id == sub.id)
                    )
                    db_sub = sub_fetch.scalar_one_or_none()
                    if db_sub:
                        db_sub.total_score = sum(
                            (a.manual_score or a.ai_score or 0.0) if a.is_correct is None else (a.question.marks if a.is_correct else 0.0)
                            for a in db_sub.student_answers
                        )
                    await bg_db.commit()
            except Exception as e:
                log.warning("Background written grading failed: %s", e)

        asyncio.create_task(_grade_written_bg())

    max_score = sum(q.marks for q in exam.questions)
    answer_items = _build_answer_result_items(all_answers, include_correct=False)

    return ExamResultResponse(
        submission_id=sub.id,
        exam_id=exam.id,
        exam_title=exam.title,
        exam_subject=exam.subject,
        status=sub.status,
        started_at=sub.started_at,
        submitted_at=sub.submitted_at,
        total_score=sub.total_score,
        max_score=max_score,
        percentage=round((sub.total_score / max_score * 100), 2) if max_score > 0 and sub.total_score is not None else None,
        answers=answer_items,
    )


@router.get("/{exam_id}/result", response_model=ExamResultResponse)
async def get_result(
    exam_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get student's own submission result (only after submitted/graded)."""
    exam = await _get_exam_or_404(db, exam_id)

    sub_result = await db.execute(
        select(TestSubmission)
        .options(selectinload(TestSubmission.student_answers).selectinload(StudentAnswer.question).selectinload(TestQuestion.options))
        .where(
            TestSubmission.exam_id == exam_id,
            TestSubmission.student_id == user.id,
            TestSubmission.status.in_(["submitted", "graded"]),
        )
    )
    sub = sub_result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="No submitted result found for this exam")

    max_score = sum(q.marks for q in exam.questions)
    answer_items = _build_answer_result_items(sub.student_answers, include_correct=True)

    return ExamResultResponse(
        submission_id=sub.id,
        exam_id=exam.id,
        exam_title=exam.title,
        exam_subject=exam.subject,
        status=sub.status,
        started_at=sub.started_at,
        submitted_at=sub.submitted_at,
        total_score=sub.total_score,
        max_score=max_score,
        percentage=round((sub.total_score / max_score * 100), 2) if max_score > 0 and sub.total_score is not None else None,
        answers=answer_items,
    )


# ── Internal helper ──────────────────────────────────────────────────────────

def _build_answer_result_items(answers, include_correct: bool) -> list[AnswerResultItem]:
    items = []
    for ans in answers:
        q = ans.question
        if not q:
            continue

        correct_option_ids = None
        all_options = None
        if include_correct and q.options:
            correct_option_ids = [o.id for o in q.options if o.is_correct]
            all_options = [OptionResponse(id=o.id, option_text=o.option_text, is_correct=o.is_correct, order_index=o.order_index) for o in q.options]

        earned = None
        if q.question_type in ("mcq", "msq") and ans.is_correct is not None:
            earned = q.marks if ans.is_correct else 0.0
        elif q.question_type == "written":
            if ans.manual_score is not None:
                earned = ans.manual_score
            elif ans.ai_score is not None:
                earned = ans.ai_score

        items.append(AnswerResultItem(
            question_id=q.id,
            question_text=q.question_text,
            question_type=q.question_type,
            marks=q.marks,
            explanation=q.explanation if include_correct else None,
            model_answer=q.model_answer if include_correct else None,
            selected_option_ids=ans.selected_option_ids,
            written_text=ans.written_text,
            is_correct=ans.is_correct,
            ai_score=ans.ai_score,
            ai_feedback=ans.ai_feedback,
            manual_score=ans.manual_score,
            earned_marks=earned,
            correct_option_ids=correct_option_ids,
            all_options=all_options,
        ))
    return items
