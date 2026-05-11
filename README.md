<p align="center">
  <img src="frontend/icons/icon-512.png" alt="MAC Logo" width="130" height="130" />
</p>

<h1 align="center">MAC — MBM AI Cloud</h1>

<p align="center">
  <strong>Self-Hosted AI Platform for MBM University, Jodhpur</strong><br/>
  Runs fully on the campus LAN · No internet required · No data leaves the institution
</p>

<p align="center">
  <a href="https://github.com/mbmuniversity2026/MAC/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MBM_Open-7c6ff7" alt="License"/></a>
  <img src="https://img.shields.io/badge/Python-3.11-blue?logo=python" alt="Python"/>
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/vLLM-inference-orange" alt="vLLM"/>
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker" alt="Docker"/>
</p>

---

## What is MAC?

**MAC (MBM AI Cloud)** is an open, on-premise AI platform built by the CSE department of MBM University (Mugneeram Bangur Memorial University), Jodhpur, Rajasthan, India.

It gives every student and faculty member access to large language models, a VS Code-style cloud IDE (MBM Book), document-aware AI chat, computational notebooks, and academic tools — all running on hardware inside the campus, with zero subscription fees and no data sent outside.

> Built by MBM, for MBM. Any institution can fork and deploy it.

---

## Features

| Feature | Status |
|---------|--------|
| AI Chat (streaming, multi-session, web search) | ✅ |
| RAG — attach PDF / DOCX / TXT to chat | ✅ |
| **MBM Book IDE** — VS Code in the browser, Docker container per user | ✅ |
| Computational Notebooks (Python, JS, Bash, SQL, C++, Rust, Java) | ✅ |
| Voice Chat (Whisper STT + Veena TTS) | ✅ |
| Student Q&A Forum (Doubts) | ✅ |
| File Sharing (faculty upload → student download) | ✅ |
| Admin Dashboard (user CRUD, quotas, feature flags, nodes) | ✅ |
| Worker Node Clustering (multi-PC GPU pool) | ✅ |
| 19-Language UI (Hindi, Rajasthani, Gujarati, Urdu …) | ✅ |
| Role-based Access (admin / faculty / student) | ✅ |
| LAN-only, no internet required | ✅ |

---

## Quick Start (5 minutes)

### Requirements

- Docker Desktop (Windows / Linux / Mac)
- Git
- 8 GB RAM minimum (16 GB recommended for LLMs)
- A GPU is optional — the platform runs in CPU-only mode without one

### 1. Clone the repo

```bash
git clone https://github.com/mbmuniversity2026/MAC.git
cd MAC
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set MAC_SECRET_KEY to any random string (required)
# Everything else has sensible defaults for a first run
```

### 3. Start the platform

**Windows (one double-click):**
```
start-mac.bat
```

**Linux / Mac:**
```bash
docker compose up -d
```

### 4. Open in browser

```
http://localhost
```

Default dev accounts (only created when `MAC_ENV=development`):

| Role | Username | Password |
|------|----------|----------|
| Admin | abhisek.cse@mbm.ac.in | Admin@1234 |
| Faculty | raj.cse@mbm.ac.in | Faculty@1234 |
| Student | 21CS045 | Student@1234 |

---

## MBM Book IDE

MBM Book is the built-in cloud IDE — each user gets their own isolated Docker container with:

- **Monaco Editor** (VS Code engine) with multi-tab support, syntax highlighting, and IntelliSense
- **Integrated terminal** with full PTY, ANSI colours, command history
- **Resizable panels** — file explorer, editor, terminal
- **Multi-language support**: Python 3.11, Node.js 20, Java 17, Go 1.22, Rust 1.95, C/C++, Ruby, PHP

### Build the workspace image (first time only)

```bash
docker build -t mbmbook-workspace:latest -f docker/workspace/Dockerfile.lite docker/workspace/
```

This builds a ~6 GB image with all language runtimes. Takes ~5 minutes.

---

## Project Structure

```
MAC/
├── mac/                    # FastAPI backend
│   ├── main.py             # App factory, 30+ routers
│   ├── models/             # SQLAlchemy ORM models
│   ├── routers/            # REST + WebSocket route modules
│   ├── services/           # Business logic
│   └── schemas/            # Pydantic request/response schemas
├── frontend/               # Vanilla JS SPA (no build step)
│   ├── index.html
│   ├── style.css
│   └── js/                 # 15+ modular JS files
├── docker/
│   └── workspace/          # MBM Book workspace Docker image
├── alembic/                # Database migrations
├── nginx/                  # Reverse proxy config
├── .claude/                # AI assistant context & skills
│   ├── CLAUDE.md
│   ├── memory/
│   └── skills/graphify/
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── start-mac.bat
```

---

## Configuration

All settings live in `.env` (never commit this file). Key variables:

```env
MAC_ENV=development          # development | production
MAC_SECRET_KEY=changeme      # JWT signing key — CHANGE THIS
DATABASE_URL=postgresql+asyncpg://mac:mac@postgres:5432/mac
REDIS_URL=redis://redis:6379/0

# LLM inference (optional — CPU fallback if not set)
VLLM_SPEED_URL=http://vllm-speed:8001/v1
OLLAMA_URL=http://ollama:11434

# Worker cluster (optional)
CLUSTER_SECRET=your-cluster-secret
```

See `.env.example` for the full reference (230+ variables with comments).

---

## Multi-PC Cluster (GPU Pool)

MAC supports a 3-PC cluster where each machine contributes GPU capacity:

```
PC1 (Host)    — start-mac.bat          — runs all services + Qwen2.5-7B chat
PC2 (Worker)  — start-mac-worker.bat   — Mistral-7B creative chat
PC3 (Worker)  — start-mac-worker.bat   — Qwen2-VL-7B vision model
```

Workers join via `start-mac-worker.bat` — they auto-register with the host. The admin dashboard shows all nodes and their GPU utilisation.

---

## Contributing

We welcome contributions from MBM students, alumni, and anyone who believes AI tools should be accessible to every student regardless of internet access.

### Step-by-step guide

**1. Fork the repository**

Click the **Fork** button at the top of this page to get your own copy.

**2. Clone your fork**

```bash
git clone https://github.com/<your-username>/MAC.git
cd MAC
```

**3. Create a branch**

Use a descriptive name — `feature/`, `fix/`, or `docs/` prefix:

```bash
git checkout -b feature/my-awesome-feature
```

**4. Set up the dev environment**

```bash
cp .env.example .env
docker compose up -d postgres redis
# Backend hot-reload (no build needed for Python changes):
pip install -r requirements.txt
uvicorn mac.main:app --reload
```

Frontend changes are instant — just edit `frontend/js/*.js` and reload the browser. No bundler, no build step.

**5. Make your changes**

- **Backend**: add routes in `mac/routers/`, services in `mac/services/`
- **Frontend**: edit `frontend/js/` (vanilla JS, no framework)
- **Database**: add models in `mac/models/`, then `alembic revision --autogenerate -m "description"`
- **Tests**: add to `tests/` and run `pytest`

**6. Commit with a clear message**

```bash
git add .
git commit -m "feat: add X feature for Y reason"
```

Commit format: `type: short description`
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

**7. Push and open a Pull Request**

```bash
git push origin feature/my-awesome-feature
```

Then open a PR against `main` on GitHub. Describe **what** changed and **why**.

### What to work on

- Check the [Issues](https://github.com/mbmuniversity2026/MAC/issues) tab for open tasks
- Look for `good first issue` labels if you're new
- Ideas: more language support in notebooks, better mobile UI, Ollama model installer

### Code style

- Python: follow existing patterns, use `async/await` throughout, type hints encouraged
- JavaScript: vanilla JS, no frameworks, keep it readable
- No AI-generated boilerplate — write code you understand

---

## License

[MBM Open License](LICENSE) — free to use, study, and modify for educational and non-commercial purposes. See `LICENSE` for full terms.

---

## Contact

- Email: mbmuniversity2026@gmail.com
- GitHub: [@mbmuniversity2026](https://github.com/mbmuniversity2026)
- Institution: MBM University (Mugneeram Bangur Memorial University), Jodhpur, Rajasthan, India
