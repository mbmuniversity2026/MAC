"""Feature flags endpoints.

GET  /features/status         — public, returns compact dict + role map
GET  /features/stream         — public, SSE — pushes flag updates live
PATCH /admin/features/{key}   — admin only, toggle/update one flag
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from mac.database import get_db
from mac.middleware.auth_middleware import require_admin
from mac.models.user import User
from mac.schemas.feature import FeatureFlagUpdate, FeatureStatusResponse
from mac.services import feature_flag_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/features", tags=["Features"])
admin_router = APIRouter(prefix="/admin/features", tags=["Admin · Features"])


@router.get("/status", response_model=FeatureStatusResponse)
async def features_status(db: AsyncSession = Depends(get_db)):
    """Public snapshot of current feature flag state."""
    flags = await feature_flag_service.get_all_flags(db)
    return FeatureStatusResponse(
        flags={k: v["enabled"] for k, v in flags.items()},
        roles={k: v.get("allowed_roles", []) for k, v in flags.items()},
    )


@router.get("/stream")
async def features_stream(db: AsyncSession = Depends(get_db)):
    """SSE: snapshot + live updates from Redis pub/sub."""
    initial = await feature_flag_service.get_all_flags(db)

    async def gen():
        yield {"event": "snapshot", "data": json.dumps(initial)}
        try:
            async for update in feature_flag_service.subscribe_updates():
                yield {"event": "update", "data": json.dumps(update)}
        except Exception as e:  # noqa: BLE001
            log.debug("Feature stream closed: %s", e)
            return
        # If subscribe_updates yields nothing (Redis missing), keepalive forever
        while True:
            await asyncio.sleep(30)
            yield {"event": "ping", "data": ""}

    return EventSourceResponse(gen())


@admin_router.patch("/{key}")
async def update_feature(
    key: str,
    body: FeatureFlagUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Toggle a flag on/off and/or change its allowed_roles."""
    flag = await feature_flag_service.set_flag(
        db,
        key=key,
        enabled=body.enabled,
        allowed_roles=body.allowed_roles,
        actor_id=admin.id,
    )
    if not flag:
        raise HTTPException(status_code=404, detail={
            "code": "feature_not_found",
            "message": f"No feature flag '{key}'",
        })
    return {
        "key": flag.key,
        "enabled": flag.enabled,
        "allowed_roles": flag.allowed_roles or [],
    }
