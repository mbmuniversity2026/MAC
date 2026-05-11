# MAC — MBM AI Cloud

**MAC** is a self-hosted, on-premise AI inference platform built by the CSE department of **MBM University (Mugneeram Bangur Memorial University), Jodhpur, Rajasthan, India**. It serves the entire campus LAN — no cloud dependencies, no external API calls.

- **Version**: 2.0.0
- **License**: MBM Open License (campus-only)
- **Branch conventions**: `mac` (dev), `master` (main/release)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11 · FastAPI 0.115 · Uvicorn (async) |
| Database | PostgreSQL 16 · SQLAlchemy 2.0 async · asyncpg · Alembic migrations |
| Cache / Rate-limit | Redis 7 |
| Vector DB (RAG) | Qdrant |
| Web Search | SearXNG (self-hosted) |
| LLM Inference | vLLM (GPU) · Ollama (fallback) |
| Speech | Whisper (STT) · Veena/Piper (TTS) |
| Frontend | Vanilla JS SPA — no framework, no build step |
| Code Editor | Monaco Editor 0.52.2 (offline bundled) |
| Reverse Proxy | Nginx Alpine |
| Containers | Docker Compose (multi-profile) |
| Auth | JWT HS256 · bcrypt · scoped API keys |

---

## Project Layout

```
D:\mac/
├── mac/                    # FastAPI backend
│   ├── main.py             # App factory, lifespan, 27+ routers mounted
│   ├── config.py           # Pydantic Settings (all env vars)
│   ├── database.py         # Async SQLAlchemy engine + session
│   ├── models/             # 19 ORM models (user, rag, node, attendance, notebook, …)
│   ├── routers/            # 25+ route modules
│   ├── services/           # 25+ business-logic services
│   ├── schemas/            # Pydantic request/response models
│   ├── middleware/         # auth_middleware, rate_limit, feature_gate
│   └── utils/security.py   # JWT + password helpers
├── frontend/               # Vanilla JS SPA
│   ├── index.html          # Single entry point
│   ├── style.css           # 1362-line responsive stylesheet
│   ├── sw.js               # Service worker (PWA offline)
│   ├── js/                 # 15 modular JS files (no transpilation)
│   └── libs/               # Bundled offline libs (Chart.js, Highlight.js, Mermaid, Monaco)
├── alembic/                # DB migrations
├── nginx/                  # nginx.conf + nginx.https.conf
├── tests/                  # Pytest
├── veena_tts/              # TTS service
├── docker-compose.yml          # Full stack (8 services)
├── docker-compose.worker.yml   # Worker/satellite node
├── Dockerfile
├── .env.example            # 230-line config template
├── start-mac.bat / stop-mac.bat
├── start-mac-worker.bat
├── mac-installer.iss       # Inno Setup Windows installer
└── WALKTHROUGH.md          # Deep-dive agent guide (~600 lines)
```

---

## Key Entry Points

- **`mac/main.py`** — App factory, lifespan, SPA fallback, dev seed (admin/faculty/student test accounts)
- **`mac/config.py`** — All runtime settings via environment variables
- **`frontend/js/core.js`** — Client-side router and API fetch wrapper
- **`frontend/js/auth.js`** — Login/signup UI (has dev-credentials hint in dev mode)

---

## Important Services

| Service | File | Notes |
|---------|------|-------|
| LLM routing + streaming | `services/llm_service.py` | ~40KB, handles 4 model tiers (SPEED/CODE/REASON/INTELLIGENCE) |
| Kernel execution | `services/kernel_manager.py` | Jupyter-style; Python, JS, Bash, SQL, Java, C++, Rust |
| RAG pipeline | `services/rag_service.py` | PDF/DOCX/TXT → embed → Qdrant |
| Attendance | `services/attendance_service.py` | QR + manual, CSV export |
| Plagiarism check | `services/copy_check_service.py` | Adobe Scan API integration |
| LAN discovery | `services/discovery.py` | mDNS/UDP broadcast for worker nodes |
| Feature flags | `services/feature_flag_service.py` | Per-user or global dynamic gating |
| Hardware monitor | `services/hardware.py` | GPU/CPU/RAM stats |

---

## Frontend Modules (frontend/js/)

| File | Responsibility |
|------|---------------|
| core.js | Router, API wrapper, bootstrap |
| auth.js | Login/signup/verify UI |
| shell.js | Nav shell, sidebar |
| chat.js | LLM chat, streaming, RAG file context, web search |
| admin.js / admin2.js | Admin dashboard (user CRUD, quotas, feature flags, nodes) |
| notebooks.js | Monaco editor + kernel WebSocket execution |
| voice_chat.js | Speech-to-text + TTS |
| attendance.js | QR display + manual marking |
| copycheck.js | Plagiarism scan UI |
| doubts.js | Q&A forum |
| fileshare.js | Faculty upload / student download |
| settings.js | User profile & preferences |
| notifications.js | Push notification manager |
| i18n.js | 19-language translations (en, hi, raj, gu, mr, pa, bn, ta, te, kn, ml, or, as, ur, ne, si, kok, mai, bho) |
| utils.js | Shared helpers |

---

## Roles & Auth

Three roles: **admin**, **faculty**, **student**. JWT-based with scoped API keys.

Dev seed accounts (created at startup when `MAC_ENV=development`):
- `admin` / `admin123`
- `faculty` / `faculty123`
- `student` / `student123`

---

## Docker Services

```
mac-api       FastAPI on :8000
postgres      PostgreSQL 16
redis         Redis 7
qdrant        Vector DB
searxng       Self-hosted web search
vllm-speed    Fast LLM (port 8001)
vllm-code     Code model (port 8002)
vllm-reason   Reasoning model (port 8003)
vllm-intel    Intelligence/large model (port 8004)
whisper       STT service
tts (veena)   TTS service
pgadmin       DB admin UI
```

Worker node services in `docker-compose.worker.yml`.

---

## Development Workflow

```bash
# Backend hot-reload
docker compose up mac postgres redis

# Frontend: edit frontend/js/*.js → reload browser (no build step)

# Run migrations
alembic upgrade head

# Run tests
pytest tests/
```

No transpiler, no bundler — frontend changes are instant on browser reload.

---

## Windows Deployment

- **Installer**: `mac-installer.iss` (Inno Setup) — GUI wizard, role selection (HOST / WORKER), hardware detection, SSL cert generation, firewall rules
- **Launchers**: `start-mac.bat`, `stop-mac.bat`, `start-mac-worker.bat`
- **Worker exe**: `build-worker-exe.bat` builds a standalone worker executable
- **Browser**: `launch-mac-chrome.bat` opens the UI in kiosk mode

---

## Active Development Areas (as of v2.0.0)

- Admin PTY terminal over WebSocket (`routers/terminal.py`)
- Voice chat (`routers/voice_chat.py`)
- Video studio (`routers/video.py`)
- Activity log SSE stream (`routers/activity.py`)
- Role-based dashboards (admin/faculty/student views)
- Worker node clustering and GPU contribution

---

## Configuration Notes

All config lives in `.env` (Git-ignored). Template: `.env.example`.
Key variables:
- `MAC_ENV` — `development` | `production`
- `MAC_SECRET_KEY` — JWT signing key
- `VLLM_SPEED_URL`, `VLLM_CODE_URL`, `VLLM_REASON_URL`, `VLLM_INTEL_URL`
- `WHISPER_URL`, `TTS_URL`
- `QDRANT_URL`, `SEARXNG_URL`
- `DATABASE_URL`, `REDIS_URL`

---

## Docs & References

| File | Purpose |
|------|---------|
| README.md | Quick-start (clone → configure .env → docker compose up) |
| CHANGELOG.md | Version history (v1.0.0 initial · v2.0.0 worker nodes) |
| WALKTHROUGH.md | Deep agent guide (~600 lines, covers all features) |
| .env.example | Full configuration reference |
