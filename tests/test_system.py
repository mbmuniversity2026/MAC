"""Tests for /system endpoints."""

import pytest


async def test_version_endpoint(client):
    resp = await client.get("/api/v1/system/version")
    assert resp.status_code == 200
    data = resp.json()
    assert "version" in data
    assert data["version"]  # non-empty


async def test_update_status_endpoint(client):
    resp = await client.get("/api/v1/system/update-status")
    assert resp.status_code == 200
    data = resp.json()
    # Will return offline placeholder if GitHub unreachable / Redis missing — that's fine
    assert "current" in data
    assert "update_available" in data
    assert data["current"]


async def test_admin_restart_requires_auth(client):
    resp = await client.post("/api/v1/admin/system/restart")
    assert resp.status_code in (401, 403)


async def test_admin_restart_with_admin(client, admin_headers):
    resp = await client.post("/api/v1/admin/system/restart", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


async def test_student_cannot_restart(client, auth_headers):
    resp = await client.post("/api/v1/admin/system/restart", headers=auth_headers)
    assert resp.status_code == 403
