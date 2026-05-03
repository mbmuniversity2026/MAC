"""Live activity feed SSE endpoint — admin only."""

import asyncio
import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from mac.middleware.auth_middleware import require_admin
from mac.models.user import User
from mac.services import activity_service

router = APIRouter(prefix="/admin/activity", tags=["Live Activity"])


@router.get("/recent")
async def get_recent_activity(
    limit: int = 100,
    admin: User = Depends(require_admin),
):
    """Get last N activity entries."""
    return {"entries": activity_service.get_recent(min(limit, 200))}


@router.get("/stream")
async def stream_activity(
    admin: User = Depends(require_admin),
):
    """SSE stream — new entries pushed in real-time, IST timestamps."""
    q = await activity_service.subscribe()

    async def _gen():
        # Seed with recent history
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

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
