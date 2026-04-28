"""Tests for /rag endpoints (Phase 7)."""

import io
import pytest
from unittest.mock import patch, AsyncMock


@pytest.mark.asyncio
async def test_rag_documents_empty(client, auth_headers):
    resp = await client.get("/api/v1/rag/documents", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "documents" in data
    assert len(data["documents"]) == 0


@pytest.mark.asyncio
async def test_rag_documents_unauthenticated(client):
    resp = await client.get("/api/v1/rag/documents")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_rag_ingest_text_file(client, auth_headers):
    content = b"This is a test document for RAG ingestion. It contains enough text to be chunked."
    with patch("mac.services.rag_service._store_embeddings", new_callable=AsyncMock, return_value=None):
        resp = await client.post(
            "/api/v1/rag/ingest",
            headers=auth_headers,
            files={"file": ("test.txt", io.BytesIO(content), "text/plain")},
            data={"title": "Test Document"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test Document"
    assert data["status"] in ("processing", "ready")


@pytest.mark.asyncio
async def test_rag_ingest_unsupported_type(client, auth_headers):
    content = b"\x00\x01\x02\x03"
    resp = await client.post(
        "/api/v1/rag/ingest",
        headers=auth_headers,
        files={"file": ("test.exe", io.BytesIO(content), "application/x-executable")},
        data={"title": "Bad File"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_rag_collections_empty(client, auth_headers):
    resp = await client.get("/api/v1/rag/collections", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "collections" in data


@pytest.mark.asyncio
async def test_rag_create_collection_requires_admin(client, auth_headers):
    resp = await client.post("/api/v1/rag/collections", headers=auth_headers,
                             json={"name": "test", "description": "A test collection"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_rag_create_collection_as_admin(client, admin_headers):
    resp = await client.post("/api/v1/rag/collections", headers=admin_headers,
                             json={"name": "test-collection", "description": "A test collection"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "test-collection"


@pytest.mark.asyncio
async def test_rag_query(client, auth_headers):
    with patch("mac.services.rag_service.query_rag", new_callable=AsyncMock, return_value=[]):
        with patch("mac.services.llm_service.chat_completion", new_callable=AsyncMock, return_value={
            "id": "mac-chat-test", "object": "chat.completion", "created": 0,
            "model": "qwen2.5-coder:7b",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "Test answer"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "_latency_ms": 100,
        }):
            resp = await client.post("/api/v1/rag/query", headers=auth_headers,
                                     json={"question": "What is machine learning?"})
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert "sources" in data


@pytest.mark.asyncio
async def test_rag_delete_requires_admin(client, auth_headers):
    resp = await client.delete("/api/v1/rag/documents/some-id", headers=auth_headers)
    assert resp.status_code == 403
