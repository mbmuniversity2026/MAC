"""Quota management endpoints — /quota (Phase 4)."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.schemas.quota import (
    QuotaLimitsResponse, PersonalQuotaResponse,
    QuotaOverrideRequest, QuotaOverrideResponse,
    ExceededUsersResponse, ExceededUserInfo,
)
from mac.services import usage_service, auth_service
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User
from mac.models.quota import QuotaOverride
from mac.config import settings

router = APIRouter(prefix="/quota", tags=["Quota"])

# Default limits by role
ROLE_LIMITS = {
    "student": {"daily_tokens": 50_000, "requests_per_hour": 100, "max_tokens_per_request": 4096},
    "faculty": {"daily_tokens": 200_000, "requests_per_hour": 500, "max_tokens_per_request": 8192},
    "admin": {"daily_tokens": 10_000_000, "requests_per_hour": 10_000, "max_tokens_per_request": 16384},
}


@router.get("/limits", response_model=QuotaLimitsResponse)
async def get_quota_limits():
    """Show default quota limits per role."""
    return QuotaLimitsResponse(roles=ROLE_LIMITS)


@router.get("/me", response_model=PersonalQuotaResponse)
async def my_quota(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Personal quota limits and current consumption."""
    tokens_today = await usage_service.get_tokens_used_today(db, user.id)
    reqs_hour = await usage_service.get_requests_this_hour(db, user.id)

    # Check for override
    override = await db.execute(select(QuotaOverride).where(QuotaOverride.user_id == user.id))
    override_obj = override.scalar_one_or_none()

    base_limits = ROLE_LIMITS.get(user.role, ROLE_LIMITS["student"])

    if override_obj:
        limits = {
            "daily_tokens": override_obj.daily_tokens,
            "requests_per_hour": override_obj.requests_per_hour,
            "max_tokens_per_request": override_obj.max_tokens_per_request,
        }
        return PersonalQuotaResponse(
            role=user.role,
            limits=limits,
            current={"tokens_used_today": tokens_today, "requests_this_hour": reqs_hour},
            has_override=True,
            override_details=limits,
        )

    return PersonalQuotaResponse(
        role=user.role,
        limits=base_limits,
        current={"tokens_used_today": tokens_today, "requests_this_hour": reqs_hour},
    )


@router.put("/admin/user/{roll_number}", response_model=QuotaOverrideResponse)
async def set_quota_override(
    roll_number: str,
    body: QuotaOverrideRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Override quota for a specific user (admin-only)."""
    user = await auth_service.get_user_by_roll(db, roll_number)
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    # Upsert override
    result = await db.execute(select(QuotaOverride).where(QuotaOverride.user_id == user.id))
    override = result.scalar_one_or_none()

    if override:
        override.daily_tokens = body.daily_tokens
        override.requests_per_hour = body.requests_per_hour
        override.max_tokens_per_request = body.max_tokens_per_request
        override.reason = body.reason
    else:
        override = QuotaOverride(
            user_id=user.id,
            daily_tokens=body.daily_tokens,
            requests_per_hour=body.requests_per_hour,
            max_tokens_per_request=body.max_tokens_per_request,
            reason=body.reason,
            created_by=admin.id,
        )
        db.add(override)

    await db.flush()
    return QuotaOverrideResponse(
        roll_number=roll_number,
        daily_tokens=body.daily_tokens,
        requests_per_hour=body.requests_per_hour,
        max_tokens_per_request=body.max_tokens_per_request,
        reason=body.reason,
    )


@router.get("/admin/exceeded", response_model=ExceededUsersResponse)
async def exceeded_users(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """List users who exceeded their daily token quota (admin-only)."""
    from sqlalchemy import func
    from mac.models.user import UsageLog

    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    result = await db.execute(
        select(
            User.roll_number,
            User.name,
            User.department,
            User.role,
            func.coalesce(func.sum(UsageLog.tokens_in + UsageLog.tokens_out), 0).label("tokens_used"),
        )
        .join(UsageLog, UsageLog.user_id == User.id)
        .where(UsageLog.created_at >= today)
        .group_by(User.id, User.roll_number, User.name, User.department, User.role)
    )

    exceeded = []
    for row in result:
        daily_limit = ROLE_LIMITS.get(row.role, ROLE_LIMITS["student"])["daily_tokens"]
        tokens_used = int(row.tokens_used)
        if tokens_used > daily_limit:
            exceeded.append(ExceededUserInfo(
                roll_number=row.roll_number,
                name=row.name,
                department=row.department,
                tokens_used=tokens_used,
                daily_limit=daily_limit,
                exceeded_by=tokens_used - daily_limit,
            ))

    return ExceededUsersResponse(users=exceeded, total=len(exceeded))
