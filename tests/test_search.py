"""Tests for /search endpoints (Phase 8)."""

import pytest
from unittest.mock import patch, AsyncMock


@pytest.mark.asyncio
async def test_web_search(client, auth_headers):
    mock_results = [
        {"title": "Test", "url": "https://example.com", "snippet": "A test result."}
    ]
    with patch("mac.services.search_service.web_search", new_callable=AsyncMock, return_value=mock_results):
        resp = await client.post("/api/v1/search/web", headers=auth_headers,
                                 json={"query": "test query"})
    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data
    assert len(data["results"]) == 1


@pytest.mark.asyncio
async def test_web_search_unauthenticated(client):
    resp = await client.post("/api/v1/search/web", json={"query": "test"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_wikipedia_search(client, auth_headers):
    mock_results = [
        {"title": "Python (programming language)", "summary": "Python is...", "url": "https://en.wikipedia.org/wiki/Python"}
    ]
    with patch("mac.services.search_service.wikipedia_search", new_callable=AsyncMock, return_value=mock_results):
        resp = await client.post("/api/v1/search/wikipedia", headers=auth_headers,
                                 json={"query": "Python programming"})
    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data


@pytest.mark.asyncio
async def test_grounded_search(client, auth_headers):
    mock_search = [{"title": "Test", "url": "https://example.com", "snippet": "Test content."}]
    mock_llm = {
        "id": "mac-chat-test", "object": "chat.completion", "created": 0,
        "model": "qwen2.5-coder:7b",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "Grounded answer."}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 20, "total_tokens": 70},
        "_latency_ms": 500,
    }
    with patch("mac.services.search_service.web_search", new_callable=AsyncMock, return_value=mock_search):
        with patch("mac.services.llm_service.chat_completion", new_callable=AsyncMock, return_value=mock_llm):
            resp = await client.post("/api/v1/search/grounded", headers=auth_headers,
                                     json={"query": "What is Python?"})
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert "sources" in data


@pytest.mark.asyncio
async def test_search_cache(client, auth_headers):
    resp = await client.get("/api/v1/search/cache", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "entries" in data
