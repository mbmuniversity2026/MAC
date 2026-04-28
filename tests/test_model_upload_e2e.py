"""E2E test for community model upload lifecycle:
submit → review → assign worker → mark live → inference routing → retire.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient

from mac.database import async_session
from mac.services import node_service


# ── Helpers ─────────────────────────────────────────────

async def _create_worker_node(db) -> str:
    """Create a fake enrolled worker node and return its ID."""
    # Create a token first
    plain_token, token_record = await node_service.create_enrollment_token(
        db, created_by="test-admin", label="Test Worker"
    )
    # Enroll the node
    node = await node_service.enroll_node(
        db,
        enrollment_token=plain_token,
        name="test-gpu-worker",
        hostname="test-host",
        ip_address="192.168.1.50",
        port=8001,
        gpu_name="RTX 3060",
        gpu_vram_mb=12288,
        ram_total_mb=32768,
        cpu_cores=8,
    )
    await db.commit()
    return node.id


# ── Tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_model_submission_lifecycle(client: AsyncClient, auth_headers, admin_headers):
    """Test the complete flow: submit → review → assign → live → community listing → retire."""

    # ── 1. User submits a HuggingFace model ──
    submit_resp = await client.post(
        "/api/v1/models/submit",
        json={
            "model_url": "mistralai/Mistral-7B-Instruct-v0.3",
            "display_name": "Mistral 7B Instruct",
            "description": "Fast general chat model",
            "category": "speed",
            "parameters": "7B",
            "context_length": 32768,
            "quantization": "AWQ",
            "min_vram_gb": 8.0,
            "capabilities": ["chat", "completion"],
        },
        headers=auth_headers,
    )
    assert submit_resp.status_code == 200, f"Submit failed: {submit_resp.text}"
    sub = submit_resp.json()["submission"]
    submission_id = sub["id"]
    assert sub["status"] == "submitted"
    assert sub["model_source"] == "huggingface"
    assert sub["model_id"] == "mistralai/Mistral-7B-Instruct-v0.3"

    # ── 2. User can see their own submission ──
    my_subs = await client.get("/api/v1/models/submissions", headers=auth_headers)
    assert my_subs.status_code == 200
    assert any(s["id"] == submission_id for s in my_subs.json()["submissions"])

    # ── 3. Admin reviews and approves ──
    review_resp = await client.post(
        f"/api/v1/models/submissions/{submission_id}/review",
        json={"decision": "approved", "note": "Looks good, approved for deployment"},
        headers=admin_headers,
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["submission"]["status"] == "approved"

    # ── 4. Create a worker node and assign the model ──
    async with async_session() as db:
        worker_id = await _create_worker_node(db)

    assign_resp = await client.post(
        f"/api/v1/models/submissions/{submission_id}/assign",
        json={"worker_node_id": worker_id, "vllm_port": 8002},
        headers=admin_headers,
    )
    assert assign_resp.status_code == 200
    data = assign_resp.json()
    assert data["submission"]["status"] == "deploying"
    assert data["submission"]["worker_node_id"] == worker_id
    assert data["submission"]["vllm_port"] == 8002
    # Should also have created a NodeModelDeployment
    assert data.get("deployment_id") is not None

    # ── 5. Mark as live ──
    live_resp = await client.post(
        f"/api/v1/models/submissions/{submission_id}/live",
        headers=admin_headers,
    )
    assert live_resp.status_code == 200
    assert live_resp.json()["submission"]["status"] == "live"

    # ── 6. Community listing includes the model ──
    community_resp = await client.get("/api/v1/models/community")
    assert community_resp.status_code == 200
    community_models = community_resp.json()["models"]
    assert any(m["id"] == "mistralai/Mistral-7B-Instruct-v0.3" for m in community_models)

    # ── 7. Main model listing also includes the live community model ──
    models_resp = await client.get("/api/v1/models")
    assert models_resp.status_code == 200
    all_models = models_resp.json()["models"]
    model_ids = [m["id"] for m in all_models]
    assert "mistralai/Mistral-7B-Instruct-v0.3" in model_ids

    # ── 8. Admin can see stats ──
    stats_resp = await client.get("/api/v1/models/submission-stats", headers=admin_headers)
    assert stats_resp.status_code == 200
    stats = stats_resp.json()["stats"]
    assert stats.get("live", 0) >= 1

    # ── 9. Retire the model ──
    retire_resp = await client.post(
        f"/api/v1/models/submissions/{submission_id}/retire",
        headers=admin_headers,
    )
    assert retire_resp.status_code == 200
    assert retire_resp.json()["submission"]["status"] == "retired"

    # ── 10. No longer in community listing ──
    community_resp2 = await client.get("/api/v1/models/community")
    community_ids = [m["id"] for m in community_resp2.json()["models"]]
    assert "mistralai/Mistral-7B-Instruct-v0.3" not in community_ids


@pytest.mark.asyncio
async def test_submit_duplicate_blocked(client: AsyncClient, auth_headers):
    """Submitting the same model twice should fail."""
    payload = {
        "model_url": "meta-llama/Llama-3-8B-Instruct",
        "display_name": "Llama 3 8B",
    }
    resp1 = await client.post("/api/v1/models/submit", json=payload, headers=auth_headers)
    assert resp1.status_code == 200

    resp2 = await client.post("/api/v1/models/submit", json=payload, headers=auth_headers)
    assert resp2.status_code == 400  # duplicate


@pytest.mark.asyncio
async def test_submit_invalid_url_rejected(client: AsyncClient, auth_headers):
    """Empty model_url should be rejected."""
    resp = await client.post(
        "/api/v1/models/submit",
        json={"model_url": "", "display_name": "Test"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_non_admin_cannot_review(client: AsyncClient, auth_headers):
    """Regular users cannot review submissions."""
    # Submit first
    resp = await client.post(
        "/api/v1/models/submit",
        json={"model_url": "org/some-model", "display_name": "Test Model"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    sub_id = resp.json()["submission"]["id"]

    # Try to review as non-admin
    review_resp = await client.post(
        f"/api/v1/models/submissions/{sub_id}/review",
        json={"decision": "approved"},
        headers=auth_headers,
    )
    assert review_resp.status_code == 403


@pytest.mark.asyncio
async def test_route_ordering_no_conflict(client: AsyncClient, auth_headers, admin_headers):
    """Ensure /submissions, /community, /submit, /submission-stats are not captured by /{model_id}."""
    # These should all return proper responses, not 404 "model not found"
    resp1 = await client.get("/api/v1/models/submissions", headers=auth_headers)
    assert resp1.status_code == 200
    assert "submissions" in resp1.json()

    resp2 = await client.get("/api/v1/models/community")
    assert resp2.status_code == 200
    assert "models" in resp2.json()

    resp3 = await client.get("/api/v1/models/submission-stats", headers=admin_headers)
    assert resp3.status_code == 200
    assert "stats" in resp3.json()


@pytest.mark.asyncio
async def test_worker_pending_deployments(client: AsyncClient, auth_headers, admin_headers):
    """Test that assigning a worker creates a pending deployment that can be polled."""
    # Submit and approve
    sub = await client.post(
        "/api/v1/models/submit",
        json={"model_url": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "display_name": "TinyLlama"},
        headers=auth_headers,
    )
    sub_id = sub.json()["submission"]["id"]

    await client.post(
        f"/api/v1/models/submissions/{sub_id}/review",
        json={"decision": "approved"},
        headers=admin_headers,
    )

    # Create worker node
    async with async_session() as db:
        worker_id = await _create_worker_node(db)

    # Assign
    assign = await client.post(
        f"/api/v1/models/submissions/{sub_id}/assign",
        json={"worker_node_id": worker_id, "vllm_port": 8003},
        headers=admin_headers,
    )
    assert assign.status_code == 200
    deployment_id = assign.json().get("deployment_id")
    assert deployment_id is not None

    # Poll for pending deployments (this is what the worker-agent calls)
    pending = await client.get(f"/api/v1/nodes/pending-deployments/{worker_id}")
    assert pending.status_code == 200
    pending_list = pending.json()["pending"]
    assert len(pending_list) >= 1
    assert any(d["deployment_id"] == deployment_id for d in pending_list)

    # Worker reports deployment ready
    status_resp = await client.post(
        f"/api/v1/nodes/deployment/{deployment_id}/status",
        json={"status": "ready"},
    )
    assert status_resp.status_code == 200

    # No longer pending
    pending2 = await client.get(f"/api/v1/nodes/pending-deployments/{worker_id}")
    pending_list2 = pending2.json()["pending"]
    assert not any(d["deployment_id"] == deployment_id for d in pending_list2)


@pytest.mark.asyncio
async def test_hf_url_parsing(client: AsyncClient, auth_headers):
    """Various HuggingFace URL formats should be accepted."""
    urls = [
        ("https://huggingface.co/google/gemma-2-9b-it", "google/gemma-2-9b-it"),
        ("google/gemma-2-2b-it", "google/gemma-2-2b-it"),
    ]
    for url, expected_id in urls:
        resp = await client.post(
            "/api/v1/models/submit",
            json={"model_url": url, "display_name": f"Test {expected_id}"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Failed for {url}: {resp.text}"
        assert resp.json()["submission"]["model_id"] == expected_id
