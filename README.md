<p align="center">
  <img src="frontend/icons/icon-512.png" alt="MAC Logo" width="120" height="120" />
</p>

<h1 align="center">MAC — MBM AI Cloud</h1>

<p align="center">
  <strong>Self-Hosted AI Inference Platform for MBM University, Jodhpur</strong><br/>
  Built by MBM, for MBM. Runs fully offline on the campus LAN.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-blue?logo=python" alt="Python"/>
  <img src="https://img.shields.io/badge/FastAPI-0.110-green?logo=fastapi" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/PostgreSQL-16-blue?logo=postgresql" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker" alt="Docker"/>
  <img src="https://img.shields.io/badge/License-MBM_Open-orange" alt="MBM Open License"/>
</p>

---

## What is MAC?

MAC (MBM AI Cloud) is an **on-premise AI platform** purpose-built for MBM University, Jodhpur. It provides students and faculty with access to large language models, AI tools, and learning resources — entirely within the college network, with no data leaving campus.

> This is **not** an Apple Inc. product. MAC stands for **MBM AI Cloud**.

---

## Features

| Feature | Description |
|---|---|
| **AI Chat** | Multi-session chat with LLMs via vLLM / Ollama — streaming responses |
| **RAG / File Context** | Attach PDFs, DOCX, TXT files to inject into chat context |
| **MBM Book** | Jupyter-style computational notebooks, persistent and shareable |
| **Doubts Forum** | Q&A board for students to post and resolve academic doubts |
| **Attendance** | Faculty-managed attendance tracking with export |
| **Copy Check** | Plagiarism detection across student submissions |
| **File Share** | Secure intra-campus file sharing between students and faculty |
| **Multi-Language UI** | 19 Indian and regional languages — fully offline i18n |
| **PWA** | Installable on mobile and desktop, works offline |
| **Admin Panel** | User management, feature flags, quota, node monitoring |

---

## Tech Stack

- **Backend**: FastAPI (Python 3.11), PostgreSQL 16, Redis 7, Qdrant (vector DB), SearXNG
- **AI Inference**: vLLM + Ollama (GPU / CPU nodes)
- **Frontend**: Vanilla JS SPA — no build step, no framework, no Node.js
- **Auth**: JWT (RS256), role-based access (student / faculty / admin)
- **Deployment**: Docker Compose, Nginx reverse proxy
- **i18n**: 19-language offline system (en, hi, raj, gu, mr, pa, bn, ta, te, kn, ml, or, as, ur, ne, si, kok, mai, bho)

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- GPU node(s) with Ollama or vLLM running (or CPU for small models)

### 1. Clone

```bash
git clone https://github.com/mbmuniversity2026/MAC.git
cd MAC
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env: set SECRET_KEY, DATABASE_URL, REDIS_URL, etc.
```

### 3. Start

```bash
docker compose up -d
```

The app will be available at `http://localhost` (or your server IP on the campus LAN).

### 4. First Admin Account

On first run, use the setup endpoint to create your admin account:

```
POST /api/v1/setup/init
```

Or use the CLI:

```bash
docker compose exec mac python -m mac.scripts.create_admin
```

---

## Development

```bash
# Backend only (hot-reload)
docker compose up mac postgres redis

# Frontend: just edit files in frontend/ — nginx serves them directly, no build step
# Reload the browser after changes
```

---

## Project Structure

```
MAC/
├── mac/                  # FastAPI backend
│   ├── routers/          # API route handlers
│   ├── models/           # SQLAlchemy ORM models
│   ├── services/         # Business logic
│   ├── schemas/          # Pydantic schemas
│   └── middleware/       # Auth, rate-limit, feature gates
├── frontend/             # Vanilla JS SPA
│   ├── app.js            # Entire frontend (~250 KB)
│   ├── style.css         # All styles
│   ├── index.html        # Shell HTML
│   └── js/
│       ├── i18n.js       # 19-language offline translations
│       └── auth.js       # Auth page (physics watermark, floating labels)
├── alembic/              # DB migrations
├── nginx/                # Nginx reverse proxy config
└── docker-compose.yml
```

---

## License

**MBM Open License** — Free to use within the MBM University campus network.  
&copy; 2026 MBM University, Jodhpur. All rights reserved.

---

<p align="center">
  Made with &hearts; at <strong>MBM University, Jodhpur</strong>
</p>
