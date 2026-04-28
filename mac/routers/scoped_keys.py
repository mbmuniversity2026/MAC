"""Scoped API Keys router — advanced key management with independent limits."""

import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User
from mac.schemas.notifications import (
    CreateScopedKeyRequest, ScopedKeyResponse, ScopedKeyListResponse,
)
from mac.services import scoped_key_service, notification_service

router = APIRouter(prefix="/scoped-keys", tags=["scoped-keys"])


# ── User Key Management ──────────────────────────────────

@router.post("", response_model=ScopedKeyResponse)
async def create_key(
    req: CreateScopedKeyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new scoped API key with custom limits and permissions."""
    plain_key, key = await scoped_key_service.create_scoped_key(
        db,
        user_id=user.id,
        name=req.name,
        allowed_models=req.allowed_models,
        allowed_endpoints=req.allowed_endpoints,
        requests_per_hour=req.requests_per_hour,
        tokens_per_day=req.tokens_per_day,
        max_tokens_per_request=req.max_tokens_per_request,
        expires_in_days=req.expires_in_days,
    )
    await notification_service.log_audit(
        db, action="key.create", resource_type="scoped_api_key",
        resource_id=key.id, actor_id=user.id, actor_role=user.role,
        details=f"Name: {req.name}",
    )
    return ScopedKeyResponse(
        id=key.id, name=key.name, key_prefix=key.key_prefix,
        key=plain_key,  # shown only once
        allowed_models=json.loads(key.allowed_models) if key.allowed_models else None,
        allowed_endpoints=json.loads(key.allowed_endpoints) if key.allowed_endpoints else None,
        requests_per_hour=key.requests_per_hour,
        tokens_per_day=key.tokens_per_day,
        max_tokens_per_request=key.max_tokens_per_request,
        is_active=key.is_active,
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        total_requests=key.total_requests,
        total_tokens=key.total_tokens,
        created_at=key.created_at,
    )


@router.get("/my", response_model=ScopedKeyListResponse)
async def my_keys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List current user's scoped API keys."""
    keys = await scoped_key_service.get_user_keys(db, user.id)
    return ScopedKeyListResponse(
        keys=[_key_to_response(k) for k in keys],
        total=len(keys),
    )


@router.delete("/{key_id}")
async def revoke_my_key(
    key_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke one of your own scoped API keys."""
    # Verify ownership
    keys = await scoped_key_service.get_user_keys(db, user.id)
    if not any(k.id == key_id for k in keys):
        raise HTTPException(status_code=404, detail="Key not found")

    success = await scoped_key_service.revoke_key(db, key_id, revoked_by=user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Key not found")

    await notification_service.log_audit(
        db, action="key.revoke", resource_type="scoped_api_key",
        resource_id=key_id, actor_id=user.id, actor_role=user.role,
    )
    return {"status": "revoked"}


# ── Admin Key Management ─────────────────────────────────

@router.get("/admin/all", response_model=ScopedKeyListResponse)
async def admin_list_keys(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: list all scoped API keys across all users."""
    keys, total = await scoped_key_service.get_all_keys(db, page=page, per_page=per_page)
    return ScopedKeyListResponse(
        keys=[_key_to_response(k) for k in keys],
        total=total,
    )


@router.delete("/admin/{key_id}")
async def admin_revoke_key(
    key_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: revoke any scoped API key."""
    success = await scoped_key_service.revoke_key(db, key_id, revoked_by=user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Key not found")

    await notification_service.log_audit(
        db, action="key.admin_revoke", resource_type="scoped_api_key",
        resource_id=key_id, actor_id=user.id, actor_role=user.role,
    )
    return {"status": "revoked"}


# ── Helpers ──────────────────────────────────────────────

def _key_to_response(k) -> ScopedKeyResponse:
    return ScopedKeyResponse(
        id=k.id, name=k.name, key_prefix=k.key_prefix,
        allowed_models=json.loads(k.allowed_models) if k.allowed_models else None,
        allowed_endpoints=json.loads(k.allowed_endpoints) if k.allowed_endpoints else None,
        requests_per_hour=k.requests_per_hour,
        tokens_per_day=k.tokens_per_day,
        max_tokens_per_request=k.max_tokens_per_request,
        is_active=k.is_active,
        expires_at=k.expires_at,
        last_used_at=k.last_used_at,
        total_requests=k.total_requests,
        total_tokens=k.total_tokens,
        created_at=k.created_at,
    )
