"""Doubts router — student questions to faculty/department."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.middleware.feature_gate import feature_required
from mac.models.user import User
from mac.schemas.doubts import (
    CreateDoubtRequest, DoubtResponse,
    CreateDoubtReplyRequest, DoubtReplyResponse,
    DoubtListResponse, DoubtDetailResponse,
)
from mac.services import doubt_service, notification_service

router = APIRouter(prefix="/doubts", tags=["doubts"],
                   dependencies=[Depends(feature_required("doubts_forum"))])


def _require_faculty_or_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("faculty", "admin"):
        raise HTTPException(status_code=403, detail="Faculty or admin access required")
    return user


# ── Create Doubt (Students) ──────────────────────────────

@router.post("", response_model=DoubtResponse)
async def create_doubt(
    req: CreateDoubtRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Post a question/doubt to faculty or department."""
    doubt = await doubt_service.create_doubt(
        db,
        student_id=user.id,
        title=req.title,
        body=req.body,
        department=req.department,
        subject=req.subject,
        target_faculty_id=req.target_faculty_id,
        is_anonymous=req.is_anonymous,
    )
    await notification_service.log_audit(
        db, action="doubt.create", resource_type="doubt",
        resource_id=doubt.id, actor_id=user.id, actor_role=user.role,
    )

    # Notify target faculty
    if req.target_faculty_id:
        await notification_service.create_notification(
            db, user_id=req.target_faculty_id,
            title="New Student Doubt",
            body=f"Question: {req.title[:100]}",
            category="doubt_reply",
            link=f"#doubts/{doubt.id}",
        )

    return DoubtResponse(
        id=doubt.id, title=doubt.title, body=doubt.body,
        department=doubt.department, subject=doubt.subject,
        target_faculty_id=doubt.target_faculty_id,
        student_id=doubt.student_id, status=doubt.status,
        attachment_url=doubt.attachment_url,
        attachment_name=doubt.attachment_name,
        is_anonymous=doubt.is_anonymous,
        created_at=doubt.created_at, updated_at=doubt.updated_at,
    )


# ── List Doubts ──────────────────────────────────────────

@router.get("/my", response_model=DoubtListResponse)
async def my_doubts(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List current user's doubts (students see their own, faculty see targeted to them)."""
    if user.role == "student":
        doubts, total = await doubt_service.list_doubts_for_student(db, user.id, page, per_page)
    else:
        doubts, total = await doubt_service.list_doubts_for_faculty(
            db, user.id, user.department, page, per_page
        )
    return DoubtListResponse(
        doubts=[_doubt_to_response(d) for d in doubts],
        total=total, page=page, per_page=per_page,
    )


@router.get("/all", response_model=DoubtListResponse)
async def all_doubts(
    department: Optional[str] = None,
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Faculty/Admin: list all doubts with filters."""
    doubts, total = await doubt_service.list_all_doubts(
        db, department=department, status=status, page=page, per_page=per_page
    )
    return DoubtListResponse(
        doubts=[_doubt_to_response(d) for d in doubts],
        total=total, page=page, per_page=per_page,
    )


# ── Doubt Detail ────────────────────────────────────────

@router.get("/{doubt_id}")
async def get_doubt(
    doubt_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get doubt detail with all replies."""
    result = await doubt_service.get_doubt_with_user_info(db, doubt_id)
    if not result:
        raise HTTPException(status_code=404, detail="Doubt not found")

    # Students can only see their own doubts
    if user.role == "student" and result["doubt"]["student_id"] != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    return result


# ── Reply to Doubt (Faculty/Admin) ───────────────────────

@router.post("/{doubt_id}/reply", response_model=DoubtReplyResponse)
async def reply_to_doubt(
    doubt_id: str,
    req: CreateDoubtReplyRequest,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reply to a student's doubt."""
    reply = await doubt_service.reply_to_doubt(
        db, doubt_id=doubt_id, author_id=user.id, body=req.body,
    )
    if not reply:
        raise HTTPException(status_code=404, detail="Doubt not found")

    # Notify the student
    doubt = await doubt_service.get_doubt(db, doubt_id)
    if doubt:
        await notification_service.create_notification(
            db, user_id=doubt.student_id,
            title="Reply to Your Doubt",
            body=f"A faculty member replied: {req.body[:100]}...",
            category="doubt_reply",
            link=f"#doubts/{doubt_id}",
        )

    await notification_service.log_audit(
        db, action="doubt.reply", resource_type="doubt_reply",
        resource_id=reply.id, actor_id=user.id, actor_role=user.role,
    )

    return DoubtReplyResponse(
        id=reply.id, doubt_id=reply.doubt_id, author_id=reply.author_id,
        author_name=user.name, author_role=user.role,
        body=reply.body, attachment_url=reply.attachment_url,
        attachment_name=reply.attachment_name, created_at=reply.created_at,
    )


@router.post("/{doubt_id}/close")
async def close_doubt(
    doubt_id: str,
    user: User = Depends(_require_faculty_or_admin),
    db: AsyncSession = Depends(get_db),
):
    success = await doubt_service.close_doubt(db, doubt_id)
    if not success:
        raise HTTPException(status_code=404, detail="Doubt not found")
    return {"status": "closed"}


# ── Helpers ──────────────────────────────────────────────

def _doubt_to_response(d) -> DoubtResponse:
    return DoubtResponse(
        id=d.id, title=d.title, body=d.body, department=d.department,
        subject=d.subject, target_faculty_id=d.target_faculty_id,
        student_id=d.student_id, status=d.status,
        attachment_url=d.attachment_url, attachment_name=d.attachment_name,
        is_anonymous=d.is_anonymous,
        reply_count=len(d.replies) if hasattr(d, 'replies') and d.replies else 0,
        created_at=d.created_at, updated_at=d.updated_at,
    )
