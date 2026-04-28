"""Tests for /network endpoints."""

import pytest


async def test_local_ip(client):
    resp = await client.get("/api/v1/network/local-ip")
    assert resp.status_code == 200
    data = resp.json()
    assert "primary" in data
    assert "all_ips" in data
    assert "hostname" in data
    assert "qr_svg" in data
    # QR may be empty string if qrcode lib missing in test env, but key must exist
    if data["qr_svg"]:
        assert data["qr_svg"].lstrip().startswith("<")


async def test_discover_returns_list(client):
    # Short timeout to keep the test fast
    resp = await client.get("/api/v1/network/discover?timeout=0.5")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
