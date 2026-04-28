"""Notification service — in-app notifications and push subscription management."""

import json
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from mac.models.notification import Notification, PushSubscription, AuditLog


def _utcnow():
    return datetime.now(timezone.utc)


# ── Notifications ─────────────────────────────────────────

async def create_notification(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str = "",
    category: str = "general",
    link: Optional[str] = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        title=title,
        body=body,
        category=category,
        link=link,
    )
    db.add(notif)
    await db.flush()
    return notif


async def get_notifications(
    db: AsyncSession, user_id: str, page: int = 1, per_page: int = 20
) -> tuple[list[Notification], int, int]:
    """Returns (notifications, total, unread_count)."""
    count = (await db.execute(
        select(func.count(Notification.id)).where(Notification.user_id == user_id)
    )).scalar() or 0
    unread = (await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.is_read == False
        )
    )).scalar() or 0
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), count, unread


async def mark_as_read(db: AsyncSession, notification_id: str, user_id: str) -> bool:
    stmt = (
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user_id)
        .values(is_read=True)
    )
    result = await db.execute(stmt)
    return result.rowcount > 0


async def mark_all_read(db: AsyncSession, user_id: str) -> int:
    stmt = (
        update(Notification)
        .where(Notification.user_id == user_id, Notification.is_read == False)
        .values(is_read=True)
    )
    result = await db.execute(stmt)
    return result.rowcount


# ── Push Subscriptions ───────────────────────────────────

async def save_push_subscription(
    db: AsyncSession, user_id: str, endpoint: str, p256dh_key: str, auth_key: str
) -> PushSubscription:
    # Check if subscription exists for this endpoint
    existing = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == endpoint,
        )
    )
    sub = existing.scalar_one_or_none()
    if sub:
        sub.p256dh_key = p256dh_key
        sub.auth_key = auth_key
    else:
        sub = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh_key=p256dh_key,
            auth_key=auth_key,
        )
        db.add(sub)
    await db.flush()
    return sub


async def get_push_subscriptions(db: AsyncSession, user_id: str) -> list[PushSubscription]:
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    return list(result.scalars().all())


# ── Audit Logs ────────────────────────────────────────────

async def log_audit(
    db: AsyncSession,
    action: str,
    resource_type: str = "system",
    resource_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    actor_role: str = "system",
    details: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    log = AuditLog(
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
    )
    db.add(log)
    await db.flush()
    return log


async def get_audit_logs(
    db: AsyncSession,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
) -> tuple[list[AuditLog], int]:
    query = select(AuditLog)
    count_query = select(func.count(AuditLog.id))

    if action:
        query = query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)
        count_query = count_query.where(AuditLog.resource_type == resource_type)
    if actor_id:
        query = query.where(AuditLog.actor_id == actor_id)
        count_query = count_query.where(AuditLog.actor_id == actor_id)

    count = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), count
