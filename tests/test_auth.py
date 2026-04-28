"""Tests for /auth endpoints."""

import pytest


@pytest.mark.asyncio
async def test_login_success(client, test_user):
    user, password = test_user
    resp = await client.post("/api/v1/auth/login", json={
        "roll_number": user.roll_number,
        "password": password,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["roll_number"] == "21CS045"
    assert data["user"]["role"] == "student"


@pytest.mark.asyncio
async def test_login_wrong_password(client, test_user):
    user, _ = test_user
    resp = await client.post("/api/v1/auth/login", json={
        "roll_number": user.roll_number,
        "password": "wrongpassword",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client):
    resp = await client.post("/api/v1/auth/login", json={
        "roll_number": "99XX999",
        "password": "whatever123",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_with_token(client, auth_headers):
    resp = await client.get("/api/v1/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["roll_number"] == "21CS045"
    assert "quota" in data


@pytest.mark.asyncio
async def test_me_without_token(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 403  # No auth header


@pytest.mark.asyncio
async def test_me_with_api_key(client, test_user):
    user, _ = test_user
    resp = await client.get("/api/v1/auth/me", headers={
        "Authorization": f"Bearer {user.api_key}",
    })
    assert resp.status_code == 200
    assert resp.json()["roll_number"] == "21CS045"


@pytest.mark.asyncio
async def test_refresh_token(client, test_user):
    user, password = test_user
    # Login first
    login_resp = await client.post("/api/v1/auth/login", json={
        "roll_number": user.roll_number,
        "password": password,
    })
    refresh_token = login_resp.json()["refresh_token"]

    # Refresh
    resp = await client.post("/api/v1/auth/refresh", json={
        "refresh_token": refresh_token,
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_logout(client, test_user):
    user, password = test_user
    # Login
    login_resp = await client.post("/api/v1/auth/login", json={
        "roll_number": user.roll_number,
        "password": password,
    })
    token = login_resp.json()["access_token"]
    refresh = login_resp.json()["refresh_token"]

    # Logout
    resp = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200

    # Refresh should now fail
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_change_password(client, auth_headers, test_user):
    resp = await client.post("/api/v1/auth/change-password", headers=auth_headers, json={
        "old_password": "password123",
        "new_password": "newpassword456",
    })
    assert resp.status_code == 200

    # Login with new password
    user, _ = test_user
    resp = await client.post("/api/v1/auth/login", json={
        "roll_number": user.roll_number,
        "password": "newpassword456",
    })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_change_password_wrong_old(client, auth_headers):
    resp = await client.post("/api/v1/auth/change-password", headers=auth_headers, json={
        "old_password": "wrongoldpassword",
        "new_password": "newpassword456",
    })
    assert resp.status_code == 401
