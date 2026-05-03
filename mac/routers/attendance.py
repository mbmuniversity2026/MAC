"""Attendance router — face registration, session management, attendance marking."""

import csv
import io
from datetime import date, datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.middleware.feature_gate import feature_required
from mac.models.user import User
from mac.models.attendance import AttendanceSettings
from mac.schemas.attendance import (
    CreateAttendanceSessionRequest, AttendanceSessionResponse,
    MarkAttendanceRequest, AttendanceRecordResponse,
    RegisterFaceRequest, RegisterFaceResponse,
)
from mac.services import attendance_service, notification_service

router = APIRouter(prefix="/attendance", tags=["attendance"],
                   dependencies=[Depends(feature_required("attendance"))])

# IST timezone (UTC+5:30)
IST = timezone(timedelta(hours=5, minutes=30))


def _require_faculty_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("faculty", "admin"):
        raise HTTPException(status_code=403, detail="Faculty or admin access required")
    return user


async def _get_settings(db: AsyncSession) -> AttendanceSettings:
    """Fetch singleton attendance window settings, creating defaults if missing."""
    result = await db.execute(select(AttendanceSettings).where(AttendanceSettings.id == "default"))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        cfg = AttendanceSettings(id="default")
        db.add(cfg)
        await db.flush()
    return cfg


async def _check_attendance_window(db: AsyncSession):
    """Allow actions only within the configured daily window. Dev mode always open."""
    from mac.config import settings
    if settings.is_dev:
        return
    cfg = await _get_settings(db)
    now = datetime.now(IST)
    now_minutes = now.hour * 60 + now.minute
    open_minutes = cfg.open_hour * 60 + cfg.open_minute
    close_minutes = cfg.close_hour * 60 + cfg.close_minute
    if not (open_minutes <= now_minutes < close_minutes):
        raise HTTPException(
            status_code=400,
            detail=f"Attendance window closed. Active {cfg.open_hour:02d}:{cfg.open_minute:02d}–{cfg.close_hour:02d}:{cfg.close_minute:02d} IST.",
        )


# ── Attendance Window Settings ────────────────────────────────────

@router.get("/settings")
async def get_attendance_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current attendance window settings."""
    cfg = await _get_settings(db)
    now = datetime.now(IST)
    now_minutes = now.hour * 60 + now.minute
    open_minutes = cfg.open_hour * 60 + cfg.open_minute
    close_minutes = cfg.close_hour * 60 + cfg.close_minute
    return {
        "open_hour": cfg.open_hour,
        "open_minute": cfg.open_minute,
        "close_hour": cfg.close_hour,
        "close_minute": cfg.close_minute,
        "window_open_now": open_minutes <= now_minutes < close_minutes,
        "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
    }


@router.put("/settings")
async def update_attendance_settings(
    body: dict,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: update attendance window open/close times (IST)."""
    cfg = await _get_settings(db)
    if "open_hour" in body:
        cfg.open_hour = int(body["open_hour"])
    if "open_minute" in body:
        cfg.open_minute = int(body["open_minute"])
    if "close_hour" in body:
        cfg.close_hour = int(body["close_hour"])
    if "close_minute" in body:
        cfg.close_minute = int(body["close_minute"])
    cfg.updated_by = user.id
    cfg.updated_at = datetime.now(timezone.utc)
    await notification_service.log_audit(
        db, action="attendance.settings_update", resource_type="attendance_settings",
        actor_id=user.id, actor_role=user.role,
        details=f"Window: {cfg.open_hour:02d}:{cfg.open_minute:02d}–{cfg.close_hour:02d}:{cfg.close_minute:02d}",
    )
    now = datetime.now(IST)
    now_minutes = now.hour * 60 + now.minute
    return {
        "open_hour": cfg.open_hour, "open_minute": cfg.open_minute,
        "close_hour": cfg.close_hour, "close_minute": cfg.close_minute,
        "window_open_now": (cfg.open_hour * 60 + cfg.open_minute) <= now_minutes < (cfg.close_hour * 60 + cfg.close_minute),
        "updated_at": cfg.updated_at.isoformat(),
    }


# Default subjects
DEFAULT_SUBJECTS = ["AI", "CSE", "IT"]


@router.get("/subjects")
async def list_subjects():
    """Return available subjects for attendance sessions."""
    return {"subjects": DEFAULT_SUBJECTS}


# ── Student: Today's Sessions ────────────────────────────────

@router.get("/my-today")
async def my_today(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Student view: today's sessions for their department, with already_marked flags."""
    from mac.models.attendance import AttendanceSession, AttendanceRecord
    cfg = await _get_settings(db)
    now = datetime.now(IST)
    today = now.date()
    now_minutes = now.hour * 60 + now.minute
    open_minutes = cfg.open_hour * 60 + cfg.open_minute
    close_minutes = cfg.close_hour * 60 + cfg.close_minute
    window_open = open_minutes <= now_minutes < close_minutes

    result = await db.execute(
        select(AttendanceSession).where(
            AttendanceSession.session_date == today,
            AttendanceSession.department == user.department,
        )
    )
    sessions = result.scalars().all()

    marked_ids = set()
    if sessions:
        recs = await db.execute(
            select(AttendanceRecord.session_id).where(
                AttendanceRecord.user_id == user.id,
                AttendanceRecord.session_id.in_([s.id for s in sessions]),
            )
        )
        marked_ids = {r[0] for r in recs.all()}

    return {
        "sessions": [
            {
                "id": s.id,
                "title": s.title,
                "department": s.department,
                "subject": s.subject,
                "is_open": s.is_open,
                "already_marked": s.id in marked_ids,
            }
            for s in sessions
        ],
        "window_open": window_open,
        "window": f"{cfg.open_hour:02d}:{cfg.open_minute:02d}–{cfg.close_hour:02d}:{cfg.close_minute:02d}",
    }


# ── Face Registration ─────────────────────────────────────

@router.post("/register-face", response_model=RegisterFaceResponse)
async def register_face(
    req: RegisterFaceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register face for attendance verification. Required before marking attendance."""
    result = await attendance_service.register_face(db, user.id, req.face_image_base64)
    if result["success"]:
        await notification_service.log_audit(
            db, action="attendance.face_register", resource_type="face_template",
            actor_id=user.id, actor_role=user.role,
        )
    return RegisterFaceResponse(success=result["success"], message=result["message"])


@router.get("/face-status")
async def face_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if current user has a registered face template."""
    template = await attendance_service.get_face_template(db, user.id)
    return {
        "registered": template is not None,
        "captured_at": template.captured_at.isoformat() if template else None,
    }


# ── Session Management (Faculty/Admin) ───────────────────

@router.post("/sessions", response_model=AttendanceSessionResponse)
async def create_session(
    req: CreateAttendanceSessionRequest,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new attendance session for a department/subject."""
    await _check_attendance_window(db)
    session = await attendance_service.create_session(
        db, title=req.title, department=req.department,
        opened_by=user.id, session_date=req.session_date,
        subject=req.subject,
    )
    await notification_service.log_audit(
        db, action="attendance.session_create", resource_type="attendance_session",
        resource_id=session.id, actor_id=user.id, actor_role=user.role,
        details=f"Dept: {req.department}, Date: {req.session_date}",
    )
    return AttendanceSessionResponse(
        id=session.id, title=session.title, department=session.department,
        subject=session.subject, session_date=session.session_date,
        is_open=session.is_open, opened_by=session.opened_by,
        opened_at=session.opened_at, closed_at=session.closed_at,
    )


@router.post("/sessions/{session_id}/close")
async def close_session(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    success = await attendance_service.close_session(db, session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "closed"}


@router.get("/sessions")
async def list_sessions(
    department: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List attendance sessions. Students see their department only."""
    if user.role == "student":
        department = user.department
    sessions, total = await attendance_service.list_sessions(
        db, department=department, date_from=date_from, date_to=date_to,
        page=page, per_page=per_page,
    )
    return {
        "sessions": [
            {
                "id": s.id, "title": s.title, "department": s.department,
                "subject": s.subject, "session_date": s.session_date.isoformat(),
                "is_open": s.is_open, "opened_by": s.opened_by,
                "opened_at": s.opened_at.isoformat(),
                "closed_at": s.closed_at.isoformat() if s.closed_at else None,
            }
            for s in sessions
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


# ── Mark Attendance (Students) ───────────────────────────

@router.post("/mark")
async def mark_attendance(
    req: MarkAttendanceRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark attendance for a session with live face verification.
    Enforces: (1) daily window, (2) session must be open, (3) NOW must be within session time window.
    """
    from mac.models.attendance import AttendanceSession

    await _check_attendance_window(db)

    # Verify the session exists and is currently open
    session_result = await db.execute(
        select(AttendanceSession).where(AttendanceSession.id == req.session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Attendance session not found")
    if not session.is_open:
        raise HTTPException(status_code=403, detail={
            "code": "window_closed",
            "message": "Attendance window has closed. This session is no longer accepting check-ins.",
        })

    # Cross-check: session must be for today (reject back-dated attempts)
    now_ist = datetime.now(IST)
    if session.session_date != now_ist.date():
        raise HTTPException(status_code=403, detail={
            "code": "window_closed",
            "message": "Attendance window has closed. This session is from a different date.",
        })

    ip = request.client.host if request.client else None
    result = await attendance_service.mark_attendance(
        db, session_id=req.session_id, user_id=user.id,
        face_image_b64=req.face_image_base64, ip_address=ip,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    await notification_service.log_audit(
        db, action="attendance.mark", resource_type="attendance_record",
        resource_id=result.get("record_id"), actor_id=user.id, actor_role=user.role,
        ip_address=ip,
    )
    return result


# ── Reports (Faculty/Admin) ─────────────────────────────

@router.get("/sessions/{session_id}/report")
async def session_report(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Full attendance report for a session with student details."""
    report = await attendance_service.get_session_report(db, session_id)
    if not report:
        raise HTTPException(status_code=404, detail="Session not found")
    return report


@router.get("/sessions/{session_id}/report/csv")
async def session_report_csv(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Download session attendance report as CSV."""
    report = await attendance_service.get_session_report(db, session_id)
    if not report:
        raise HTTPException(status_code=404, detail="Session not found")

    output = io.StringIO()
    writer = csv.writer(output)
    sess = report["session"]
    writer.writerow(["MAC — MBM AI Cloud | Attendance Report"])
    writer.writerow([f"Subject: {sess.get('title','')} | Dept: {sess.get('department','')} | Date: {sess.get('session_date','')}"])
    writer.writerow([])
    writer.writerow(["#", "Roll Number", "Name", "Department", "Face Verified", "Confidence %", "Time", "IP Address"])
    for i, r in enumerate(report["records"], 1):
        writer.writerow([
            i,
            r.get("roll_number", ""),
            r.get("student_name", ""),
            r.get("department", ""),
            "Yes" if r.get("face_verified") else "No",
            f"{r.get('face_match_confidence', 0) * 100:.1f}",
            r.get("marked_at", ""),
            r.get("ip_address", ""),
        ])
    writer.writerow([])
    writer.writerow(["Total Present:", report["total_present"]])

    filename = f"attendance_{sess.get('session_date','')}.csv"
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sessions/{session_id}/report/pdf")
async def session_report_pdf(
    session_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Download session attendance report as PDF."""
    from fpdf import FPDF
    report = await attendance_service.get_session_report(db, session_id)
    if not report:
        raise HTTPException(status_code=404, detail="Session not found")

    sess = report["session"]
    records = report["records"]

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "MAC - MBM AI Cloud | Attendance Report", ln=True, align="C")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, f"Subject: {sess.get('title', '')}  |  Dept: {sess.get('department', '')}  |  Date: {sess.get('session_date', '')}", ln=True, align="C")
    pdf.cell(0, 7, f"Total Present: {report['total_present']}", ln=True, align="C")
    pdf.ln(4)

    # Table header
    pdf.set_fill_color(230, 110, 50)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    col_w = [8, 28, 50, 22, 18, 22, 38]
    headers = ["#", "Roll No", "Name", "Dept", "Face", "Conf%", "Time"]
    for w, h in zip(col_w, headers):
        pdf.cell(w, 7, h, border=1, fill=True)
    pdf.ln()

    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 8)
    for i, r in enumerate(records, 1):
        fill = i % 2 == 0
        if fill:
            pdf.set_fill_color(245, 245, 245)
        pdf.cell(col_w[0], 6, str(i), border=1, fill=fill)
        pdf.cell(col_w[1], 6, str(r.get("roll_number", ""))[:16], border=1, fill=fill)
        pdf.cell(col_w[2], 6, str(r.get("student_name", ""))[:28], border=1, fill=fill)
        pdf.cell(col_w[3], 6, str(r.get("department", ""))[:10], border=1, fill=fill)
        pdf.cell(col_w[4], 6, "Yes" if r.get("face_verified") else "No", border=1, fill=fill)
        pdf.cell(col_w[5], 6, f"{r.get('face_match_confidence', 0) * 100:.1f}%", border=1, fill=fill)
        t = r.get("marked_at", "")[:16].replace("T", " ")
        pdf.cell(col_w[6], 6, t, border=1, fill=fill)
        pdf.ln()

    filename = f"attendance_{sess.get('session_date', '')}.pdf"
    pdf_bytes = pdf.output()
    return StreamingResponse(
        iter([bytes(pdf_bytes)]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/summary/csv")
async def attendance_summary_csv(
    department: Optional[str] = None,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Download student attendance summary as CSV."""
    summaries = await attendance_service.get_student_summary(db, department=department)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["MAC — MBM AI Cloud | Attendance Summary"])
    if department:
        writer.writerow([f"Department: {department}"])
    writer.writerow([])
    writer.writerow(["#", "Roll Number", "Name", "Department", "Sessions Attended", "Total Sessions", "Attendance %"])
    for i, s in enumerate(summaries, 1):
        writer.writerow([i, s["roll_number"], s["student_name"], s["department"],
                         s["sessions_attended"], s["total_sessions"], f"{s['attendance_pct']}%"])
    output.seek(0)
    fname = f"attendance_summary{'_' + department if department else ''}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/admin/overview")
async def admin_overview(
    department: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin/Faculty: all sessions enriched with opener name, record count, student list."""
    return await attendance_service.get_admin_overview(
        db, department=department, date_from=date_from, date_to=date_to,
        page=page, per_page=per_page,
    )


@router.get("/summary")
async def attendance_summary(
    department: Optional[str] = None,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Per-student attendance summary across all sessions."""
    summaries = await attendance_service.get_student_summary(db, department=department)
    return {"students": summaries, "total": len(summaries)}
