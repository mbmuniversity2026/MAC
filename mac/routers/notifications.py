"""Notifications router — in-app notifications, push subscriptions, audit logs, SSE."""

import os
import asyncio
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User
from mac.schemas.notifications import (
    NotificationResponse, NotificationListResponse,
    PushSubscribeRequest,
    AuditLogResponse, AuditLogListResponse,
)
from mac.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── User Notifications ───────────────────────────────────

@router.get("", response_model=NotificationListResponse)
async def get_notifications(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user's notifications."""
    notifs, total, unread = await notification_service.get_notifications(
        db, user.id, page=page, per_page=per_page,
    )
    return NotificationListResponse(
        notifications=[
            NotificationResponse(
                id=n.id, title=n.title, body=n.body, category=n.category,
                link=n.link, is_read=n.is_read, created_at=n.created_at,
            )
            for n in notifs
        ],
        total=total,
        unread_count=unread,
    )


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    success = await notification_service.mark_as_read(db, notification_id, user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "read"}


@router.post("/read-all")
async def mark_all_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count = await notification_service.mark_all_read(db, user.id)
    return {"marked": count}


# ── Push Subscriptions ───────────────────────────────────

@router.post("/push/subscribe")
async def subscribe_push(
    req: PushSubscribeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register a Web Push subscription for browser notifications."""
    await notification_service.save_push_subscription(
        db, user.id, req.endpoint, req.p256dh_key, req.auth_key,
    )
    return {"status": "subscribed"}


@router.get("/vapid-key")
async def get_vapid_key(user: User = Depends(get_current_user)):
    """Return the VAPID public key for Web Push subscription."""
    public_key = os.getenv("VAPID_PUBLIC_KEY", "")
    if not public_key:
        raise HTTPException(status_code=501, detail="Push notifications not configured")
    return {"public_key": public_key}


# ── Audit Logs (Admin only) ─────────────────────────────

@router.get("/audit-logs", response_model=AuditLogListResponse)
async def get_audit_logs(
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: browse audit trail with filters."""
    logs, total = await notification_service.get_audit_logs(
        db, action=action, resource_type=resource_type,
        actor_id=actor_id, page=page, per_page=per_page,
    )
    return AuditLogListResponse(
        logs=[
            AuditLogResponse(
                id=l.id, actor_id=l.actor_id, actor_role=l.actor_role,
                action=l.action, resource_type=l.resource_type,
                resource_id=l.resource_id, details=l.details,
                ip_address=l.ip_address, created_at=l.created_at,
            )
            for l in logs
        ],
        total=total,
        page=page,
        per_page=per_page,
    )


# ── SSE: Real-time Activity Stream (Admin only) ─────────

@router.get("/activity-stream")
async def activity_stream(
    request: Request,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Server-Sent Events stream of latest audit log entries for admin dashboard.
    Connect with: EventSource('/api/v1/notifications/activity-stream?token=JWT')
    """
    from mac.utils.security import decode_access_token
    from mac.services.auth_service import get_user_by_id

    async def _deny(msg: str):
        yield f"event: error\ndata: {{\"detail\": \"{msg}\"}}\n\n"

    # Verify JWT from query param (SSE can't set Authorization header)
    payload = decode_access_token(token)
    if not payload:
        return StreamingResponse(_deny("Invalid token"), media_type="text/event-stream")
    user = await get_user_by_id(db, payload.get("sub", ""))
    if not user or user.role != "admin":
        return StreamingResponse(_deny("Admin only"), media_type="text/event-stream")

    last_id: list[str | None] = [None]

    async def event_generator():
        yield f"event: connected\ndata: {{\"status\": \"ok\", \"user\": \"{user.name}\"}}\n\n"
        while True:
            if await request.is_disconnected():
                break
            try:
                from mac.database import async_session
                async with async_session() as inner_db:
                    logs, _ = await notification_service.get_audit_logs(inner_db, page=1, per_page=8)
                if logs:
                    # Send only entries newer than what we last sent
                    if last_id[0] is None:
                        to_send = logs[:5]
                        last_id[0] = logs[0].id
                    else:
                        to_send = [l for l in logs if l.id == last_id[0]]
                        idx = logs.index(to_send[0]) if to_send else -1
                        to_send = logs[:idx] if idx > 0 else []
                        if to_send:
                            last_id[0] = logs[0].id
                    for log in reversed(to_send):
                        payload_data = json.dumps({
                            "id": log.id,
                            "action": log.action,
                            "actor_role": log.actor_role,
                            "resource_type": log.resource_type,
                            "details": (log.details or "")[:200],
                            "created_at": log.created_at.isoformat() if log.created_at else None,
                        })
                        yield f"event: activity\ndata: {payload_data}\n\n"
            except Exception:
                pass
            yield ": heartbeat\n\n"
            await asyncio.sleep(4)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

