"""Usage endpoints — /usage — track token consumption."""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.schemas.usage import (
    MyUsageResponse, QuotaStatus, HistoryResponse, RequestHistoryItem,
    QuotaResponse, AdminAllUsageResponse, AdminUserUsage, AdminModelsResponse,
)
from mac.services import usage_service, auth_service
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User
from mac.config import settings

router = APIRouter(prefix="/usage", tags=["Usage"])


@router.get("/me", response_model=MyUsageResponse)
async def my_usage(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """My token usage — today, this week, this month, by model."""
    usage = await usage_service.get_my_usage(db, user.id)
    tokens_today = usage["today"]["total_tokens"]

    tomorrow = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    from datetime import timedelta
    tomorrow += timedelta(days=1)

    return MyUsageResponse(
        roll_number=user.roll_number,
        usage=usage,
        quota=QuotaStatus(
            daily_limit=settings.rate_limit_tokens_per_day,
            remaining_today=max(0, settings.rate_limit_tokens_per_day - tokens_today),
            resets_at=tomorrow.isoformat(),
        ),
    )


@router.get("/me/history", response_model=HistoryResponse)
async def my_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    model: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Paginated request history."""
    logs, total = await usage_service.get_request_history(db, user.id, page, per_page, model, date_from, date_to)

    return HistoryResponse(
        requests=[RequestHistoryItem(
            id=log.request_id,
            model=log.model,
            endpoint=log.endpoint,
            tokens_in=log.tokens_in,
            tokens_out=log.tokens_out,
            latency_ms=log.latency_ms,
            status_code=log.status_code,
            created_at=log.created_at.isoformat(),
        ) for log in logs],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/me/quota", response_model=QuotaResponse)
async def my_quota(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """My quota limits and remaining balance."""
    tokens_today = await usage_service.get_tokens_used_today(db, user.id)
    reqs_hour = await usage_service.get_requests_this_hour(db, user.id)

    now = datetime.now(timezone.utc)
    from datetime import timedelta
    next_hour = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)

    return QuotaResponse(
        role=user.role,
        limits={
            "daily_tokens": settings.rate_limit_tokens_per_day,
            "requests_per_hour": settings.rate_limit_requests_per_hour,
            "max_tokens_per_request": 4096 if user.role == "student" else 8192,
        },
        current={
            "tokens_used_today": tokens_today,
            "requests_this_hour": reqs_hour,
            "remaining_tokens": max(0, settings.rate_limit_tokens_per_day - tokens_today),
            "remaining_requests": max(0, settings.rate_limit_requests_per_hour - reqs_hour),
        },
        resets={
            "daily_reset": tomorrow.isoformat(),
            "hourly_reset": next_hour.isoformat(),
        },
    )


# ── Admin Endpoints ──────────────────────────────────────

@router.get("/admin/all", response_model=AdminAllUsageResponse)
async def admin_all_usage(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    department: str | None = Query(None),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """All users usage summary (admin only)."""
    users, total = await usage_service.get_all_users_usage(db, page, per_page, department)
    return AdminAllUsageResponse(
        users=[AdminUserUsage(**u) for u in users],
        total_users=total,
        page=page,
    )


@router.get("/admin/user/{roll_number}")
async def admin_user_usage(
    roll_number: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Specific student's usage (admin only)."""
    user = await auth_service.get_user_by_roll(db, roll_number)
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})
    usage = await usage_service.get_my_usage(db, user.id)
    return {"roll_number": user.roll_number, "name": user.name, "department": user.department, "usage": usage}


@router.get("/admin/models", response_model=AdminModelsResponse)
async def admin_models_usage(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Per-model usage stats (admin only)."""
    from sqlalchemy import select, func
    from mac.models.user import UsageLog
    from mac.services.usage_service import _today_start

    today = _today_start()
    result = await db.execute(
        select(
            UsageLog.model,
            func.count(),
            func.coalesce(func.sum(UsageLog.tokens_in + UsageLog.tokens_out), 0),
            func.coalesce(func.avg(UsageLog.latency_ms), 0),
            func.count(func.distinct(UsageLog.user_id)),
        ).where(UsageLog.created_at >= today).group_by(UsageLog.model)
    )

    from mac.schemas.usage import AdminModelUsage
    models = []
    for row in result:
        models.append(AdminModelUsage(
            model_id=row[0],
            requests_today=row[1],
            tokens_today=int(row[2]),
            avg_latency_ms=int(row[3]),
            unique_users_today=row[4],
        ))

    return AdminModelsResponse(models=models)
