"""Usage tracking service — log requests, query stats."""

from datetime import datetime, timezone, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from mac.models.user import UsageLog, User
from mac.config import settings


def _today_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _hour_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(minute=0, second=0, microsecond=0)


async def log_request(
    db: AsyncSession,
    user_id: str,
    model: str,
    endpoint: str,
    tokens_in: int,
    tokens_out: int,
    latency_ms: int,
    status_code: int,
    request_id: str,
):
    """Log an API request for usage tracking."""
    log = UsageLog(
        user_id=user_id,
        model=model,
        endpoint=endpoint,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        status_code=status_code,
        request_id=request_id,
    )
    db.add(log)
    await db.flush()


async def get_tokens_used_today(db: AsyncSession, user_id: str) -> int:
    """Total tokens used today by a user."""
    result = await db.execute(
        select(func.coalesce(func.sum(UsageLog.tokens_in + UsageLog.tokens_out), 0)).where(
            UsageLog.user_id == user_id,
            UsageLog.created_at >= _today_start(),
        )
    )
    return result.scalar_one()


async def get_requests_this_hour(db: AsyncSession, user_id: str) -> int:
    """Total requests this hour by a user."""
    result = await db.execute(
        select(func.count()).where(
            UsageLog.user_id == user_id,
            UsageLog.created_at >= _hour_start(),
        )
    )
    return result.scalar_one()


async def get_my_usage(db: AsyncSession, user_id: str) -> dict:
    """Get usage breakdown for current user."""
    today = _today_start()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    # Today's usage
    today_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageLog.tokens_in), 0),
            func.coalesce(func.sum(UsageLog.tokens_out), 0),
            func.count(),
        ).where(UsageLog.user_id == user_id, UsageLog.created_at >= today)
    )
    t_in, t_out, t_count = today_result.one()

    # By model today
    model_result = await db.execute(
        select(
            UsageLog.model,
            func.sum(UsageLog.tokens_in + UsageLog.tokens_out),
            func.count(),
        ).where(
            UsageLog.user_id == user_id, UsageLog.created_at >= today
        ).group_by(UsageLog.model)
    )
    by_model = {row[0]: {"tokens": int(row[1]), "requests": row[2]} for row in model_result}

    # Week
    week_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageLog.tokens_in + UsageLog.tokens_out), 0),
            func.count(),
        ).where(UsageLog.user_id == user_id, UsageLog.created_at >= week_start)
    )
    w_tokens, w_count = week_result.one()

    # Month
    month_result = await db.execute(
        select(
            func.coalesce(func.sum(UsageLog.tokens_in + UsageLog.tokens_out), 0),
            func.count(),
        ).where(UsageLog.user_id == user_id, UsageLog.created_at >= month_start)
    )
    m_tokens, m_count = month_result.one()

    return {
        "today": {
            "total_tokens": int(t_in + t_out),
            "prompt_tokens": int(t_in),
            "completion_tokens": int(t_out),
            "requests": t_count,
            "by_model": by_model,
        },
        "this_week": {"total_tokens": int(w_tokens), "requests": w_count},
        "this_month": {"total_tokens": int(m_tokens), "requests": m_count},
    }


async def get_request_history(
    db: AsyncSession, user_id: str, page: int = 1, per_page: int = 50,
    model: str | None = None, date_from: str | None = None, date_to: str | None = None,
) -> tuple[list, int]:
    """Paginated request history."""
    query = select(UsageLog).where(UsageLog.user_id == user_id)

    if model:
        query = query.where(UsageLog.model == model)
    if date_from:
        query = query.where(UsageLog.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.where(UsageLog.created_at <= datetime.fromisoformat(date_to + "T23:59:59+00:00"))

    # Count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar_one()

    # Paginate
    query = query.order_by(UsageLog.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)

    return list(result.scalars()), total


async def get_all_users_usage(db: AsyncSession, page: int = 1, per_page: int = 50, department: str | None = None) -> tuple[list, int]:
    """Admin: all users usage summary."""
    today = _today_start()
    query = select(User)
    if department:
        query = query.where(User.department == department)

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar_one()

    query = query.offset((page - 1) * per_page).limit(per_page)
    users = (await db.execute(query)).scalars().all()

    result = []
    for user in users:
        tokens_result = await db.execute(
            select(func.coalesce(func.sum(UsageLog.tokens_in + UsageLog.tokens_out), 0), func.count()).where(
                UsageLog.user_id == user.id, UsageLog.created_at >= today
            )
        )
        tokens, reqs = tokens_result.one()

        last_log = await db.execute(
            select(UsageLog.created_at).where(UsageLog.user_id == user.id).order_by(UsageLog.created_at.desc()).limit(1)
        )
        last_active = last_log.scalar_one_or_none()

        result.append({
            "roll_number": user.roll_number,
            "name": user.name,
            "department": user.department,
            "tokens_today": int(tokens),
            "requests_today": reqs,
            "quota_used_pct": round(int(tokens) / settings.rate_limit_tokens_per_day * 100, 1) if settings.rate_limit_tokens_per_day else 0,
            "last_active": last_active.isoformat() if last_active else None,
        })

    return result, total
