"""Tests for /models endpoints (Phase 2)."""

import pytest
from unittest.mock import patch, AsyncMock


@pytest.mark.asyncio
async def test_models_list(client, auth_headers):
    mock_models = [
        {"name": "qwen2.5-coder:7b", "model": "qwen2.5-coder:7b", "size": 4000000000}
    ]
    with patch("mac.services.llm_service.list_ollama_models", new_callable=AsyncMock, return_value=mock_models):
        resp = await client.get("/api/v1/models", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    assert "total" in data


@pytest.mark.asyncio
async def test_models_list_unauthenticated(client):
    resp = await client.get("/api/v1/models")
    # /models has no auth requirement — returns 200
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_model_detail(client, auth_headers):
    with patch("mac.services.llm_service.list_ollama_models", new_callable=AsyncMock, return_value=[]):
        with patch("mac.services.llm_service.get_ollama_model_detail", new_callable=AsyncMock, return_value={"modelfile": "FROM qwen", "parameters": "temp 0.7"}):
            resp = await client.get("/api/v1/models/qwen2.5-coder:7b", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "qwen2.5-coder:7b"


@pytest.mark.asyncio
async def test_model_detail_not_found(client, auth_headers):
    resp = await client.get("/api/v1/models/nonexistent-model", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_model_load_requires_admin(client, auth_headers):
    resp = await client.post("/api/v1/models/qwen2.5-coder:7b/load", headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_model_load_as_admin(client, admin_headers):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status = lambda: None
    mock_resp.json = lambda: {"done": True}

    with patch("mac.services.model_service.httpx.AsyncClient") as MockClient:
        mock_client_instance = AsyncMock()
        mock_client_instance.post = AsyncMock(return_value=mock_resp)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=None)
        MockClient.return_value = mock_client_instance

        resp = await client.post("/api/v1/models/qwen2.5-coder:7b/load", headers=admin_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_model_health(client, auth_headers):
    with patch("mac.services.model_service.get_model_health", new_callable=AsyncMock, return_value={
        "model_id": "qwen2.5-coder:7b", "status": "ready", "ready": True, "latency_ms": 100, "memory_mb": 4096
    }):
        resp = await client.get("/api/v1/models/qwen2.5-coder:7b/health", headers=auth_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_model_download_requires_admin(client, auth_headers):
    resp = await client.post("/api/v1/models/download", headers=auth_headers,
                             json={"model_name": "test:latest"})
    assert resp.status_code == 403
