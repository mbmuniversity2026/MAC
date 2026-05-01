"""Copy Check router — AI vision answer-sheet evaluation, plagiarism detection, PDF reports.
Faculty/Admin only. Students cannot access any endpoint here.
"""

import asyncio
import pathlib
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, BackgroundTasks
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.middleware.feature_gate import feature_required
from mac.models.user import User
from mac.services import copy_check_service as svc
from mac.services import notification_service
from mac.config import settings

router = APIRouter(prefix="/copy-check", tags=["Copy Check"],
                   dependencies=[Depends(feature_required("copy_check"))])


def _require_faculty_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("faculty", "admin"):
        raise HTTPException(status_code=403, detail="Students cannot access Copy Check.")
    return user


# ── Sessions ─────────────────────────────────────────────

@router.post("/sessions")
async def create_session(
    subject: str = Form(...),
    class_name: str = Form(""),
    department: str = Form("CSE"),
    total_marks: int = Form(100),
    syllabus_text: Optional[str] = Form(None),
    syllabus_file: Optional[UploadFile] = File(None),
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new copy-check session (faculty/admin)."""
    syllabus_path = None
    if syllabus_file and syllabus_file.filename:
        content = await syllabus_file.read()
        syllabus_path = await svc.save_syllabus_file("tmp", content, syllabus_file.filename)

    sess = await svc.create_session(db, user.id, {
        "subject": subject,
        "class_name": class_name,
        "department": department,
        "total_marks": total_marks,
        "syllabus_text": syllabus_text,
    })
    if syllabus_path:
        # Move file to proper session dir now that we have the ID
        import shutil
        new_path = await svc.save_syllabus_file(sess.id, open(syllabus_path, "rb").read(),
                                                 pathlib.Path(syllabus_file.filename).name)
        sess.syllabus_file_path = new_path
        await db.commit()

    await notification_service.log_audit(
        db, actor_id=user.id, actor_role=user.role,
        action="copy_check.session.create", resource_type="copy_check",
        resource_id=sess.id,
        details=f"Subject={subject}, Dept={department}, Marks={total_marks}",
    )
    return _session_dict(sess)


@router.get("/sessions")
async def list_sessions(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    sessions, total = await svc.get_sessions(db, user.id, user.role, page, per_page)
    return {"sessions": [_session_dict(s) for s in sessions], "total": total, "page": page}


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_or_404(db, session_id)
    _check_ownership(sess, user)
    sheets = await svc.get_sheets(db, session_id)
    plagiarism = await svc.get_plagiarism_results(db, session_id)
    return {
        **_session_dict(sess),
        "sheets": [_sheet_dict(s) for s in sheets],
        "plagiarism": [_plg_dict(p) for p in plagiarism],
    }


@router.get("/sessions/{session_id}/students")
async def list_registered_students(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all registered students for this session's department (to know who hasn't submitted)."""
    sess = await _get_or_404(db, session_id)
    _check_ownership(sess, user)
    students = await svc.get_registered_students(db, sess.department if sess.department != "ALL" else None)
    sheets = await svc.get_sheets(db, session_id)
    uploaded_rolls = {s.student_roll for s in sheets}
    return {
        "students": [
            {
                "roll_number": s.roll_number,
                "name": s.name,
                "department": s.department,
                "has_sheet": s.roll_number in uploaded_rolls,
            }
            for s in students
        ],
        "total": len(students),
    }


# ── Upload Answer Sheet ───────────────────────────────────

@router.post("/sessions/{session_id}/sheets")
async def upload_sheet(
    session_id: str,
    student_roll: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Upload one student's answer sheet (image or PDF)."""
    sess = await _get_or_404(db, session_id)
    _check_ownership(sess, user)

    # Validate file type
    allowed = {".jpg", ".jpeg", ".png", ".pdf", ".webp"}
    ext = pathlib.Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed. Use JPG, PNG, PDF, or WEBP.")

    # Look up student name
    students = await svc.get_registered_students(db)
    student_map = {s.roll_number: s for s in students}
    student = student_map.get(student_roll)
    student_name = student.name if student else student_roll
    department = student.department if student else sess.department

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Max 20 MB per sheet.")

    file_path = await svc.save_sheet_file(session_id, student_roll, content, file.filename or f"{student_roll}{ext}")
    sheet = await svc.upsert_sheet(db, session_id, student_roll, student_name, department, file_path, file.filename or "")
    return _sheet_dict(sheet)


# ── Evaluate ──────────────────────────────────────────────

@router.post("/sessions/{session_id}/evaluate")
async def evaluate_all(
    session_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Trigger AI vision evaluation for all uploaded-but-not-yet-evaluated sheets."""
    sess = await _get_or_404(db, session_id)
    _check_ownership(sess, user)
    sheets = await svc.get_sheets(db, session_id)
    pending = [s for s in sheets if s.status in ("uploaded", "error")]
    if not pending:
        raise HTTPException(status_code=400, detail="No pending sheets to evaluate.")

    # Mark them all as evaluating immediately
    for s in pending:
        s.status = "evaluating"
    sess.status = "evaluating"
    await db.commit()

    background_tasks.add_task(
        _run_evaluation_background, session_id, [s.id for s in pending], user.id
    )
    return {"message": f"Evaluation started for {len(pending)} sheets.", "pending_count": len(pending)}


async def _run_evaluation_background(session_id: str, sheet_ids: list[str], actor_id: str):
    """Background task: evaluate each sheet via vision LLM."""
    from mac.database import async_session
    async with async_session() as db:
        sess = await svc.get_session(db, session_id)
        if not sess:
            return

        llm_url = f"{settings.vllm_base_url}/v1/chat/completions"

        async with httpx.AsyncClient() as client:
            for sheet_id in sheet_ids:
                sheet = await svc.get_sheet(db, sheet_id)
                if not sheet:
                    continue
                try:
                    result = await svc.evaluate_sheet(sheet, sess, client, llm_url)
                    sheet.ai_marks = result["marks"]
                    sheet.ai_feedback = result["feedback"]
                    sheet.extracted_text = result["extracted_text"]
                    from datetime import datetime, timezone
                    sheet.evaluated_at = datetime.now(timezone.utc)
                    sheet.status = "done" if result["marks"] is not None else "error"
                    if result["marks"] is None:
                        sheet.error_message = (result["feedback"] or "")[:400]
                except Exception as e:
                    sheet.status = "error"
                    sheet.error_message = str(e)[:400]
                await db.commit()

        # Update session counts
        sheets = await svc.get_sheets(db, session_id)
        done = sum(1 for s in sheets if s.status == "done")
        sess.evaluated_count = done
        all_done = all(s.status in ("done", "error") for s in sheets)
        if all_done:
            sess.status = "done"
        await db.commit()

        # Notify creator (faculty/admin who triggered)
        from mac.services import notification_service as ns
        from mac.models.user import User as UserModel
        from sqlalchemy import select as _select

        summary_body = (
            f"'{sess.subject}' — {sess.class_name or ''} {sess.department} | "
            f"{done}/{sess.sheet_count} evaluated."
        )
        await ns.create_notification(
            db, user_id=actor_id,
            title="Copy Check Complete",
            body=summary_body,
            category="copy_check",
            link="#copycheck",
        )

        # Notify all admins (so they see results without keeping app open)
        admins = (await db.execute(
            _select(UserModel).where(UserModel.role == "admin", UserModel.id != actor_id)
        )).scalars().all()
        for admin in admins:
            await ns.create_notification(
                db, user_id=admin.id,
                title="Copy Check Complete",
                body=summary_body,
                category="copy_check",
                link="#copycheck",
            )

        # Notify each student with their individual result
        evaluated_sheets = await svc.get_sheets(db, session_id)
        for sheet in evaluated_sheets:
            if sheet.status != "done" or sheet.ai_marks is None:
                continue
            pct = round((sheet.ai_marks / sess.total_marks) * 100) if sess.total_marks else 0
            # Find student user account by roll number
            student_user = (await db.execute(
                _select(UserModel).where(UserModel.roll_number == sheet.student_roll)
            )).scalar_one_or_none()
            if student_user:
                feedback_snippet = (sheet.ai_feedback or "")[:200]
                await ns.create_notification(
                    db, user_id=student_user.id,
                    title=f"Your marks: {sheet.ai_marks}/{sess.total_marks} ({pct}%)",
                    body=f"{sess.subject} — {feedback_snippet}",
                    category="copy_check",
                    link="#copycheck",
                )

        await db.commit()
        await ns.log_audit(
            db, actor_id=actor_id, actor_role="system",
            action="copy_check.evaluate.complete",
            resource_type="copy_check", resource_id=session_id,
            details=f"Evaluated {done}/{len(sheet_ids)} sheets",
        )


# ── Student: view own results ────────────────────────────

@router.get("/my-results")
async def get_my_results(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Students view evaluated sheets for their own roll number."""
    if not user.roll_number:
        return {"results": []}
    from sqlalchemy import select as _select
    from mac.models.copy_check import CopyCheckSheet, CopyCheckSession
    rows = (await db.execute(
        _select(CopyCheckSheet, CopyCheckSession)
        .join(CopyCheckSession, CopyCheckSheet.session_id == CopyCheckSession.id)
        .where(CopyCheckSheet.student_roll == user.roll_number)
        .where(CopyCheckSheet.status == "done")
        .order_by(CopyCheckSession.created_at.desc())
    )).all()
    return {
        "results": [
            {
                "session_id": sess.id,
                "subject": sess.subject,
                "class_name": sess.class_name,
                "department": sess.department,
                "total_marks": sess.total_marks,
                "ai_marks": sheet.ai_marks,
                "ai_feedback": sheet.ai_feedback,
                "pct": round((sheet.ai_marks / sess.total_marks) * 100) if sess.total_marks and sheet.ai_marks is not None else 0,
                "evaluated_at": sheet.evaluated_at.isoformat() if sheet.evaluated_at else None,
            }
            for sheet, sess in rows
        ]
    }


# ── Plagiarism Check ─────────────────────────────────────

@router.post("/sessions/{session_id}/plagiarism")
async def run_plagiarism(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Run pairwise plagiarism detection on all evaluated sheets."""
    sess = await _get_or_404(db, session_id)
    _check_ownership(sess, user)
    sheets = await svc.get_sheets(db, session_id)
    done = [s for s in sheets if s.status == "done"]
    if len(done) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 evaluated sheets to check plagiarism.")

    results = await svc.run_plagiarism_check(db, session_id)
    confirmed = sum(1 for p in results if p.verdict == "confirmed")
    suspected = sum(1 for p in results if p.verdict == "suspected")

    await notification_service.log_audit(
        db, actor_id=user.id, actor_role=user.role,
        action="copy_check.plagiarism.run", resource_type="copy_check",
        resource_id=session_id,
        details=f"Confirmed:{confirmed} Suspected:{suspected} Total pairs:{len(results)}",
    )
    return {
        "total_pairs": len(results),
        "confirmed": confirmed,
        "suspected": suspected,
        "results": [_plg_dict(p) for p in results],
    }


# ── PDF Report ────────────────────────────────────────────

@router.get("/sessions/{session_id}/report/pdf")
async def download_pdf_report(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Download the full PDF report for a session."""
    sess = await _get_or_404(db, session_id)
    _check_ownership(sess, user)
    sheets = await svc.get_sheets(db, session_id)
    plagiarism = await svc.get_plagiarism_results(db, session_id)

    pdf_bytes = svc.generate_pdf_report(sess, sheets, plagiarism)
    safe_name = sess.subject.replace(" ", "_")[:30]

    # Detect if fallback HTML was returned
    content_type = "application/pdf"
    ext = "pdf"
    if pdf_bytes[:9] == b"<!DOCTYPE" or pdf_bytes[:5] == b"<html":
        content_type = "text/html"
        ext = "html"

    return Response(
        content=pdf_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="CopyCheck_{safe_name}.{ext}"'},
    )


# ── Guardrail Rules CRUD (Admin) — extends existing router ──

@router.patch("/sessions/{session_id}/archive")
async def archive_session(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    sess = await _get_or_404(db, session_id)
    _check_ownership(sess, user)
    sess.status = "archived"
    await db.commit()
    return {"status": "archived"}


# ── Helpers ───────────────────────────────────────────────

async def _get_or_404(db, session_id: str) -> svc.CopyCheckSession:
    sess = await svc.get_session(db, session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found.")
    return sess


def _check_ownership(sess: svc.CopyCheckSession, user: User):
    if user.role == "admin":
        return
    if sess.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied.")


def _session_dict(s: svc.CopyCheckSession) -> dict:
    return {
        "id": s.id,
        "subject": s.subject,
        "class_name": s.class_name,
        "department": s.department,
        "total_marks": s.total_marks,
        "status": s.status,
        "sheet_count": s.sheet_count,
        "evaluated_count": s.evaluated_count,
        "plagiarism_run": s.plagiarism_run == "1",
        "has_syllabus": bool(s.syllabus_text or s.syllabus_file_path),
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _sheet_dict(s: svc.CopyCheckSheet) -> dict:
    return {
        "id": s.id,
        "student_roll": s.student_roll,
        "student_name": s.student_name,
        "department": s.department,
        "file_name": s.file_name,
        "ai_marks": s.ai_marks,
        "ai_feedback": s.ai_feedback,
        "status": s.status,
        "error_message": s.error_message,
        "evaluated_at": s.evaluated_at.isoformat() if s.evaluated_at else None,
        "uploaded_at": s.uploaded_at.isoformat() if s.uploaded_at else None,
    }


def _plg_dict(p: svc.CopyCheckPlagiarism) -> dict:
    return {
        "id": p.id,
        "roll_a": p.roll_a,
        "roll_b": p.roll_b,
        "similarity_score": p.similarity_score,
        "similarity_pct": round(p.similarity_score * 100, 1),
        "verdict": p.verdict,
        "matched_sections": json.loads(p.matched_sections) if p.matched_sections else [],
    }
