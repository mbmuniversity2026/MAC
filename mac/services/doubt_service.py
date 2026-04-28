"""Doubts service — student-to-faculty Q&A system."""

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from mac.models.doubt import Doubt, DoubtReply
from mac.models.user import User


def _utcnow():
    return datetime.now(timezone.utc)


async def create_doubt(
    db: AsyncSession,
    student_id: str,
    title: str,
    body: str,
    department: str,
    subject: Optional[str] = None,
    target_faculty_id: Optional[str] = None,
    is_anonymous: bool = False,
    attachment_url: Optional[str] = None,
    attachment_name: Optional[str] = None,
) -> Doubt:
    doubt = Doubt(
        title=title,
        body=body,
        department=department,
        subject=subject,
        target_faculty_id=target_faculty_id,
        student_id=student_id,
        is_anonymous=is_anonymous,
        attachment_url=attachment_url,
        attachment_name=attachment_name,
    )
    db.add(doubt)
    await db.flush()
    return doubt


async def get_doubt(db: AsyncSession, doubt_id: str) -> Optional[Doubt]:
    result = await db.execute(
        select(Doubt)
        .options(selectinload(Doubt.replies))
        .where(Doubt.id == doubt_id)
    )
    return result.scalar_one_or_none()


async def list_doubts_for_student(
    db: AsyncSession, student_id: str, page: int = 1, per_page: int = 20
) -> tuple[list[Doubt], int]:
    count = (await db.execute(
        select(func.count(Doubt.id)).where(Doubt.student_id == student_id)
    )).scalar() or 0
    result = await db.execute(
        select(Doubt)
        .options(selectinload(Doubt.replies))
        .where(Doubt.student_id == student_id)
        .order_by(Doubt.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), count


async def list_doubts_for_faculty(
    db: AsyncSession, faculty_id: str, department: str, page: int = 1, per_page: int = 20
) -> tuple[list[Doubt], int]:
    """Get doubts targeted to this faculty or their department."""
    conditions = or_(
        Doubt.target_faculty_id == faculty_id,
        Doubt.department == department,
    )
    count = (await db.execute(
        select(func.count(Doubt.id)).where(conditions)
    )).scalar() or 0
    result = await db.execute(
        select(Doubt)        .options(selectinload(Doubt.replies))        .where(conditions)
        .order_by(Doubt.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), count


async def list_all_doubts(
    db: AsyncSession, department: Optional[str] = None,
    status: Optional[str] = None, page: int = 1, per_page: int = 20
) -> tuple[list[Doubt], int]:
    """Admin: list all doubts with filters."""
    query = select(Doubt)
    count_query = select(func.count(Doubt.id))
    if department:
        query = query.where(Doubt.department == department)
        count_query = count_query.where(Doubt.department == department)
    if status:
        query = query.where(Doubt.status == status)
        count_query = count_query.where(Doubt.status == status)

    count = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(
        query.options(selectinload(Doubt.replies))
        .order_by(Doubt.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), count


async def reply_to_doubt(
    db: AsyncSession,
    doubt_id: str,
    author_id: str,
    body: str,
    attachment_url: Optional[str] = None,
    attachment_name: Optional[str] = None,
) -> Optional[DoubtReply]:
    doubt = await get_doubt(db, doubt_id)
    if not doubt:
        return None

    reply = DoubtReply(
        doubt_id=doubt_id,
        author_id=author_id,
        body=body,
        attachment_url=attachment_url,
        attachment_name=attachment_name,
    )
    db.add(reply)

    # Update doubt status
    doubt.status = "answered"
    doubt.updated_at = _utcnow()

    await db.flush()
    return reply


async def close_doubt(db: AsyncSession, doubt_id: str) -> bool:
    doubt = await get_doubt(db, doubt_id)
    if not doubt:
        return False
    doubt.status = "closed"
    doubt.updated_at = _utcnow()
    return True


async def get_doubt_with_user_info(db: AsyncSession, doubt_id: str) -> Optional[dict]:
    """Get doubt with student/faculty info enriched."""
    doubt = await get_doubt(db, doubt_id)
    if not doubt:
        return None

    # Get student info
    student = (await db.execute(
        select(User).where(User.id == doubt.student_id)
    )).scalar_one_or_none()

    # Get reply authors
    author_ids = [r.author_id for r in doubt.replies]
    authors_map = {}
    if author_ids:
        authors_result = await db.execute(
            select(User).where(User.id.in_(author_ids))
        )
        authors_map = {u.id: u for u in authors_result.scalars().all()}

    replies_enriched = []
    for r in doubt.replies:
        author = authors_map.get(r.author_id)
        replies_enriched.append({
            "id": r.id,
            "doubt_id": r.doubt_id,
            "author_id": r.author_id,
            "author_name": author.name if author else None,
            "author_role": author.role if author else None,
            "body": r.body,
            "attachment_url": r.attachment_url,
            "attachment_name": r.attachment_name,
            "created_at": r.created_at,
        })

    return {
        "doubt": {
            "id": doubt.id,
            "title": doubt.title,
            "body": doubt.body,
            "department": doubt.department,
            "subject": doubt.subject,
            "target_faculty_id": doubt.target_faculty_id,
            "student_id": doubt.student_id,
            "student_name": student.name if student and not doubt.is_anonymous else "Anonymous",
            "student_roll": student.roll_number if student and not doubt.is_anonymous else None,
            "status": doubt.status,
            "attachment_url": doubt.attachment_url,
            "attachment_name": doubt.attachment_name,
            "is_anonymous": doubt.is_anonymous,
            "reply_count": len(doubt.replies),
            "created_at": doubt.created_at,
            "updated_at": doubt.updated_at,
        },
        "replies": replies_enriched,
    }
