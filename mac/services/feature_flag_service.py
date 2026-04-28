"""Feature flag service — DB-backed flags with Redis cache and pub/sub.

Pattern: read-through cache. `get_all_flags()` returns the cached dict if
present (TTL 30s); otherwise hydrates from DB. `set_flag()` writes to DB,
invalidates cache, and publishes an update on `mac:features:updates` so
SSE subscribers can broadcast immediately.

Falls back to direct DB reads if Redis is unreachable — the platform must
keep working without Redis (esp. in dev / single-machine setups).
"""

import json
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mac.config import settings
from mac.models.feature_flag import FeatureFlag

log = logging.getLogger(__name__)

CACHE_KEY = "mac:features"
PUBSUB_CHANNEL = "mac:features:updates"
CACHE_TTL_SECONDS = 30

_redis_client = None
_redis_failed = False


def _get_redis():
    """Lazy Redis client; returns None if unavailable. Never raises."""
    global _redis_client, _redis_failed
    if _redis_failed:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        import redis.asyncio as redis_async
        _redis_client = redis_async.from_url(settings.redis_url, decode_responses=True)
        return _redis_client
    except Exception as e:  # noqa: BLE001
        log.warning("Redis unavailable for feature flag cache: %s", e)
        _redis_failed = True
        return None


def _flag_to_dict(f: FeatureFlag) -> dict:
    return {
        "key": f.key,
        "label": f.label,
        "description": f.description,
        "enabled": f.enabled,
        "allowed_roles": f.allowed_roles or [],
    }


async def _read_cache() -> Optional[dict]:
    r = _get_redis()
    if not r:
        return None
    try:
        raw = await r.get(CACHE_KEY)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


async def _write_cache(payload: dict) -> None:
    r = _get_redis()
    if not r:
        return
    try:
        await r.setex(CACHE_KEY, CACHE_TTL_SECONDS, json.dumps(payload))
    except Exception:  # noqa: BLE001
        pass


async def _invalidate_cache() -> None:
    r = _get_redis()
    if not r:
        return
    try:
        await r.delete(CACHE_KEY)
    except Exception:  # noqa: BLE001
        pass


async def _publish_update(key: str, payload: dict) -> None:
    r = _get_redis()
    if not r:
        return
    try:
        await r.publish(PUBSUB_CHANNEL, json.dumps({"key": key, "flag": payload}))
    except Exception:  # noqa: BLE001
        pass


async def get_all_flags(db: AsyncSession) -> dict[str, dict]:
    """Return {key: flag_dict} for all flags. Cached."""
    cached = await _read_cache()
    if cached is not None:
        return cached
    result = await db.execute(select(FeatureFlag))
    flags = result.scalars().all()
    payload = {f.key: _flag_to_dict(f) for f in flags}
    await _write_cache(payload)
    return payload


async def get_flag(db: AsyncSession, key: str) -> Optional[FeatureFlag]:
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))
    return result.scalar_one_or_none()


async def is_enabled(db: AsyncSession, key: str, role: str) -> bool:
    """True iff the flag is on AND the given role is in allowed_roles.
    Unknown flags are treated as disabled (fail-closed)."""
    flags = await get_all_flags(db)
    flag = flags.get(key)
    if not flag:
        return False
    if not flag.get("enabled", False):
        return False
    allowed = flag.get("allowed_roles") or []
    return role in allowed


async def set_flag(
    db: AsyncSession,
    key: str,
    enabled: Optional[bool] = None,
    allowed_roles: Optional[list[str]] = None,
    actor_id: Optional[str] = None,
) -> Optional[FeatureFlag]:
    flag = await get_flag(db, key)
    if not flag:
        return None
    if enabled is not None:
        flag.enabled = enabled
    if allowed_roles is not None:
        flag.allowed_roles = list(allowed_roles)
    if actor_id is not None:
        flag.updated_by = actor_id
    await db.flush()
    await _invalidate_cache()
    await _publish_update(key, _flag_to_dict(flag))
    return flag


async def subscribe_updates():
    """Async generator yielding update payloads from Redis pub/sub.
    Yields dicts: {"key": str, "flag": {...}}.
    Yields nothing (closes immediately) if Redis unavailable.
    """
    r = _get_redis()
    if not r:
        return
    pubsub = r.pubsub()
    await pubsub.subscribe(PUBSUB_CHANNEL)
    try:
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            try:
                yield json.loads(msg["data"])
            except Exception:  # noqa: BLE001
                continue
    finally:
        try:
            await pubsub.unsubscribe(PUBSUB_CHANNEL)
            await pubsub.close()
        except Exception:  # noqa: BLE001
            pass
