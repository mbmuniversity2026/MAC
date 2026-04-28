"""Tests for /quota endpoints (Phase 4)."""

import pytest


@pytest.mark.asyncio
async def test_quota_limits(client, auth_headers):
    resp = await client.get("/api/v1/quota/limits", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "roles" in data
    assert "student" in data["roles"]
    assert "faculty" in data["roles"]
    assert "admin" in data["roles"]
    assert "daily_tokens" in data["roles"]["student"]


@pytest.mark.asyncio
async def test_quota_me(client, auth_headers):
    resp = await client.get("/api/v1/quota/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "role" in data
    assert "limits" in data
    assert "daily_tokens" in data["limits"]
    assert "current" in data


@pytest.mark.asyncio
async def test_quota_me_unauthenticated(client):
    resp = await client.get("/api/v1/quota/me")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_set_quota_override(client, admin_headers, test_user):
    user, _ = test_user
    resp = await client.put(
        f"/api/v1/quota/admin/user/{user.roll_number}",
        headers=admin_headers,
        json={"daily_tokens": 100000, "requests_per_hour": 200, "reason": "Research project"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["daily_tokens"] == 100000
    assert data["requests_per_hour"] == 200


@pytest.mark.asyncio
async def test_admin_set_quota_requires_admin(client, auth_headers, test_user):
    user, _ = test_user
    resp = await client.put(
        f"/api/v1/quota/admin/user/{user.roll_number}",
        headers=auth_headers,
        json={"daily_tokens": 100000}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_exceeded_users(client, admin_headers):
    resp = await client.get("/api/v1/quota/admin/exceeded", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "users" in data
