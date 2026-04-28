"""Tests for /hardware endpoints."""

import pytest


async def test_local_hardware(client):
    resp = await client.get("/api/v1/hardware/local")
    assert resp.status_code == 200
    data = resp.json()
    assert "cpu" in data
    assert "ram" in data
    assert "disk" in data
    assert "gpus" in data
    assert "tier" in data
    assert "docker" in data
    assert data["tier"] in {"GPU_NVIDIA", "GPU_AMD", "CPU_ONLY"}


async def test_model_recommendations(client):
    resp = await client.get("/api/v1/hardware/recommendations")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    first = data[0]
    assert {"id", "size_gb", "min_vram_gb", "tier", "tag", "specialty"}.issubset(first.keys())
    assert first["tag"] in {"RECOMMENDED", "POSSIBLE", "NOT_RECOMMENDED", "CPU_ONLY"}
