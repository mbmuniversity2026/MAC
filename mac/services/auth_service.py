"""Authentication service — login, logout, refresh, signup, user CRUD."""

import asyncio
from datetime import datetime, date, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from mac.models.user import User, RefreshToken, StudentRegistry
from mac.utils.security import (
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    hash_token,
)
from mac.config import settings


# ── Async-safe wrappers for CPU-bound bcrypt ──────────────

async def _hash_password(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)

async def _verify_password(plain: str, hashed: str) -> bool:
    return await asyncio.to_thread(verify_password, plain, hashed)


# ── Lookup helpers ────────────────────────────────────────

async def get_user_by_roll(db: AsyncSession, roll_number: str) -> User | None:
    result = await db.execute(select(User).where(User.roll_number == roll_number))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_api_key(db: AsyncSession, api_key: str) -> User | None:
    result = await db.execute(select(User).where(User.api_key == api_key))
    return result.scalar_one_or_none()


async def get_registry_entry(db: AsyncSession, roll_number: str) -> StudentRegistry | None:
    result = await db.execute(
        select(StudentRegistry).where(StudentRegistry.roll_number == roll_number)
    )
    entry = result.scalar_one_or_none()
    if entry:
        return entry
    result2 = await db.execute(
        select(StudentRegistry).where(StudentRegistry.registration_number == roll_number)
    )
    return result2.scalar_one_or_none()


# ── Authentication ────────────────────────────────────────

async def authenticate_user(db: AsyncSession, roll_number: str, password: str) -> User | None:
    """Validate credentials. Returns user or None. Handles lockout."""
    user = await get_user_by_roll(db, roll_number)
    if not user:
        return None

    # Check lockout
    if user.locked_until:
        lock_time = user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) < lock_time:
            return None

    # Clear expired lockout
    if user.locked_until:
        lock_time = user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= lock_time:
            user.locked_until = None
            user.failed_login_attempts = 0

    if not await _verify_password(password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= 5:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
        await db.flush()
        return None

    # Success — reset failure counter
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.flush()
    return user


# ── Signup with DOB verification ──────────────────────────

async def signup_with_dob(db: AsyncSession, roll_number: str, dob_str: str) -> tuple[User | None, str]:
    """Verify roll_number + DOB against StudentRegistry, create User.
    Returns (user, error_message). user is None on failure.
    The initial password is set to the DOB string (DD-MM-YYYY) so the
    first login works, but must_change_password is True.
    """
    # Already registered?
    existing = await get_user_by_roll(db, roll_number)
    if existing:
        return None, "This roll number is already registered. Please sign in."

    entry = await get_registry_entry(db, roll_number)
    if not entry:
        return None, "Roll number not found in college records. Contact admin."

    # Parse DOB — accept DD-MM-YYYY
    try:
        parts = dob_str.strip().split("-")
        parsed_dob = date(int(parts[2]), int(parts[1]), int(parts[0]))
    except (ValueError, IndexError):
        return None, "Invalid date format. Use DD-MM-YYYY."

    if entry.dob != parsed_dob:
        return None, "Date of birth does not match college records."

    # Create user with DOB as temp password
    user = User(
        roll_number=entry.roll_number,
        name=entry.name,
        password_hash=await _hash_password(dob_str),
        department=entry.department,
        role="student",
        must_change_password=True,
    )
    db.add(user)
    await db.flush()
    return user, ""


# ── Tokens ────────────────────────────────────────────────

async def create_tokens(db: AsyncSession, user: User) -> tuple[str, str]:
    """Create access + refresh token pair."""
    access_token = create_access_token({"sub": user.id, "roll": user.roll_number, "role": user.role})
    refresh_raw = create_refresh_token()

    rt = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_token_expire_days),
    )
    db.add(rt)
    await db.flush()

    return access_token, refresh_raw


async def refresh_access_token(db: AsyncSession, refresh_raw: str) -> tuple[str, User] | None:
    """Validate refresh token and return new access token."""
    token_hash = hash_token(refresh_raw)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        return None
    expires = rt.expires_at if rt.expires_at.tzinfo else rt.expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        rt.revoked = True
        await db.flush()
        return None

    user = await get_user_by_id(db, rt.user_id)
    if not user or not user.is_active:
        return None

    access_token = create_access_token({"sub": user.id, "roll": user.roll_number, "role": user.role})
    return access_token, user


async def revoke_refresh_tokens(db: AsyncSession, user_id: str):
    """Revoke all refresh tokens for a user (logout)."""
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked == False)
    )
    for rt in result.scalars():
        rt.revoked = True
    await db.flush()


# ── Password management ──────────────────────────────────

async def change_password(db: AsyncSession, user: User, old_password: str, new_password: str) -> bool:
    """Change user password. Returns False if old_password doesn't match."""
    if not await _verify_password(old_password, user.password_hash):
        return False
    user.password_hash = await _hash_password(new_password)
    user.must_change_password = False
    await db.flush()
    return True


async def force_set_password(db: AsyncSession, user: User, new_password: str):
    """Set password without verifying old one (first‑time setup)."""
    user.password_hash = await _hash_password(new_password)
    user.must_change_password = False
    await db.flush()


# ── User CRUD ─────────────────────────────────────────────

async def create_user(
    db: AsyncSession,
    roll_number: str,
    name: str,
    password: str,
    department: str = "CSE",
    role: str = "student",
    must_change_password: bool = False,
    email: str | None = None,
) -> User:
    """Create a new user account."""
    user = User(
        roll_number=roll_number,
        name=name,
        password_hash=await _hash_password(password),
        department=department,
        role=role,
        must_change_password=must_change_password,
        email=email,
    )
    db.add(user)
    await db.flush()
    return user
