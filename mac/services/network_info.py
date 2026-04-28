"""Local network introspection helpers."""

import socket
from typing import Optional


def get_local_ip() -> str:
    """Best-effort primary LAN IP. Uses a UDP socket trick (no packet sent)
    to find the interface used to reach the public internet (or fallback)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:  # noqa: BLE001
        return "127.0.0.1"
    finally:
        try:
            s.close()
        except Exception:  # noqa: BLE001
            pass


def get_all_ips() -> list[str]:
    """Return all non-loopback IPv4 addresses on this host."""
    ips: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:  # noqa: BLE001
        pass
    primary = get_local_ip()
    if primary not in ips and primary != "127.0.0.1":
        ips.insert(0, primary)
    return ips


def get_hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:  # noqa: BLE001
        return "mac-host"


def make_qr_svg(text: str, scale: int = 6) -> str:
    """Generate a QR code as inline SVG string. Returns empty string on failure."""
    try:
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(text, image_factory=qrcode.image.svg.SvgImage, box_size=scale, border=2)
        from io import BytesIO
        buf = BytesIO()
        img.save(buf)
        return buf.getvalue().decode("utf-8")
    except Exception:  # noqa: BLE001
        return ""


def build_network_info(scheme: str = "http") -> dict:
    primary = get_local_ip()
    return {
        "primary": primary,
        "all_ips": get_all_ips(),
        "hostname": get_hostname(),
        "qr_svg": make_qr_svg(f"{scheme}://{primary}"),
    }
