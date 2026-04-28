"""Tests for /integration endpoints (Phase 3)."""

import pytest


@pytest.mark.asyncio
async def test_routing_rules(client, auth_headers):
    resp = await client.get("/api/v1/integration/routing-rules", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "rules" in data
    assert isinstance(data["rules"], list)
    assert len(data["rules"]) > 0  # Default rules exist


@pytest.mark.asyncio
async def test_routing_rules_unauthenticated(client):
    resp = await client.get("/api/v1/integration/routing-rules")
    # /integration/routing-rules has no auth dependency — public
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_update_routing_rules_requires_admin(client, auth_headers):
    resp = await client.put("/api/v1/integration/routing-rules", headers=auth_headers,
                            json={"rules": []})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_routing_rules_as_admin(client, admin_headers):
    new_rules = [
        {"task_type": "test", "target_model": "test:latest", "priority": 1}
    ]
    resp = await client.put("/api/v1/integration/routing-rules", headers=admin_headers,
                            json={"rules": new_rules})
    assert resp.status_code == 200
    assert len(resp.json()["rules"]) == 1

    # Verify
    resp2 = await client.get("/api/v1/integration/routing-rules")
    assert len(resp2.json()["rules"]) == 1


@pytest.mark.asyncio
async def test_workers_list(client, auth_headers):
    resp = await client.get("/api/v1/integration/workers", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "workers" in data
    assert len(data["workers"]) >= 1


@pytest.mark.asyncio
async def test_worker_detail(client, auth_headers):
    resp = await client.get("/api/v1/integration/workers/node-local", headers=auth_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_worker_detail_not_found(client, auth_headers):
    resp = await client.get("/api/v1/integration/workers/nonexistent", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_queue_status(client, auth_headers):
    resp = await client.get("/api/v1/integration/queue", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "pending" in data
    assert "processing" in data
