"""Live activity feed SSE endpoint — admin only.

EventSource (browser) cannot set Authorization headers, so the stream endpoint
accepts the JWT via a `token` query parameter as well as the standard header.
"""

import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db, async_session
from mac.middleware.auth_middleware import require_admin
from mac.models.user import User
from mac.services import activity_service
from mac.utils.security import decode_access_token

router = APIRouter(prefix="/admin/activity", tags=["Live Activity"])


async def _get_admin_token(
    request: Request,
    token: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Accept JWT from Authorization header OR ?token= query param (for EventSource)."""
    raw = token
    if not raw:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            raw = auth[7:]
    if not raw:
        raise HTTPException(status_code=401, detail="Unauthorized")

    payload = decode_access_token(raw)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    from mac.services.auth_service import get_user_by_id
    user = await get_user_by_id(db, payload.get("sub", ""))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user


@router.get("/recent")
async def get_recent_activity(
    limit: int = 100,
    admin: User = Depends(require_admin),
):
    """Get last N activity entries."""
    return {"entries": activity_service.get_recent(min(limit, 200))}


@router.get("/stream")
async def stream_activity(
    admin: User = Depends(_get_admin_token),
):
    """SSE stream — new entries pushed in real-time, IST timestamps.

    Accepts JWT via Authorization header OR ?token= query param so that
    browser EventSource (which can't set headers) can authenticate.
    """
    q = await activity_service.subscribe()

    async def _gen():
        # Seed with recent history first (newest → oldest in deque, send oldest first)
        for entry in reversed(activity_service.get_recent(50)):
            yield f"data: {json.dumps(entry)}\n\n"

        try:
            while True:
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            activity_service.unsubscribe(q)

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
