"""
MAC — MBM AI Cloud
Self-hosted AI inference platform.
"""

import pathlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from mac.config import settings
from mac.database import init_db
from mac.routers import (
    auth, explore, query, usage,
    models, integration, keys, quota,
    guardrails, rag, search,
    nodes, attendance, doubts, notifications,
    scoped_keys, agent, notebooks, kernels,
    notebook_ws, copy_check,
    # ── Session 1 additions ──
    features, hardware, network, system,
    # ── Session 2 additions ──
    cluster, academic, file_share,
    # ── New features ──
    voice_chat, video, thumbnail, activity, terminal,
)
from mac.routers import setup as setup_router  # avoid shadowing the `setup` name

FRONTEND_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown events."""
    # Import all models so Base.metadata knows about them
    import mac.models.user  # noqa: F401
    import mac.models.guardrail  # noqa: F401
    import mac.models.quota  # noqa: F401
    import mac.models.rag  # noqa: F401
    import mac.models.node  # noqa: F401
    import mac.models.attendance  # noqa: F401
    import mac.models.doubt  # noqa: F401
    import mac.models.notification  # noqa: F401
    import mac.models.agent  # noqa: F401
    import mac.models.notebook  # noqa: F401
    import mac.models.model_submission  # noqa: F401
    import mac.models.copy_check  # noqa: F401
    # ── Session 1 ──
    import mac.models.feature_flag  # noqa: F401
    import mac.models.academic  # noqa: F401
    import mac.models.cluster  # noqa: F401
    import mac.models.file_share  # noqa: F401
    import mac.models.video  # noqa: F401
    import mac.models.system_config  # noqa: F401
    # ── New models ──
    import mac.models.video  # noqa: F401 (VideoProject, VideoJob)

    # Create tables (dev only — production uses Alembic)
    if settings.is_dev:
        await init_db()
        # Seed a test user if DB is empty
        await _seed_dev_user()

    # Seed feature flags (idempotent, runs every startup)
    from mac.database import async_session
    from mac.services import feature_seeder, setup_service
    try:
        async with async_session() as db:
            await feature_seeder.seed_default_flags(db)
            # Always ensure a JWT secret exists so logins work after any restart.
            await setup_service.get_or_generate_jwt_secret(db)
            await db.commit()
    except Exception as e:  # noqa: BLE001
        print(f"  [STARTUP] Feature/JWT seed skipped: {e}")

    # Background tasks
    import asyncio as _asyncio
    from mac.services import updater as _updater
    from mac.services import discovery as _discovery
    bg_tasks: list = []
    try:
        bg_tasks.append(_asyncio.create_task(_updater.background_check_loop()))
        bg_tasks.append(_asyncio.create_task(_discovery.start_discovery_server()))
    except Exception as e:  # noqa: BLE001
        print(f"  [STARTUP] Background tasks failed to start: {e}")

    yield

    # ── Shutdown ──
    for t in bg_tasks:
        t.cancel()
    for t in bg_tasks:
        try:
            await t
        except _asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001
            pass


app = FastAPI(
    title="MAC — MBM AI Cloud",
    description="Self-hosted AI inference platform for MBM Engineering College. "
                "OpenAI-compatible API powered by open-source models.",
    version="0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers under /api/v1
app.include_router(auth.router, prefix="/api/v1")
app.include_router(explore.router, prefix="/api/v1")
app.include_router(query.router, prefix="/api/v1")
app.include_router(usage.router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")
app.include_router(integration.router, prefix="/api/v1")
app.include_router(keys.router, prefix="/api/v1")
app.include_router(quota.router, prefix="/api/v1")
app.include_router(guardrails.router, prefix="/api/v1")
app.include_router(rag.router, prefix="/api/v1")
app.include_router(search.router, prefix="/api/v1")
app.include_router(nodes.router, prefix="/api/v1")
app.include_router(attendance.router, prefix="/api/v1")
app.include_router(doubts.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(scoped_keys.router, prefix="/api/v1")
app.include_router(agent.router, prefix="/api/v1")
app.include_router(notebooks.router, prefix="/api/v1")
app.include_router(kernels.router, prefix="/api/v1")
app.include_router(notebook_ws.router)
app.include_router(copy_check.router, prefix="/api/v1")

# ── Session 1 routers ──
app.include_router(features.router, prefix="/api/v1")
app.include_router(features.admin_router, prefix="/api/v1")
app.include_router(hardware.router, prefix="/api/v1")
app.include_router(network.router, prefix="/api/v1")
app.include_router(system.router, prefix="/api/v1")
app.include_router(system.admin_router, prefix="/api/v1")
app.include_router(setup_router.router, prefix="/api/v1")

# ── Session 2 routers ──
app.include_router(cluster.router, prefix="/api/v1")
app.include_router(academic.router, prefix="/api/v1")
app.include_router(file_share.router, prefix="/api/v1")

# ── New feature routers ──
app.include_router(voice_chat.router, prefix="/api/v1")
app.include_router(video.router, prefix="/api/v1")
app.include_router(thumbnail.router, prefix="/api/v1")
app.include_router(activity.router, prefix="/api/v1")
app.include_router(terminal.router)

# Serve vanilla JS frontend static files
if FRONTEND_DIR.exists():
    # /static/* → served from frontend/ (index.html, app.js, style.css, libs/, etc.)
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


# ── Rate-limit header injection ─────────────────────────

@app.middleware("http")
async def inject_rate_limit_headers(request: Request, call_next):
    response = await call_next(request)
    headers = getattr(request.state, "rate_limit_headers", None)
    if headers:
        for key, value in headers.items():
            response.headers[key] = value
    return response


# ── Global error handler ────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": str(exc) if settings.is_dev else "An internal error occurred",
                "status": 500,
            }
        },
    )


# ── Root ─────────────────────────────────────────────────

@app.get("/")
async def root():
    from mac.services.model_service import ensure_prefetch_started
    await ensure_prefetch_started()

    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {
        "name": "MAC — MBM AI Cloud",
        "version": "0.0",
        "docs": "/docs",
        "api": "/api/v1",
    }


# ── Health check ─────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}


# ── API root — must be before catch-all ──────────────────────
@app.get("/api/v1")
async def api_root():
    from mac.services.model_service import ensure_prefetch_started
    await ensure_prefetch_started()

    return {
        "message": "MAC API v1",
        "endpoints": {
            "auth": "/api/v1/auth",
            "explore": "/api/v1/explore",
            "query": "/api/v1/query",
            "usage": "/api/v1/usage",
            "models": "/api/v1/models",
            "integration": "/api/v1/integration",
            "keys": "/api/v1/keys",
            "quota": "/api/v1/quota",
            "guardrails": "/api/v1/guardrails",
            "rag": "/api/v1/rag",
            "search": "/api/v1/search",
            "nodes": "/api/v1/nodes",
            "attendance": "/api/v1/attendance",
            "doubts": "/api/v1/doubts",
            "notifications": "/api/v1/notifications",
            "scoped_keys": "/api/v1/scoped-keys",
            "agent": "/api/v1/agent",
            "features": "/api/v1/features",
            "hardware": "/api/v1/hardware",
            "network": "/api/v1/network",
            "system": "/api/v1/system",
            "setup": "/api/v1/setup",
            "cluster": "/api/v1/cluster",
            "academic": "/api/v1/academic",
            "files": "/api/v1/files",
        }
    }


# ── SPA catch-all: serve index.html for all frontend routes ──
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """Serve SPA index.html for any non-API frontend route."""
    # Don't intercept API, docs, static, or nginx-served special pages
    if full_path.startswith(("api/", "docs", "redoc", "openapi.json", "static/", "ws/")) or full_path in ("install-cert", "ca.crt", "join", "manifest.json", "sw.js", "nginx-health", "health"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(status_code=404, content={"detail": "Not found"})


# ── Dev seed ─────────────────────────────────────────────

async def _seed_dev_user():
    """Seed 3 accounts: admin, faculty, student."""
    from datetime import date
    from mac.database import async_session
    from mac.services.auth_service import get_user_by_roll, create_user, get_registry_entry
    from mac.models.user import StudentRegistry

    try:
        async with async_session() as db:
            # ── 1) Super Admin: Prof. Abhishek Gaur ───────────
            if not await get_user_by_roll(db, "abhisek.cse@mbm.ac.in"):
                admin = await create_user(
                    db,
                    roll_number="abhisek.cse@mbm.ac.in",
                    name="Prof. Abhishek Gaur",
                    password="Admin@1234",
                    department="CSE",
                    role="admin",
                    must_change_password=False,
                    email="abhisek.cse@mbm.ac.in",
                )
                print(f"  [SEED] Admin: {admin.roll_number} / Admin@1234")
                print(f"  [SEED] Admin API key: {admin.api_key}")

            # ── 2) Faculty: Dr. Raj Kumar ─────────────────────
            if not await get_user_by_roll(db, "raj.cse@mbm.ac.in"):
                fac = await create_user(
                    db,
                    roll_number="raj.cse@mbm.ac.in",
                    name="Dr. Raj Kumar",
                    password="Faculty@1234",
                    department="CSE",
                    role="faculty",
                    must_change_password=False,
                    email="raj.cse@mbm.ac.in",
                )
                print(f"  [SEED] Faculty: {fac.roll_number} / Faculty@1234")

            # ── 3) Student: Aaryan Rajput ─────────────────────
            registry_entries = [
                ("abhisek.cse@mbm.ac.in", "Prof. Abhishek Gaur", "CSE", date(1990, 1, 1), 2020, "admin", None),
                ("raj.cse@mbm.ac.in", "Dr. Raj Kumar", "CSE", date(1985, 6, 15), 2018, "faculty", None),
                ("21CS045", "Aaryan Rajput", "CSE", date(2003, 8, 15), 2021, "student", "J2234345A"),
            ]
            for roll, name, dept, dob, batch, role, reg_no in registry_entries:
                if not await get_registry_entry(db, roll):
                    db.add(StudentRegistry(
                        roll_number=roll, name=name, department=dept, dob=dob,
                        batch_year=batch, role=role, registration_number=reg_no,
                    ))

            if not await get_user_by_roll(db, "21CS045"):
                stu = await create_user(
                    db,
                    roll_number="21CS045",
                    name="Aaryan Rajput",
                    password="Student@1234",
                    department="CSE",
                    role="student",
                    must_change_password=False,
                )
                print(f"  [SEED] Student: {stu.roll_number} / Student@1234")

            await db.commit()
            print("  [SEED] All 3 accounts seeded (admin / faculty / student)")
    except Exception as e:
        # Race condition: another worker already seeded
        print(f"  [SEED] Skipped (already seeded or race): {e}")
