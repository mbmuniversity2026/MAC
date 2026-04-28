"""Tests for /features endpoints."""

import pytest
import pytest_asyncio
from mac.database import async_session
from mac.services import feature_seeder


@pytest_asyncio.fixture
async def seeded_flags():
    async with async_session() as db:
        await feature_seeder.seed_default_flags(db)
        await db.commit()
    yield


async def test_features_status_returns_seeded_flags(client, seeded_flags):
    resp = await client.get("/api/v1/features/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "flags" in data and "roles" in data
    assert "ai_chat" in data["flags"]
    assert data["flags"]["ai_chat"] is True
    assert "student" in data["roles"]["ai_chat"]


async def test_features_status_empty_when_unseeded(client):
    resp = await client.get("/api/v1/features/status")
    assert resp.status_code == 200
    assert resp.json() == {"flags": {}, "roles": {}}


async def test_admin_can_disable_flag(client, admin_headers, seeded_flags):
    resp = await client.patch(
        "/api/v1/admin/features/ai_chat",
        json={"enabled": False},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False

    status = await client.get("/api/v1/features/status")
    assert status.json()["flags"]["ai_chat"] is False


async def test_student_cannot_toggle_flag(client, auth_headers, seeded_flags):
    resp = await client.patch(
        "/api/v1/admin/features/ai_chat",
        json={"enabled": False},
        headers=auth_headers,
    )
    assert resp.status_code == 403


async def test_admin_patch_unknown_flag_returns_404(client, admin_headers, seeded_flags):
    resp = await client.patch(
        "/api/v1/admin/features/this_flag_does_not_exist",
        json={"enabled": True},
        headers=admin_headers,
    )
    assert resp.status_code == 404
