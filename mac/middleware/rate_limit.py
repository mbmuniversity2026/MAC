"""Rate limiting — in-memory (Redis optional upgrade path)."""

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user
from mac.models.user import User
from mac.services.usage_service import get_tokens_used_today, get_requests_this_hour
from mac.config import settings


async def check_rate_limit(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Check that the user hasn't exceeded hourly request or daily token limits.
    Injects X-RateLimit-* headers on the response.

    ADMIN RULE: Admin users are exempt from ALL rate limits — unlimited access forever.
    """
    # Admin: zero quota, zero rate limits, unlimited everything.
    if user.role == "admin":
        request.state.rate_limit_headers = {
            "X-RateLimit-Limit": "unlimited",
            "X-RateLimit-Remaining": "unlimited",
            "X-RateLimit-Used": "0",
            "X-TokenLimit-Limit": "unlimited",
            "X-TokenLimit-Remaining": "unlimited",
            "X-TokenLimit-Used": "0",
        }
        return user

    reqs = await get_requests_this_hour(db, user.id)
    tokens = await get_tokens_used_today(db, user.id)

    req_limit = settings.rate_limit_requests_per_hour
    token_limit = settings.rate_limit_tokens_per_day

    request.state.rate_limit_headers = {
        "X-RateLimit-Limit": str(req_limit),
        "X-RateLimit-Remaining": str(max(0, req_limit - reqs)),
        "X-RateLimit-Used": str(reqs),
        "X-TokenLimit-Limit": str(token_limit),
        "X-TokenLimit-Remaining": str(max(0, token_limit - tokens)),
        "X-TokenLimit-Used": str(tokens),
    }

    if reqs >= req_limit:
        raise HTTPException(status_code=429, detail={
            "code": "rate_limit_exceeded",
            "message": f"Hourly request limit ({req_limit}) exceeded. Try again next hour.",
        })

    if tokens >= token_limit:
        raise HTTPException(status_code=429, detail={
            "code": "rate_limit_exceeded",
            "message": f"Daily token limit ({token_limit}) exceeded. Resets at midnight UTC.",
        })

    return user
