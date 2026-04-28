"""Auth dependency — extracts user from JWT, API key, or scoped API key."""

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.utils.security import decode_access_token
from mac.services.auth_service import get_user_by_id, get_user_by_api_key
from mac.models.user import User

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate the current user from Authorization header.
    Supports JWT access tokens, legacy API keys (mac_sk_live_xxx),
    and scoped API keys (mac_sk_xxx).
    """
    token = credentials.credentials

    # Check if it's a legacy API key
    if token.startswith("mac_sk_live_"):
        user = await get_user_by_api_key(db, token)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail={
                "code": "authentication_failed",
                "message": "Invalid or inactive API key",
            })
        return user

    # Check if it's a scoped API key (mac_sk_ but not mac_sk_live_)
    if token.startswith("mac_sk_"):
        from mac.services.scoped_key_service import get_key_by_hash
        scoped_key = await get_key_by_hash(db, token)
        if not scoped_key:
            raise HTTPException(status_code=401, detail={
                "code": "authentication_failed",
                "message": "Invalid, expired, or revoked API key",
            })
        user = await get_user_by_id(db, scoped_key.user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail={
                "code": "authentication_failed",
                "message": "User not found or inactive",
            })
        # Attach scoped key info to request state for downstream checks
        user._scoped_key = scoped_key
        return user

    # Otherwise treat as JWT
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail={
            "code": "authentication_failed",
            "message": "Invalid or expired access token",
        })

    # Check blacklist (handles logout)
    jti = payload.get("jti")
    if jti:
        from mac.services.token_blacklist_service import is_blacklisted
        if await is_blacklisted(jti):
            raise HTTPException(status_code=401, detail={
                "code": "token_revoked",
                "message": "Token has been revoked. Please log in again.",
            })

    user = await get_user_by_id(db, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail={
            "code": "authentication_failed",
            "message": "User not found or inactive",
        })

    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Admin access required",
        })
    return user


async def require_faculty_or_admin(user: User = Depends(get_current_user)) -> User:
    """Require faculty or admin role."""
    if user.role not in ("faculty", "admin"):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Faculty or admin access required",
        })
    return user
