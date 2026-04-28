"""System endpoints — version, update status, restart, log tail."""

import asyncio
import logging

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from mac.middleware.auth_middleware import require_admin
from mac.models.user import User
from mac.services import updater

log = logging.getLogger(__name__)
router = APIRouter(prefix="/system", tags=["System"])
admin_router = APIRouter(prefix="/admin/system", tags=["Admin · System"])


@router.get("/version")
async def version():
    return {"version": updater.get_current_version()}


@router.get("/update-status")
async def update_status():
    return await updater.check_for_update(use_cache=True)


@admin_router.post("/restart")
async def restart(admin: User = Depends(require_admin)):
    """Acknowledge a restart request. Real restart is handled by the host
    process supervisor (Docker / Tauri shell) — wired in Session 6."""
    log.info("Restart requested by admin %s", admin.id)
    return {
        "ok": True,
        "message": "Restart acknowledged. The host process supervisor must perform the actual restart.",
    }


@admin_router.get("/logs")
async def logs(admin: User = Depends(require_admin)):
    """SSE log tail. Stub this session — Session 6 wires real Docker log tail."""
    async def gen():
        yield {"event": "info", "data": "Log streaming is a Session 6 deliverable."}
        for i in range(3):
            await asyncio.sleep(1)
            yield {"event": "log", "data": f"placeholder line {i + 1}"}

    return EventSourceResponse(gen())
