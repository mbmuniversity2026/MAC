# Changelog

All notable changes to this project will be documented in this file.
This project follows [Semantic Versioning](https://semver.org/).

---

## [v2.0.0] — 2026-04-29

### Added
- Worker node support: GPU/CPU contribution to cluster via `docker-compose.worker.yml`
- Inno Setup 6 Windows installer with HOST / WORKER role selection at install time
- Hardware scan wizard page (CPU, GPU, RAM, detected LAN IP, OS)
- SSL certificate generation & automatic trust on install
- Firewall rule automation for ports 80, 443, 8000, 8001
- Interactive startup sequence with mascot animation in installer
- Kernel execution engine for notebook cells
- Monaco editor for notebooks
- Registry role separation (admin / user)
- Admin tab persistence across sessions
- Fullscreen mode per notebook cell

### Changed
- Installer updated from v1.0.0 → v2.0.0 branding

---

## [v1.0.0] — 2026-04-26

### Added
- Initial release of the self-hosted AI inference platform
- FastAPI backend with async SQLAlchemy + PostgreSQL
- Alembic database migrations
- JWT authentication with role-based access control
- Model management, quota system, and RAG pipeline
- Nginx reverse proxy with HTTPS support
- Docker Compose deployment stack
- Web frontend (PWA, offline-capable)
- Notification, attendance, doubts, copy-check, and academic modules
