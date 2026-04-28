"""Self-signed SSL cert generator using cryptography (no openssl binary needed).

Called from the setup wizard at first boot. Cert is valid 10 years for the
detected LAN IP (no renewal needed for college LAN). Nginx mounts the
output dir as read-only.
"""

import asyncio
import logging
import pathlib
from datetime import datetime, timedelta, timezone
from typing import Optional

log = logging.getLogger(__name__)


def _generate_sync(ip: str, cert_path: pathlib.Path, key_path: pathlib.Path) -> tuple[str, str]:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import ipaddress

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, ip),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MBM University"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "MAC"),
    ])

    san = [x509.DNSName(ip)]
    try:
        san.append(x509.IPAddress(ipaddress.ip_address(ip)))
    except ValueError:
        pass
    san.append(x509.DNSName("localhost"))
    san.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))

    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    try:
        # 0o600 has no effect on Windows but is the right intent.
        key_path.chmod(0o600)
    except Exception:  # noqa: BLE001
        pass
    return (str(cert_path), str(key_path))


async def generate_ssl_cert(
    ip: str,
    cert_path: Optional[pathlib.Path] = None,
    key_path: Optional[pathlib.Path] = None,
) -> tuple[str, str]:
    """Generate a 10-year self-signed cert. Returns (cert_path, key_path)."""
    project_root = pathlib.Path(__file__).resolve().parent.parent.parent
    cert_path = cert_path or (project_root / "nginx" / "ssl" / "mac.crt")
    key_path = key_path or (project_root / "nginx" / "ssl" / "mac.key")
    return await asyncio.to_thread(_generate_sync, ip, cert_path, key_path)
