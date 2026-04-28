"""Feature flag enforcement dependency.

Use as `Depends(feature_required("ai_chat"))` on endpoints. Returns 403 with
`{"code": "feature_disabled", "feature": <key>}` when the flag is off OR the
caller's role is not in `allowed_roles`.

Mirrors the require_admin pattern so behavior is consistent across the codebase.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user
from mac.models.user import User
from mac.services import feature_flag_service


def feature_required(feature_key: str):
    """Dependency factory. Returns a dependency that ensures the flag is enabled
    for the calling user's role."""
    async def _check(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if not await feature_flag_service.is_enabled(db, feature_key, user.role):
            raise HTTPException(status_code=403, detail={
                "code": "feature_disabled",
                "message": f"Feature '{feature_key}' is not available",
                "feature": feature_key,
            })
        return user
    return _check
