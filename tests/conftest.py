"""Test configuration and fixtures."""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from mac.main import app
from mac.database import engine, Base, async_session
from mac.services.auth_service import create_user

# Import all models so Base.metadata knows about them
import mac.models.user  # noqa: F401
import mac.models.guardrail  # noqa: F401
import mac.models.quota  # noqa: F401
import mac.models.rag  # noqa: F401
import mac.models.node  # noqa: F401
import mac.models.model_submission  # noqa: F401
import mac.models.agent  # noqa: F401
import mac.models.notebook  # noqa: F401
import mac.models.notification  # noqa: F401
import mac.models.attendance  # noqa: F401
import mac.models.doubt  # noqa: F401
import mac.models.copy_check  # noqa: F401
# Session 1
import mac.models.feature_flag  # noqa: F401
import mac.models.academic  # noqa: F401
import mac.models.cluster  # noqa: F401
import mac.models.file_share  # noqa: F401
import mac.models.video  # noqa: F401
import mac.models.system_config  # noqa: F401


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create fresh tables for each test."""
    # Reset pooled asyncpg connections between tests so they don't outlive
    # pytest's per-test event loop lifecycle on Windows.
    await engine.dispose()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    """Async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def test_user():
    """Create a test user and return (user, password)."""
    async with async_session() as db:
        user = await create_user(db, "21CS045", "Test Student", "password123", "CSE", "student")
        await db.commit()
        return user, "password123"


@pytest_asyncio.fixture
async def admin_user():
    """Create an admin user."""
    async with async_session() as db:
        user = await create_user(db, "ADMIN001", "Admin", "admin12345", "CSE", "admin")
        await db.commit()
        return user, "admin12345"


@pytest_asyncio.fixture
async def auth_headers(client, test_user):
    """Login and return auth headers."""
    user, password = test_user
    resp = await client.post("/api/v1/auth/login", json={
        "roll_number": user.roll_number,
        "password": password,
    })
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def admin_headers(client, admin_user):
    """Login as admin and return auth headers."""
    user, password = admin_user
    resp = await client.post("/api/v1/auth/login", json={
        "roll_number": user.roll_number,
        "password": password,
    })
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
