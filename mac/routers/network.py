"""Network info + LAN discovery endpoints."""

from fastapi import APIRouter

from mac.services import network_info, discovery

router = APIRouter(prefix="/network", tags=["Network"])


@router.get("/local-ip")
async def local_ip():
    """Primary LAN IPv4, all IPs on this host, hostname, and a QR SVG."""
    return network_info.build_network_info()


@router.get("/discover")
async def discover(timeout: float = 3.0):
    """UDP broadcast scan for other MAC control nodes on the LAN."""
    timeout = min(max(timeout, 0.5), 10.0)
    return await discovery.discover_nodes(timeout_s=timeout)
