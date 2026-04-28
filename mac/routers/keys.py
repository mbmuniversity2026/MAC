"""API key management endpoints — /keys (Phase 4)."""

import secrets
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.schemas.keys import (
    ApiKeyInfo, ApiKeyGenerateResponse, ApiKeyStatsResponse,
    AdminKeysResponse, AdminKeyInfo, AdminRevokeRequest,
)
from mac.services import usage_service, auth_service
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User

router = APIRouter(prefix="/keys", tags=["API Keys"])


@router.get("/my-key", response_model=ApiKeyInfo)
async def get_my_key(user: User = Depends(get_current_user)):
    """Get current API key (partially masked)."""
    key = user.api_key
    return ApiKeyInfo(
        key_prefix=key[:16] if len(key) > 16 else key[:8],
        key_suffix=key[-4:],
        created_at=user.created_at.isoformat(),
        status="active" if user.is_active else "revoked",
    )


@router.post("/generate", response_model=ApiKeyGenerateResponse)
async def generate_new_key(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Generate a new API key (invalidates previous key)."""
    new_key = f"mac_sk_live_{secrets.token_hex(24)}"
    user.api_key = new_key
    await db.flush()
    return ApiKeyGenerateResponse(api_key=new_key)


@router.get("/my-key/stats", response_model=ApiKeyStatsResponse)
async def key_stats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Token consumption stats for current API key."""
    usage = await usage_service.get_my_usage(db, user.id)
    return ApiKeyStatsResponse(
        tokens_today=usage["today"]["total_tokens"],
        tokens_this_week=usage["this_week"]["total_tokens"],
        tokens_this_month=usage["this_month"]["total_tokens"],
        requests_today=usage["today"]["requests"],
    )


@router.delete("/my-key")
async def revoke_my_key(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Revoke current API key permanently. Must generate a new one to use API key auth."""
    user.api_key = f"mac_sk_revoked_{secrets.token_hex(24)}"
    await db.flush()
    return {"message": "API key revoked. Generate a new key via POST /keys/generate."}


@router.get("/admin/all", response_model=AdminKeysResponse)
async def admin_list_keys(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """List all student API keys and status (admin-only)."""
    from sqlalchemy import select
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = list(result.scalars())

    keys = []
    for u in users:
        keys.append(AdminKeyInfo(
            roll_number=u.roll_number,
            name=u.name,
            key_prefix=u.api_key[:16] if len(u.api_key) > 16 else u.api_key[:8],
            status="active" if u.is_active and not u.api_key.startswith("mac_sk_revoked_") else "revoked",
        ))

    return AdminKeysResponse(keys=keys, total=len(keys))


@router.post("/admin/revoke")
async def admin_revoke_key(body: AdminRevokeRequest, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Force-revoke a student's API key (admin-only)."""
    user = await auth_service.get_user_by_roll(db, body.roll_number)
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    user.api_key = f"mac_sk_revoked_{secrets.token_hex(24)}"
    await db.flush()
    return {"message": f"API key revoked for {body.roll_number}", "reason": body.reason}
