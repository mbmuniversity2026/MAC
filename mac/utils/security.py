"""Security utilities — password hashing, JWT tokens, API keys."""

import secrets
from datetime import datetime, timedelta, timezone
import bcrypt
from jose import jwt, JWTError
from mac.config import settings


# ── Passwords ─────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ── JWT ───────────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    jti = secrets.token_hex(16)
    to_encode.update({"exp": expire, "type": "access", "jti": jti})
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            return None
        return payload
    except JWTError:
        return None


# ── API Keys ─────────────────────────────────────────────

def generate_api_key() -> str:
    return f"mac_sk_live_{secrets.token_hex(24)}"


def hash_token(token: str) -> str:
    """Hash a refresh token or API key for storage."""
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()


# ── Request IDs ──────────────────────────────────────────

def generate_request_id(prefix: str = "mac") -> str:
    return f"{prefix}-{secrets.token_hex(4)}"
