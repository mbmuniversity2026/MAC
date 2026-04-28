"""Tests for /usage endpoints."""

import pytest


@pytest.mark.asyncio
async def test_my_usage(client, auth_headers):
    resp = await client.get("/api/v1/usage/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "usage" in data
    assert "quota" in data
    assert data["roll_number"] == "21CS045"


@pytest.mark.asyncio
async def test_my_history(client, auth_headers):
    resp = await client.get("/api/v1/usage/me/history", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "requests" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_my_quota(client, auth_headers):
    resp = await client.get("/api/v1/usage/me/quota", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "student"
    assert "limits" in data
    assert "current" in data


@pytest.mark.asyncio
async def test_admin_all_requires_admin(client, auth_headers):
    # Student should get 403
    resp = await client.get("/api/v1/usage/admin/all", headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_all_usage(client, admin_headers):
    resp = await client.get("/api/v1/usage/admin/all", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "users" in data


@pytest.mark.asyncio
async def test_admin_models_usage(client, admin_headers):
    resp = await client.get("/api/v1/usage/admin/models", headers=admin_headers)
    assert resp.status_code == 200
    assert "models" in resp.json()
