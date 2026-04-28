"""Scoped API key service — advanced key management with per-key limits and scoping."""

import secrets
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from mac.models.notification import ScopedApiKey


def _utcnow():
    return datetime.now(timezone.utc)


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def create_scoped_key(
    db: AsyncSession,
    user_id: str,
    name: str,
    allowed_models: Optional[list[str]] = None,
    allowed_endpoints: Optional[list[str]] = None,
    requests_per_hour: int = 100,
    tokens_per_day: int = 50000,
    max_tokens_per_request: int = 4096,
    expires_in_days: Optional[int] = None,
) -> tuple[str, ScopedApiKey]:
    """Create a new scoped API key. Returns (plain_key, db_record)."""
    plain_key = f"mac_sk_{secrets.token_hex(32)}"
    key_prefix = plain_key[:12]

    expires_at = None
    if expires_in_days:
        expires_at = _utcnow() + timedelta(days=expires_in_days)

    key = ScopedApiKey(
        user_id=user_id,
        name=name,
        key_prefix=key_prefix,
        key_hash=_hash_key(plain_key),
        allowed_models=json.dumps(allowed_models) if allowed_models else None,
        allowed_endpoints=json.dumps(allowed_endpoints) if allowed_endpoints else None,
        requests_per_hour=requests_per_hour,
        tokens_per_day=tokens_per_day,
        max_tokens_per_request=max_tokens_per_request,
        expires_at=expires_at,
    )
    db.add(key)
    await db.flush()
    return plain_key, key


async def get_key_by_hash(db: AsyncSession, plain_key: str) -> Optional[ScopedApiKey]:
    """Look up a scoped key by its plaintext value (hashed for comparison)."""
    key_hash = _hash_key(plain_key)
    result = await db.execute(
        select(ScopedApiKey).where(
            ScopedApiKey.key_hash == key_hash,
            ScopedApiKey.is_active == True,
        )
    )
    key = result.scalar_one_or_none()
    if key and key.expires_at and key.expires_at < _utcnow():
        return None  # Expired
    return key


async def get_user_keys(db: AsyncSession, user_id: str) -> list[ScopedApiKey]:
    result = await db.execute(
        select(ScopedApiKey)
        .where(ScopedApiKey.user_id == user_id)
        .order_by(ScopedApiKey.created_at.desc())
    )
    return list(result.scalars().all())


async def get_all_keys(db: AsyncSession, page: int = 1, per_page: int = 50) -> tuple[list[ScopedApiKey], int]:
    count = (await db.execute(
        select(func.count(ScopedApiKey.id))
    )).scalar() or 0
    result = await db.execute(
        select(ScopedApiKey)
        .order_by(ScopedApiKey.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), count


async def revoke_key(db: AsyncSession, key_id: str, revoked_by: str) -> bool:
    stmt = (
        update(ScopedApiKey)
        .where(ScopedApiKey.id == key_id)
        .values(is_active=False, revoked_at=_utcnow(), revoked_by=revoked_by)
    )
    result = await db.execute(stmt)
    return result.rowcount > 0


async def update_key_usage(db: AsyncSession, key_id: str, tokens_used: int = 0) -> None:
    """Update last_used_at and increment counters."""
    stmt = (
        update(ScopedApiKey)
        .where(ScopedApiKey.id == key_id)
        .values(
            last_used_at=_utcnow(),
            total_requests=ScopedApiKey.total_requests + 1,
            total_tokens=ScopedApiKey.total_tokens + tokens_used,
        )
    )
    await db.execute(stmt)


def check_key_scope(key: ScopedApiKey, model_id: Optional[str] = None, endpoint: Optional[str] = None) -> tuple[bool, str]:
    """Check if a request is within the key's scope. Returns (allowed, reason)."""
    if not key.is_active:
        return False, "Key is revoked"
    if key.expires_at and key.expires_at < _utcnow():
        return False, "Key has expired"

    if model_id and key.allowed_models:
        allowed = json.loads(key.allowed_models)
        if model_id not in allowed and model_id != "auto":
            return False, f"Model '{model_id}' not allowed for this key"

    if endpoint and key.allowed_endpoints:
        allowed = json.loads(key.allowed_endpoints)
        if not any(endpoint.startswith(e) for e in allowed):
            return False, f"Endpoint '{endpoint}' not allowed for this key"

    return True, "ok"
