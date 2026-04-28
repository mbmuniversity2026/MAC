"""LAN discovery — UDP broadcast so worker PCs can find the control node.

Control node broadcasts every 5s and replies to discovery requests.
Workers use `discover_nodes()` to scan with a short timeout.
"""

import asyncio
import logging
import socket
from typing import Optional

from mac.config import settings
from mac.services.updater import get_current_version
from mac.services.network_info import get_local_ip

log = logging.getLogger(__name__)

BROADCAST_INTERVAL_S = 5
DISCOVERY_REQUEST = "MAC_DISCOVERY_REQUEST"
CONTROL_NODE_PREFIX = "MAC_CONTROL_NODE"


def _build_broadcast_message(ip: str) -> bytes:
    return f"{CONTROL_NODE_PREFIX}|{ip}|{socket.gethostname()}|{get_current_version()}".encode("utf-8")


class _DiscoveryProtocol(asyncio.DatagramProtocol):
    def __init__(self):
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport):
        self.transport = transport
        try:
            sock = transport.get_extra_info("socket")
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        except Exception:  # noqa: BLE001
            pass

    def datagram_received(self, data, addr):
        try:
            msg = data.decode("utf-8", errors="ignore").strip()
        except Exception:  # noqa: BLE001
            return
        if msg == DISCOVERY_REQUEST and self.transport:
            try:
                ip = get_local_ip()
                self.transport.sendto(_build_broadcast_message(ip), addr)
            except Exception:  # noqa: BLE001
                pass


async def start_discovery_server():
    """Long-running task: bind UDP socket, broadcast every 5s, reply to requests."""
    port = settings.mac_discovery_port
    loop = asyncio.get_running_loop()
    try:
        transport, protocol = await loop.create_datagram_endpoint(
            lambda: _DiscoveryProtocol(),
            local_addr=("0.0.0.0", port),
            allow_broadcast=True,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("Discovery server failed to bind on UDP %d: %s", port, e)
        return
    log.info("Discovery server listening on UDP %d", port)
    try:
        while True:
            try:
                ip = get_local_ip()
                transport.sendto(_build_broadcast_message(ip), ("255.255.255.255", port))
            except Exception as e:  # noqa: BLE001
                log.debug("Discovery broadcast failed: %s", e)
            try:
                await asyncio.sleep(BROADCAST_INTERVAL_S)
            except asyncio.CancelledError:
                raise
    except asyncio.CancelledError:
        raise
    finally:
        try:
            transport.close()
        except Exception:  # noqa: BLE001
            pass


async def discover_nodes(timeout_s: float = 3.0) -> list[dict]:
    """Send a discovery request and collect replies for `timeout_s` seconds."""
    port = settings.mac_discovery_port
    found: dict[str, dict] = {}
    loop = asyncio.get_running_loop()

    class _ScanProtocol(asyncio.DatagramProtocol):
        def datagram_received(self, data, addr):
            try:
                msg = data.decode("utf-8", errors="ignore").strip()
            except Exception:  # noqa: BLE001
                return
            if not msg.startswith(CONTROL_NODE_PREFIX):
                return
            parts = msg.split("|")
            ip = parts[1] if len(parts) > 1 else addr[0]
            found[ip] = {
                "ip": ip,
                "hostname": parts[2] if len(parts) > 2 else None,
                "version": parts[3] if len(parts) > 3 else None,
                "raw": msg,
            }

    try:
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _ScanProtocol(),
            local_addr=("0.0.0.0", 0),
            allow_broadcast=True,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("Discovery scan failed to create socket: %s", e)
        return []

    try:
        try:
            transport.sendto(DISCOVERY_REQUEST.encode("utf-8"), ("255.255.255.255", port))
        except Exception as e:  # noqa: BLE001
            log.debug("Discovery scan send failed: %s", e)
        await asyncio.sleep(timeout_s)
    finally:
        transport.close()
    return list(found.values())
