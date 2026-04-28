"""Tests for first-boot /setup flow."""

import pytest


async def test_status_first_run_when_no_admin(client):
    resp = await client.get("/api/v1/setup/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_first_run"] is True
    assert "version" in data


async def test_create_admin_then_setup_closed(client):
    resp = await client.post(
        "/api/v1/setup/create-admin",
        json={"name": "Founder", "email": "founder@mbm.edu", "password": "supersecret123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["user"]["role"] == "admin"
    assert body["user"]["is_founder"] is True

    # Setup is now closed
    status = await client.get("/api/v1/setup/status")
    assert status.json()["is_first_run"] is False

    # Second attempt rejected
    again = await client.post(
        "/api/v1/setup/create-admin",
        json={"name": "Other", "email": "other@mbm.edu", "password": "supersecret123"},
    )
    assert again.status_code == 409


async def test_create_admin_rejects_short_password(client):
    resp = await client.post(
        "/api/v1/setup/create-admin",
        json={"name": "X", "email": "x@mbm.edu", "password": "short"},
    )
    assert resp.status_code == 422  # pydantic validation


async def test_recovery_localhost_only(client):
    # httpx ASGITransport sets request.client to 127.0.0.1 by default
    resp = await client.get("/api/v1/setup/recovery")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
