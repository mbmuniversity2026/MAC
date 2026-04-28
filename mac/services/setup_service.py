"""First-boot setup service.

Detects whether the platform has been initialized (any admin exists),
creates the founder admin account, and persists a randomly-generated
JWT secret in `system_config` so it survives restarts independently of
the .env file.
"""

import asyncio
import logging
import secrets
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from mac.config import settings
from mac.models.user import User
from mac.models.system_config import SystemConfig
from mac.utils.security import hash_password, create_access_token

log = logging.getLogger(__name__)

JWT_SECRET_KEY = "jwt_secret"


async def is_first_run(db: AsyncSession) -> bool:
    """True iff there are no admin users yet."""
    result = await db.execute(
        select(func.count()).select_from(User).where(User.role == "admin")
    )
    return (result.scalar() or 0) == 0


async def get_or_generate_jwt_secret(db: AsyncSession) -> str:
    """Read the JWT secret from system_config; generate + persist if missing.
    Returns the secret string. Once written, settings.jwt_secret_key is also
    updated in-process so utils/security.py picks it up immediately.
    """
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == JWT_SECRET_KEY))
    row = result.scalar_one_or_none()
    if row and row.value:
        settings.jwt_secret_key = row.value
        return row.value
    new_secret = secrets.token_urlsafe(64)
    db.add(SystemConfig(key=JWT_SECRET_KEY, value=new_secret))
    await db.flush()
    settings.jwt_secret_key = new_secret
    return new_secret


async def has_jwt_secret(db: AsyncSession) -> bool:
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == JWT_SECRET_KEY))
    row = result.scalar_one_or_none()
    return bool(row and row.value)


async def create_founder_admin(
    db: AsyncSession,
    name: str,
    email: str,
    password: str,
) -> tuple[Optional[User], Optional[str], Optional[str]]:
    """Create the single founder admin. Returns (user, access_token, error).
    Refuses if an admin already exists."""
    if not await is_first_run(db):
        return (None, None, "An admin already exists. Setup is closed.")

    # Idempotency: if a user with this email/roll already exists, refuse — admin
    # would already block setup, but a non-admin user with the same email is bad.
    result = await db.execute(select(User).where(User.roll_number == email))
    if result.scalar_one_or_none():
        return (None, None, "A user with this email already exists.")

    await get_or_generate_jwt_secret(db)

    pwd_hash = await asyncio.to_thread(hash_password, password)
    user = User(
        roll_number=email,
        name=name,
        email=email,
        department="ADMIN",
        role="admin",
        password_hash=pwd_hash,
        must_change_password=False,
        is_active=True,
        is_founder=True,
        can_create_users=True,
    )
    db.add(user)
    await db.flush()
    token = create_access_token({"sub": user.id, "role": user.role})
    return (user, token, None)
