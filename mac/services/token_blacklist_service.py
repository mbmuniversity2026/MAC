"""JWT blacklist — stores revoked JTIs in Redis with TTL matching token expiry.
Falls back to an in-process set when Redis is unavailable (single-instance only).
"""

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

_fallback: set[str] = set()


def _redis():
    try:
        from mac.database import redis_client
        return redis_client
    except Exception:
        return None


async def blacklist(jti: str, expires_at: datetime) -> None:
    """Add a JTI to the blacklist. TTL = seconds until expiry."""
    ttl = max(1, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
    r = _redis()
    if r:
        try:
            await r.setex(f"mac:bl:{jti}", ttl, "1")
            return
        except Exception as e:
            log.warning("Redis blacklist write failed: %s", e)
    _fallback.add(jti)


async def is_blacklisted(jti: str) -> bool:
    r = _redis()
    if r:
        try:
            return await r.exists(f"mac:bl:{jti}") == 1
        except Exception as e:
            log.warning("Redis blacklist read failed: %s", e)
    return jti in _fallback
