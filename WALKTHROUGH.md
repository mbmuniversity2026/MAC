# MAC — MBM AI Cloud · Complete Agent Walkthrough
> **Project**: Self-hosted AI inference platform for MBM Engineering College (University of Jodhpur), Rajasthan, India.
> **Version**: 1.0.0 · **Stack**: FastAPI · PostgreSQL 16 · Redis 7 · Qdrant · SearXNG · vLLM/Ollama · Vanilla JS SPA · Nginx · Docker Compose
> **Repo**: https://github.com/mbmuniversity2026/MAC.git
> **Local path**: `D:\NEWmac`

---

## 1. What MAC Is

MAC (MBM AI Cloud) is a **self-hosted, college-wide AI platform** that runs entirely on the university's own GPU server. No cloud, no OpenAI keys needed.

Core capabilities:
- **AI Chat** — multi-turn conversation (streaming + non-streaming) via local vLLM inference
- **Web Search in Chat** — SearXNG-backed grounding
- **RAG (Document Chat)** — upload PDFs/text → embed → Qdrant → retrieve during chat
- **MBM Book (Notebooks)** — Kaggle/Colab-style notebooks with Monaco VS Code editor, 25+ language kernels, WebSocket-based real-time streaming output
- **Copy Check** — answer-sheet plagiarism / evaluation engine
- **Attendance** — QR-based or manual attendance recording
- **Doubts Forum** — student Q&A forum
- **File Sharing** — admin uploads shared files, students download
- **Model Registry** — community model submission/management
- **Cluster Management** — enrol GPU worker nodes, deploy models across them
- **Admin Panel** — full user/role/registry management, feature flags, quotas, system config
- **Hardware Monitor** — GPU/CPU/RAM live stats
- **Network Tools** — speed test, QR wifi join
- **Academic Structure** — branches, sections, year assignment per student

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Python 3.11 · FastAPI 0.115 · Uvicorn (async) |
| Database | PostgreSQL 16 via SQLAlchemy 2.0 async (asyncpg) |
| Cache / Rate-limit | Redis 7 |
| Vector DB (RAG) | Qdrant |
| Web Search | SearXNG (self-hosted) |
| LLM Inference | vLLM (GPU) — primary; Ollama fallback |
| STT | faster-whisper (CPU) |
| TTS | Piper TTS via openedai-speech (CPU, optional) |
| Frontend | Vanilla JS SPA — **no build step, no framework** |
| Editor | Monaco Editor 0.52.2 (VS Code engine) via CDN |
| Reverse Proxy | Nginx Alpine |
| Containerisation | Docker Compose (Windows host, D:\NEWmac) |
| Migrations | Alembic |
| Auth | JWT (HS256) + bcrypt + scoped API keys |

### GPU Setup (production)
- **RTX 3060 12 GB VRAM** — single-model strategy
- Running: Qwen2.5-7B-Instruct-AWQ (chat + code + general, ~5 GB VRAM)
- `--gpu-memory-utilization 0.85`, `--max-model-len 8192`

---

## 3. Repository Structure

```
D:\NEWmac/
├── docker-compose.yml          # Production compose (mac, nginx, postgres, redis, qdrant, searxng, vllm)
├── docker-compose.worker.yml   # Worker-node compose (for extra GPU machines)
├── Dockerfile                  # python:3.11-slim → installs requirements, copies code
├── alembic.ini
├── requirements.txt
├── start-mac.bat / stop-mac.bat
├── mac-installer.iss           # Inno Setup installer script (Windows deployment)
├── nginx/
│   ├── nginx.conf              # HTTP (port 80) — production
│   └── nginx.https.conf        # HTTPS with Let's Encrypt
├── frontend/
│   ├── index.html              # Entry point — loads all scripts
│   ├── app.js                  # ~300KB — ENTIRE SPA (router, all page renders, all logic)
│   ├── style.css               # All CSS (~2000+ lines)
│   ├── sw.js                   # Service worker (PWA offline)
│   ├── manifest.json           # PWA manifest
│   ├── js/
│   │   ├── auth.js             # Auth helpers (login/signup/verify UI)
│   │   └── i18n.js             # Internationalisation strings
│   └── libs/                   # Bundled JS libs (offline-ready)
│       ├── chart.umd.min.js
│       ├── highlight.min.js + hljs-*.min.js (7 languages)
│       ├── mermaid.min.js
│       └── github-dark.min.css
├── mac/
│   ├── main.py                 # FastAPI app factory, lifespan, router mounting
│   ├── config.py               # Pydantic Settings (all env vars, see §5)
│   ├── database.py             # SQLAlchemy async engine + session factory
│   ├── VERSION                 # "1.0.0"
│   ├── middleware/
│   │   ├── auth_middleware.py  # get_current_user, require_admin, require_faculty_or_admin
│   │   ├── feature_gate.py     # feature_required("key") dependency factory
│   │   └── rate_limit.py       # Redis-backed per-user rate limiting
│   ├── models/                 # SQLAlchemy ORM models (all listed in §6)
│   ├── routers/                # FastAPI routers (all listed in §7)
│   ├── schemas/                # Pydantic request/response schemas
│   ├── services/               # Business logic (all listed in §8)
│   └── utils/
│       └── security.py         # JWT encode/decode, password hash/verify
├── alembic/
│   └── versions/
│       ├── 20260426_0001_initial_schema.py  # Full DB bootstrap
│       ├── 20260427_0002_session1_tables.py  # Session 1 tables
│       ├── 20260427_0003_file_share_node_columns.py
│       └── 20260428_0004_registry_role.py   # Added role column to student_registry
└── tests/
    ├── conftest.py
    └── test_*.py               # 16 test modules
```

---

## 4. Docker Services

All services are on a shared Docker network `mac-net`.

| Container | Image | Port (host→container) | Purpose |
|---|---|---|---|
| `mac-api` | Built from `Dockerfile` | `8001→8000` | FastAPI backend |
| `mac-nginx` | `nginx:alpine` | `80→80` | Reverse proxy + static frontend |
| `mac-postgres` | `postgres:16-alpine` | `5433→5432` | PostgreSQL |
| `mac-redis` | `redis:7-alpine` | `6380→6379` | Redis |
| `mac-qdrant` | `qdrant/qdrant:latest` | `6333→6333` | Vector DB |
| `mac-searxng` | `searxng/searxng:latest` | `8888→8080` | Web search |
| `mac-vllm-speed` | `vllm/vllm-openai:latest` | `8001→8001` | GPU inference |
| `mac-whisper` | `fedirz/faster-whisper-server:latest-cpu` | `8005→8000` | STT |
| `mac-pgadmin` | `dpage/pgadmin4:8` | `127.0.0.1:5051→80` | DB admin UI |

**Volumes**: `pgdata`, `redisdata`, `qdrantdata`, `hf-cache`, `tts-voices`, `pgadmin-data`

### Starting / Stopping
```bash
docker compose up -d                    # start all
docker compose up -d mac                # restart just the API
docker compose build mac                # rebuild image
docker exec mac-api alembic upgrade head  # run migrations
```

---

## 5. Configuration (`.env`)

Key variables (all in `mac/config.py` as Pydantic Settings):

```env
MAC_ENV=production           # development | production
DATABASE_URL=postgresql+asyncpg://mac:mac_password@postgres:5432/mac_db
REDIS_URL=redis://redis:6379/0
JWT_SECRET_KEY=<random 64-char hex>
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440    # 24h
VLLM_BASE_URL=http://vllm-speed:8001
VLLM_SPEED_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ
WHISPER_URL=http://whisper:8000
QDRANT_URL=http://qdrant:6333
SEARXNG_URL=http://searxng:8080
MAC_ENABLED_MODELS=qwen2.5:7b,whisper-small,tts-piper
MAC_DEV_MODE=false           # true = mock LLM streaming (no GPU needed)
RATE_LIMIT_REQUESTS_PER_HOUR=100
RATE_LIMIT_TOKENS_PER_DAY=50000
KERNEL_TIMEOUT=120
APP_PORT=80
```

---

## 6. Database Models (`mac/models/`)

| File | Table(s) | Description |
|---|---|---|
| `user.py` | `student_registry`, `users`, `refresh_tokens`, `usage_logs` | Core auth tables |
| `guardrail.py` | `guardrail_rules` | Content safety rules |
| `quota.py` | `quota_overrides` | Per-user token/request overrides |
| `rag.py` | `rag_collections`, `rag_documents` | RAG document store |
| `node.py` | `worker_nodes`, `enrollment_tokens`, `model_deployments` | Cluster nodes |
| `attendance.py` | `attendance_sessions`, `attendance_records` | QR attendance |
| `doubt.py` | `doubt_posts`, `doubt_answers` | Forum |
| `notification.py` | `notifications`, `audit_logs` | Notifications + audit |
| `agent.py` | `agent_configs`, `agent_conversations` | Custom AI agents |
| `notebook.py` | `notebooks`, `notebook_cells` | Notebook storage |
| `copy_check.py` | `copy_check_jobs`, `copy_check_results` | Plagiarism check |
| `model_submission.py` | `model_submissions` | Community model uploads |
| `feature_flag.py` | `feature_flags` | Feature toggles |
| `academic.py` | `branches`, `sections` | Academic structure |
| `cluster.py` | `cluster_nodes` | Cluster management |
| `file_share.py` | `shared_files` | File sharing |
| `video.py` | `video_projects` | Video studio |
| `system_config.py` | `system_config` | Key-value system settings |

### Key: `users` table columns
```
id, roll_number (unique), name, email, department, role (student|faculty|admin),
password_hash, must_change_password, is_active, api_key (unique),
failed_login_attempts, locked_until,
branch_id, section_id, year,
can_create_users, is_founder,
storage_quota_mb, storage_used_mb,
cc_enabled, forced_theme,
created_at, updated_at
```

### Key: `student_registry` table columns
```
id, roll_number (unique), name, department, dob (date),
batch_year, role (student|faculty|admin)   ← added in migration 0004
```

---

## 7. Routers / API Endpoints (`mac/routers/`)

All routes are prefixed under `/api/` by nginx (nginx strips `/api` before proxying to FastAPI, which has routes at `/`).

| Router | Prefix | Key Endpoints |
|---|---|---|
| `setup.py` | `/setup` | `GET /status`, `POST /create-admin`, `GET /recovery` |
| `auth.py` | `/auth` | `POST /verify`, `POST /login`, `POST /refresh`, `POST /signup`, `GET /me`, `PATCH /me`, `POST /change-password`, `POST /logout`, `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/{id}`, `GET /admin/registry`, `POST /admin/registry`, `POST /admin/registry/bulk`, `POST /admin/registry/upload`, `DELETE /admin/registry/{id}`, `PATCH /admin/users/{id}/role`, `PATCH /admin/users/{id}/status` |
| `explore.py` | `/explore` | `GET /models`, `GET /models/{id}`, `GET /endpoints`, `GET /health`, `GET /usage-stats` |
| `query.py` | `/query` | `POST /chat`, `POST /completion`, `POST /embed`, `POST /rerank`, `POST /stt`, `POST /tts`, `GET /models` |
| `models.py` | `/models` | Community model listing/submission |
| `rag.py` | `/rag` | Collections CRUD, document upload/search |
| `search.py` | `/search` | Web search via SearXNG |
| `guardrails.py` | `/guardrails` | Rules CRUD (admin) |
| `quota.py` | `/quota` | Per-user quota management |
| `nodes.py` | `/nodes` | Node enrollment, heartbeat, deployment |
| `cluster.py` | `/cluster` | Cluster overview |
| `kernels.py` | `/kernels` | List/start/stop code execution kernels |
| `notebook_ws.py` | (WebSocket) | `WS /ws/notebook/{notebook_id}?token=JWT` |
| `notebooks.py` | `/notebooks` | Notebook CRUD |
| `attendance.py` | `/attendance` | Sessions, QR, record |
| `doubts.py` | `/doubts` | Post/answer/upvote |
| `notifications.py` | `/notifications` | Notification list/mark-read |
| `agent.py` | `/agent` | Custom agent configs + chat |
| `copy_check.py` | `/copy-check` | Upload answer sheets, run check |
| `features.py` | `/features` | Feature flag CRUD (admin) |
| `hardware.py` | `/hardware` | GPU/CPU/RAM stats |
| `network.py` | `/network` | Speed test, network info |
| `system.py` | `/system` | System config key-value store |
| `academic.py` | `/academic` | Branches, sections CRUD |
| `file_share.py` | `/files` | Upload/download shared files |
| `keys.py` | `/keys` | API key management |
| `scoped_keys.py` | `/scoped-keys` | Scoped API key management |
| `usage.py` | `/usage` | Usage logs and analytics |
| `integration.py` | `/integration` | External integration endpoints |
| `setup.py` | `/setup` | First-boot setup |

---

## 8. Services (`mac/services/`)

| Service | Purpose |
|---|---|
| `auth_service.py` | User creation, login, token generation, registry lookup |
| `llm_service.py` | LLM proxy — routes to correct vLLM instance, streaming |
| `kernel_manager.py` | Multi-language code execution engine (Docker + subprocess fallback) |
| `kernel_registry.py` | Language definitions — 25+ languages with Docker images and run commands |
| `rag_service.py` | Document ingestion, chunking, Qdrant embedding + retrieval |
| `guardrail_service.py` | Content safety check against DB rules |
| `feature_flag_service.py` | Read/write feature flags with Redis caching |
| `feature_seeder.py` | Idempotent seed of 15 default feature flags on startup |
| `setup_service.py` | First-boot admin creation, JWT secret generation |
| `node_service.py` | Worker node enrollment, heartbeat processing, model deployment |
| `notebook_service.py` | Notebook + cell CRUD |
| `notification_service.py` | Notification creation, audit logging |
| `agent_service.py` | Custom AI agent management |
| `attendance_service.py` | QR generation, session management |
| `doubt_service.py` | Forum post/answer logic |
| `usage_service.py` | Token/request usage logging and quota checks |
| `scoped_key_service.py` | Scoped API key creation and validation |
| `search_service.py` | SearXNG proxy |
| `hardware.py` | psutil + GPUtil hardware metrics |
| `network_info.py` | Network interface detection, speed test |
| `load_balancer.py` | Distribute requests across vLLM backends |
| `model_service.py` | Model registry management |
| `model_submission_service.py` | Community model submissions |
| `copy_check_service.py` | Plagiarism detection |
| `ssl_generator.py` | Self-signed SSL cert generation |
| `token_blacklist_service.py` | JWT blacklist (logout) via Redis |
| `updater.py` | Background GitHub release check loop |
| `discovery.py` | UDP broadcast for LAN node discovery |

---

## 9. Authentication System

### Flow
1. **First boot**: `POST /setup/create-admin` → creates founder admin account
2. **Student/Faculty sign-up**: Admin bulk-imports registry (`POST /auth/admin/registry/bulk`). Student goes to sign-up, enters roll number + DOB. `POST /auth/verify` checks registry, creates account with `must_change_password=True`. Client detects flag → forces password change page.
3. **Login**: `POST /auth/login` → `{access_token, refresh_token, must_change_password, user}`
4. **Token refresh**: `POST /auth/refresh`
5. **All protected routes**: `Authorization: Bearer <access_token>` OR `Authorization: Bearer mac_sk_live_<hex>` (API key) OR `Authorization: Bearer mac_sk_<hex>` (scoped key)

### Roles
- `student` — can use AI chat, notebooks, RAG, forum, attendance, etc.
- `faculty` — additionally has copy check access
- `admin` — full access including user management, feature flags, node management

### Middleware
- `get_current_user` — validates JWT/API key, returns `User` object
- `require_admin` — raises 403 if `user.role != "admin"`
- `require_faculty_or_admin` — raises 403 if role is student
- `feature_required("key")` — raises 403 if feature flag disabled for user's role
- `check_rate_limit` — Redis sliding window (per user: 100 req/hr, 50k tokens/day)

---

## 10. Notebook System (MBM Book)

### Architecture
- Cells stored client-side in `_nbState` JS object, persisted via `localStorage` as JSON
- WebSocket connection to `/ws/notebook/{notebook_id}?token=<JWT>`
- Backend receives `{type: "execute", cell_id, code, language}` messages
- Backend streams back `{type: "stream"/"error"/"status", ...}` messages

### WebSocket Protocol
```
Client → Server:
  { type: "execute", cell_id: "uuid", code: "...", language: "python" }
  { type: "interrupt", kernel_id: "..." }
  { type: "ping" }

Server → Client:
  { type: "status",  cell_id: "...", execution_state: "busy|idle" }
  { type: "stream",  cell_id: "...", name: "stdout|stderr", text: "..." }
  { type: "error",   cell_id: "...", ename: "...", evalue: "...", traceback: [...] }
  { type: "pong" }
```

### Supported Languages (25+)
python, javascript, typescript, r, julia, ruby, php, c, cpp, java, go, rust, csharp, kotlin, scala, swift, bash, sql, lua, matlab/octave, haskell, perl, zig, html, markdown

### Monaco Editor Integration
- Loaded from CDN: `https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js`
- Loaded lazily via AMD (`require(['vs/editor/editor.main']`)
- Each code cell textarea is replaced by a Monaco editor instance
- `_nbEditors = {}` — map of `cellId → monaco.editor.IStandaloneCodeEditor`
- Language select change → `monaco.editor.setModelLanguage(editor.getModel(), lang)`
- Theme change → `monaco.editor.setTheme('vs-dark' | 'vs')`
- All editors disposed before DOM rebuild (`_nbDisposeEditors()`)
- Shift+Enter → run cell; Escape → blur editor
- **Fullscreen mode**: each cell has a ⤢ button → `_nbOpenFullscreen(cellId)`
  - Code cells: full-screen Monaco + output panel + Run button
  - Markdown cells: split-pane (editor left, live preview right)
  - Changes sync back to main cell in real time

### Monaco Language ID Map
```js
python→python, javascript→javascript, typescript→typescript,
c→c, cpp→cpp, java→java, go→go, rust→rust, csharp→csharp,
ruby→ruby, php→php, lua→lua, bash→shell, sql→sql, html→html,
css→css, kotlin→kotlin, scala→scala, swift→swift,
r→r, julia→julia, markdown→markdown, *→plaintext
```

---

## 11. Frontend SPA (`frontend/app.js`)

Single file ~300KB+. No framework, no build step. Loaded by nginx at `/static/app.js`.

### Key Global State
```js
let state = { token, user, page }   // app state
let _nbState = {                     // notebook state
  notebooks, current, cells, ws,
  executingCells (Set), outputs,
  kernelId, sidebarOpen
}
let _nbEditors = {}                  // cellId → monaco editor instance
let _monacoPromise = null           // singleton load promise
```

### localStorage Keys
| Key | Value | Purpose |
|---|---|---|
| `mac_token` | JWT string | Auth persistence |
| `mac_theme` | `warm`/`dark`/`light` | Theme |
| `mac_dock_side` | `left`/`right` | Sidebar dock position |
| `mac_last_page` | page name | Navigate to on refresh |
| `mac_sidebar_width` | pixels | Sidebar width persistence |
| `mac_sidebar_height` | pixels | Sidebar height (mobile) |
| `mac_sidebar_compact` | `1` | Compact sidebar mode |
| `mac_admin_tab` | tab name | Admin panel active tab persistence |
| `mac_reg_tab` | `student`/`faculty`/`admin` | Registry sub-tab persistence |

### Key Functions
| Function | Purpose |
|---|---|
| `navigate(page)` | SPA router — pushState, render, dispose Monaco on page leave |
| `render()` | Main render dispatch — calls page-specific render function |
| `shell()` | Renders app chrome (sidebar, header) |
| `applyTheme(theme)` | Apply CSS theme + sync Monaco editor theme |
| `renderAdmin()` | Admin panel with 6 tabs: Overview, Users, Registry, Features, Quota, System |
| `renderAdminRegistry()` | 3-tab registry: Students / Faculty / Admins |
| `renderNotebooks()` | Full notebook IDE render |
| `_nbInitMonacoEditors()` | Replace textareas with Monaco instances |
| `_nbOpenFullscreen(cellId)` | Open fullscreen cell overlay |
| `_nbRefreshCells()` | Dispose editors → re-render cells → re-init Monaco |
| `_nbConnectWs()` | Connect WebSocket for notebook execution |
| `_nbExecCell(cellId)` | Send execute message via WebSocket |
| `formatMd(text)` | Render markdown (highlight.js + mermaid) |
| `api(path, opts)` | Authenticated fetch wrapper |
| `apiJson(path, opts)` | api() + JSON parse |
| `esc(str)` | HTML escape |

### Page Names (routes)
`dashboard`, `query`, `explore`, `notebooks`, `rag`, `search`, `attendance`, `doubts`, `copy-check`, `files`, `models`, `keys`, `nodes`, `cluster`, `hardware`, `network`, `academic`, `notifications`, `agent`, `usage`, `admin`, `settings`, `set-password`, `login`

### Theme System
- CSS variable-based, set via `data-theme` attribute on `<html>`
- Themes: `warm` (default, warm white), `dark` (full dark), `light` (pure light)
- Monaco tracks theme: `warm`/`light` → `vs`, `dark` → `vs-dark`

### Sidebar
- Left/right dock, collapsible, resizable (drag handle)
- Width persisted in localStorage, restored on `shell()` as inline style
- Mobile: CSS `transform: translateX(-100%)` slide-in with blur backdrop

---

## 12. Feature Flags (15 default)

Managed in DB table `feature_flags`, seeded idempotently on startup.

| Key | Label | Default Roles |
|---|---|---|
| `ai_chat` | AI Chat | student, faculty, admin |
| `web_search` | Web Search in Chat | student, faculty, admin |
| `image_gen` | Image Generation | student, faculty, admin |
| `voice_input` | Voice Input (STT) | student, faculty, admin |
| `tts_output` | Text-to-Speech | student, faculty, admin |
| `mbm_book` | MBM Book (Notebooks) | student, faculty, admin |
| `rag_upload` | Document Upload | student, faculty, admin |
| `copy_check` | Copy Check | faculty, admin |
| `attendance` | Attendance | student, faculty, admin |
| `doubts_forum` | Doubts Forum | student, faculty, admin |
| `file_sharing` | File Sharing | student, faculty, admin |
| `community_models` | Community Models | student, faculty, admin |
| `dark_mode` | Dark Mode | student, faculty, admin |
| `guest_access` | Guest Access | (none — disabled) |
| `video_studio` | Video Studio | admin only |

---

## 13. Alembic Migrations

```
0001 — initial_schema       — full DB bootstrap (all tables)
0002 — session1_tables      — session 1 additions
0003 — file_share_node_cols — file share + node column additions
0004 — registry_role        — role column (VARCHAR 20, default 'student') on student_registry
```

Run: `docker exec mac-api alembic upgrade head`

---

## 14. Nginx Routing

```
/                   → /app (frontend root, SPA index.html fallback)
/static/*           → /app/ (frontend dir, 7-day cache)
/static/libs/*      → /app/libs/ (1-year immutable cache)
/sw.js              → no-cache service worker
/api/*              → proxy_pass mac:8000 (rate-limited 10 req/s, burst 20)
/ws/*               → WebSocket proxy_pass mac:8000 (1h timeout)
/docs /redoc        → proxy_pass mac:8000
```

---

## 15. Security Architecture

- **JWT**: HS256, 24h access token, 30-day refresh token, blacklist via Redis on logout
- **Passwords**: bcrypt hashed; `must_change_password=True` on first login forces reset
- **Account lockout**: `failed_login_attempts` tracked; `locked_until` datetime set after repeated failures
- **Rate limiting**: Redis sliding window per user (100 req/hr, 50k tokens/day)
- **Scoped API keys**: `mac_sk_<hex>` — limited scope, revokable
- **Content guardrails**: Input text checked against admin-configurable rules before LLM call
- **Kernel isolation**: Code cells run in Docker containers with memory/CPU limits, or subprocess fallback in dev
- **CORS**: Configurable via `MAC_CORS_ORIGINS` env var
- **OWASP**: HTML escaping via `esc()` helper throughout frontend

---

## 16. Registry Role Separation

`student_registry` has a `role` column: `student | faculty | admin`.

- **Admin imports registry**: can set `role` per entry or in bulk JSON
- **Verify endpoint**: when a user first signs up, their role is taken from registry entry (`entry.role`)
- **Admin panel → Registry tab**: 3 sub-tabs — Students, Faculty, Admins
- **Admin promotion**: any admin can add an entry with `role=admin` to the registry; that person signs up and gets admin access immediately on first login

---

## 17. First-Boot Setup Flow

1. Navigate to `http://server-ip/`
2. If `is_first_run=true` (no users in DB), setup wizard shows
3. Admin fills name, email, password → `POST /setup/create-admin` → founder admin created with `is_founder=true`
4. Admin bulk-imports student/faculty registry (CSV or JSON) via Admin Panel → Registry
5. Students/faculty navigate to `/`, enter roll number + DOB → account auto-created

---

## 18. What Has Been Built / Fixed (Session History)

### Infrastructure & Auth (Sessions 1–2)
- Full FastAPI backend with 28 routers
- PostgreSQL schema + 4 Alembic migrations
- JWT auth, scoped API keys, rate limiting, feature flags
- Admin panel: users, registry, features, quota, system config
- First-boot setup wizard
- Worker node cluster management

### Frontend Polish (Recent Sessions)
- Physics background on login page
- MAC logo responsive sizing
- Sidebar dock UX (left/right, resizable, persistent width)
- Sidebar width persistence across navigation (localStorage + restored in `shell()`)
- Mobile sidebar smooth slide-in with blurred backdrop (CSS transform)
- Admin panel tab state persistence (`mac_admin_tab` localStorage key)
- Registry role separation (Students/Faculty/Admins sub-tabs, `mac_reg_tab` key)
- Notebook duplicate close button removed

### Registry Role Separation (April 28 2026)
- `role` column added to `student_registry` model + migration 0004
- `RegistryEntryRequest` schema updated with `role` field
- Auth router: list/add/bulk/verify all use `role` from registry
- Admin registry UI rebuilt as 3-tab interface
- Verify endpoint: new users get role from their registry entry

### Monaco Editor Notebooks (April 28 2026)
- Monaco Editor 0.52.2 loaded from CDN in `index.html`
- `_loadMonaco()` — singleton AMD loader promise
- `_nbInitMonacoEditors()` — replaces textareas with Monaco instances
- `_nbDisposeEditors()` / `_nbDisposeEditor(cellId)` — memory-safe cleanup
- Language selector updates Monaco language model live
- Theme toggle syncs Monaco theme
- Monaco disposed on page navigation
- Sidebar toggle: **no re-render** — DOM class toggle only, prevents Monaco destruction
- **Fullscreen mode per cell**: `_nbOpenFullscreen(cellId)`:
  - Code cells: full-screen Monaco + output panel + Run button + language select
  - Markdown cells: split-pane (editor + live preview)
  - Changes sync back to main cell in real time
  - Escape key or × button closes fullscreen

---

## 19. Known Pending Items

- [ ] Alembic migration 0002/0003 details should be reviewed if adding new tables
- [ ] TTS (Piper) container currently disabled (commented out in compose) — slow WiFi download
- [ ] Video Studio feature only accessible to admins — UI not built yet
- [ ] Guest Access feature flag is disabled (no role has access)
- [ ] Password recovery full flow (`/setup/recovery` is localhost-only probe only)
- [ ] Mobile fullscreen cell overlay could use responsive improvements
- [ ] Monaco CDN dependency — offline fallback is textarea (functional but no syntax highlighting)

---

## 20. Developer Commands

```bash
# Start everything
docker compose up -d

# Rebuild API after code changes
docker compose build mac
docker compose up -d mac

# Run migrations
docker exec mac-api alembic upgrade head

# View API logs
docker logs mac-api -f

# Access PostgreSQL
docker exec -it mac-postgres psql -U mac -d mac_db

# Run tests
pytest tests/ -v

# Git workflow
git add -A
git commit -m "feat: description"
git push
```

---

## 21. API Base URL Pattern

From the browser: all API calls go to `/api/` (nginx strips and proxies to FastAPI).
```js
const API = '/api';  // in app.js
fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
```

From internal Docker containers: `http://mac:8000/`

---

## 22. File Encoding & Conventions

- All Python files: UTF-8
- All frontend files: UTF-8
- No TypeScript/JSX — pure JavaScript in `app.js`
- No npm/node_modules — zero build step for frontend
- CSS variables for theming: `var(--bg)`, `var(--fg)`, `var(--muted)`, `var(--border)`, `var(--primary)`, `var(--danger)`, `var(--success)`, `var(--code-bg)`, `var(--code-fg)`
- All user content HTML-escaped via `esc()` before innerHTML insertion
- `formatMd(text)` — renders Markdown with highlight.js code blocks and mermaid diagrams
