"""
Standalone SSL cert generator for MAC startup.
Called by start-mac.bat before Docker compose up.
Creates CA + server cert for the host's WiFi IP so all LAN devices
can install the CA once and get trusted HTTPS + PWA install.

Usage: python -c "exec(open('mac/services/_gen_ssl_startup.py').read())" <IP> [<ssl_dir>]
"""
import sys, os, datetime, ipaddress

def main():
    host_ip = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.1"
    ssl_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "nginx", "ssl")
    ssl_dir = os.path.abspath(ssl_dir)
    os.makedirs(ssl_dir, exist_ok=True)

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
    except ImportError:
        print("  [SSL] Installing cryptography...")
        os.system(f"{sys.executable} -m pip install cryptography -q")
        from cryptography import x509
        from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

    ca_key_f  = os.path.join(ssl_dir, "ca.key")
    ca_crt_f  = os.path.join(ssl_dir, "ca.crt")
    srv_key_f = os.path.join(ssl_dir, "mac.key")
    srv_crt_f = os.path.join(ssl_dir, "mac.crt")

    now = datetime.datetime.now(datetime.timezone.utc)

    # ── CA (reuse if exists) ──
    if os.path.exists(ca_key_f) and os.path.exists(ca_crt_f):
        with open(ca_key_f, "rb") as f:
            ca_key = serialization.load_pem_private_key(f.read(), password=None)
        with open(ca_crt_f, "rb") as f:
            ca_cert = x509.load_pem_x509_certificate(f.read())
        print("  [CA] Reusing existing CA")
    else:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca_name = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Rajasthan"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MAC - MBM AI Cloud"),
            x509.NameAttribute(NameOID.COMMON_NAME, "MAC Local CA"),
        ])
        ca_cert = (x509.CertificateBuilder()
            .subject_name(ca_name).issuer_name(ca_name)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(
                digital_signature=True, key_cert_sign=True, crl_sign=True,
                content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False,
                encipher_only=False, decipher_only=False
            ), critical=True)
            .sign(ca_key, hashes.SHA256()))
        with open(ca_key_f, "wb") as f:
            f.write(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
        with open(ca_crt_f, "wb") as f:
            f.write(ca_cert.public_bytes(serialization.Encoding.PEM))
        print("  [CA] Generated new CA")

    # ── Server cert (always regenerate — IP may change) ──
    srv_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    srv_name = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MAC - MBM AI Cloud"),
        x509.NameAttribute(NameOID.COMMON_NAME, f"MAC Server ({host_ip})"),
    ])
    san = [
        x509.DNSName("localhost"),
        x509.DNSName("mac.local"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        x509.IPAddress(ipaddress.IPv4Address(host_ip)),
    ]
    srv_cert = (x509.CertificateBuilder()
        .subject_name(srv_name)
        .issuer_name(ca_cert.subject)
        .public_key(srv_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(ca_key, hashes.SHA256()))
    with open(srv_key_f, "wb") as f:
        f.write(srv_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    with open(srv_crt_f, "wb") as f:
        f.write(srv_cert.public_bytes(serialization.Encoding.PEM))
    print(f"  [Server] Certificate for {host_ip} (SANs: localhost, mac.local, 127.0.0.1, {host_ip})")

main()
