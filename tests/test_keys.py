"""Tests for /keys endpoints (Phase 4)."""

import pytest


@pytest.mark.asyncio
async def test_get_my_key(client, auth_headers, test_user):
    resp = await client.get("/api/v1/keys/my-key", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "key_prefix" in data
    assert "key_suffix" in data
    assert data["status"] == "active"


@pytest.mark.asyncio
async def test_get_my_key_unauthenticated(client):
    resp = await client.get("/api/v1/keys/my-key")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_generate_key(client, auth_headers):
    # Generate new key
    resp = await client.post("/api/v1/keys/generate", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "api_key" in data
    assert data["api_key"].startswith("mac_sk_live_")


@pytest.mark.asyncio
async def test_key_stats(client, auth_headers):
    resp = await client.get("/api/v1/keys/my-key/stats", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "tokens_today" in data
    assert "requests_today" in data


@pytest.mark.asyncio
async def test_revoke_key(client, auth_headers):
    resp = await client.delete("/api/v1/keys/my-key", headers=auth_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_admin_list_keys(client, admin_headers):
    resp = await client.get("/api/v1/keys/admin/all", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "keys" in data


@pytest.mark.asyncio
async def test_admin_list_keys_requires_admin(client, auth_headers):
    resp = await client.get("/api/v1/keys/admin/all", headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_revoke_key(client, admin_headers, test_user):
    user, _ = test_user
    resp = await client.post("/api/v1/keys/admin/revoke", headers=admin_headers,
                             json={"roll_number": user.roll_number, "reason": "test"})
    assert resp.status_code == 200
