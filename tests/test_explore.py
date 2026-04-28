"""Tests for /explore endpoints."""

import pytest


@pytest.mark.asyncio
async def test_root(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    # Root may return HTML (frontend) or JSON depending on mount order
    try:
        data = resp.json()
        assert "MAC" in data.get("name", "")
    except Exception:
        # Frontend HTML served — still valid
        assert "MAC" in resp.text or "html" in resp.text.lower()


@pytest.mark.asyncio
async def test_api_root(client):
    resp = await client.get("/api/v1")
    assert resp.status_code == 200
    assert "auth" in resp.json()["endpoints"]


@pytest.mark.asyncio
async def test_explore_models(client):
    resp = await client.get("/api/v1/explore/models")
    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_explore_models_search(client):
    resp = await client.get("/api/v1/explore/models/search?tag=code")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["models"], list)


@pytest.mark.asyncio
async def test_explore_endpoints_list(client):
    resp = await client.get("/api/v1/explore/endpoints")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] > 0
    assert any("/auth/login" in e["path"] for e in data["endpoints"])


@pytest.mark.asyncio
async def test_explore_health(client):
    resp = await client.get("/api/v1/explore/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["version"] == "1.0.0"


@pytest.mark.asyncio
async def test_explore_model_detail(client):
    resp = await client.get("/api/v1/explore/models/qwen2.5-coder:7b")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "qwen2.5-coder:7b"
    assert "code" in data["capabilities"]


@pytest.mark.asyncio
async def test_explore_model_not_found(client):
    resp = await client.get("/api/v1/explore/models/nonexistent-model")
    assert resp.status_code == 404
