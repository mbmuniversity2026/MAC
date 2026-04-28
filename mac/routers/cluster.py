"""
Cluster management API
========================
- Workers self-register via enrollment token
- Heartbeats keep node status live
- Admins approve/reject/drain/remove nodes
- Load balancer routes LLM/notebook traffic to best worker

Architecture:
  Master node (this API) ← worker registers → approved → sends heartbeats
  Student request → load_balancer picks worker → proxied to worker's vLLM

All /cluster/* endpoints: admin-only except /cluster/register and /cluster/heartbeat
which use a shared enrollment token for worker authentication.
"""

import secrets
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from mac.database import get_db
from mac.middleware.auth_middleware import require_admin, get_current_user
from mac.models.node import WorkerNode, NodeModelDeployment, EnrollmentToken
from mac.models.cluster import ClusterHeartbeat
from mac.models.user import User
from mac.services.load_balancer import list_healthy_workers

router = APIRouter(prefix="/cluster", tags=["Cluster"])


def _utcnow():
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── Schemas ───────────────────────────────────────────────────────────────────

class EnrollTokenRequest(BaseModel):
    label: str = "Worker Node"
    expires_hours: int = Field(default=24, ge=1, le=168)


class EnrollTokenResponse(BaseModel):
    token: str
    label: str
    expires_at: str


class RegisterRequest(BaseModel):
    enrollment_token: str
    name: str
    hostname: str
    ip_address: str
    port: int = 8001
    notebook_port: Optional[int] = None
    gpu_name: Optional[str] = None
    gpu_vram_mb: Optional[int] = None
    ram_total_mb: Optional[int] = None
    cpu_cores: Optional[int] = None
    tags: Optional[str] = None  # e.g. "llm,notebook,embedding"


class RegisterResponse(BaseModel):
    node_id: str
    status: str
    message: str


class HeartbeatRequest(BaseModel):
    node_id: str
    node_token: str           # sha256 of enrollment token — proves identity
    gpu_util_pct: Optional[float] = None
    gpu_vram_used_mb: Optional[int] = None
    ram_used_mb: Optional[int] = None
    cpu_util_pct: Optional[float] = None
    active_models: list[str] = []
    queue_depth: int = 0


class DeployModelRequest(BaseModel):
    model_id: str
    served_name: str
    vllm_port: int = 8001
    gpu_memory_util: float = 0.85
    max_model_len: int = 8192


class NodeActionRequest(BaseModel):
    action: str   # approve | drain | remove | reactivate


# ── Enrollment token management (admin only) ──────────────────────────────────

@router.post("/enroll-token", response_model=EnrollTokenResponse)
async def create_enrollment_token(
    body: EnrollTokenRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate a one-time enrollment token for a new worker node."""
    raw = secrets.token_urlsafe(32)
    token_hash = _hash(raw)
    expires_at = _utcnow() + timedelta(hours=body.expires_hours)

    db.add(EnrollmentToken(
        token_hash=token_hash,
        label=body.label,
        expires_at=expires_at,
        created_by=admin.id,
    ))
    await db.commit()
    return EnrollTokenResponse(
        token=raw,
        label=body.label,
        expires_at=expires_at.isoformat(),
    )


@router.get("/enroll-tokens")
async def list_enrollment_tokens(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    tokens = (await db.execute(
        select(EnrollmentToken).order_by(EnrollmentToken.created_at.desc()).limit(50)
    )).scalars().all()
    return [
        {
            "id": t.id,
            "label": t.label,
            "used": t.used,
            "expires_at": t.expires_at.isoformat(),
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tokens
    ]


# ── Worker self-registration (uses enrollment token, no user auth) ────────────

@router.post("/register", response_model=RegisterResponse)
async def register_worker(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Worker node calls this once on startup with an enrollment token.
    Returns node_id + token the worker uses for subsequent heartbeats.
    Node starts in 'pending' status — admin must approve it.
    """
    token_hash = _hash(body.enrollment_token)
    enroll = (await db.execute(
        select(EnrollmentToken).where(
            EnrollmentToken.token_hash == token_hash,
            EnrollmentToken.used == False,
            EnrollmentToken.expires_at > _utcnow(),
        )
    )).scalar_one_or_none()

    if not enroll:
        raise HTTPException(status_code=401, detail={
            "code": "invalid_token",
            "message": "Invalid, expired, or already-used enrollment token.",
        })

    # Check if this IP already has a node (re-registration)
    existing = (await db.execute(
        select(WorkerNode).where(WorkerNode.ip_address == body.ip_address)
    )).scalar_one_or_none()

    if existing:
        # Update existing node info (node rebooted / re-registered)
        existing.hostname = body.hostname
        existing.port = body.port
        existing.notebook_port = body.notebook_port
        existing.gpu_name = body.gpu_name
        existing.gpu_vram_mb = body.gpu_vram_mb
        existing.ram_total_mb = body.ram_total_mb
        existing.cpu_cores = body.cpu_cores
        existing.tags = body.tags
        existing.status = "pending"
        node = existing
    else:
        node = WorkerNode(
            name=body.name,
            hostname=body.hostname,
            ip_address=body.ip_address,
            port=body.port,
            notebook_port=body.notebook_port,
            token_hash=token_hash,
            status="pending",
            gpu_name=body.gpu_name,
            gpu_vram_mb=body.gpu_vram_mb,
            ram_total_mb=body.ram_total_mb,
            cpu_cores=body.cpu_cores,
            tags=body.tags,
        )
        db.add(node)
        await db.flush()

    enroll.used = True
    enroll.used_by_node_id = node.id
    await db.commit()

    return RegisterResponse(
        node_id=node.id,
        status=node.status,
        message="Registration received. Awaiting admin approval." if node.status == "pending" else "Re-registered.",
    )


# ── Heartbeat (worker → master, no user auth) ─────────────────────────────────

@router.post("/heartbeat")
async def heartbeat(body: HeartbeatRequest, db: AsyncSession = Depends(get_db)):
    """
    Workers call this every 10s to report live resource usage.
    Uses node_id + hashed token for lightweight auth (no JWT overhead).
    """
    node = (await db.execute(
        select(WorkerNode).where(WorkerNode.id == body.node_id)
    )).scalar_one_or_none()

    if not node or node.token_hash != body.node_token:
        raise HTTPException(status_code=401, detail={
            "code": "auth_failed",
            "message": "Unknown node or invalid token.",
        })

    if node.status == "pending":
        raise HTTPException(status_code=403, detail={
            "code": "not_approved",
            "message": "Node not yet approved by admin.",
        })

    # Update live metrics
    node.gpu_util_pct = body.gpu_util_pct
    node.gpu_vram_used_mb = body.gpu_vram_used_mb
    node.ram_used_mb = body.ram_used_mb
    node.cpu_util_pct = body.cpu_util_pct
    node.last_heartbeat = _utcnow()

    # Record time-series heartbeat
    hb = ClusterHeartbeat(
        node_id=node.id,
        gpu_util=int(body.gpu_util_pct) if body.gpu_util_pct is not None else None,
        cpu_util=int(body.cpu_util_pct) if body.cpu_util_pct is not None else None,
        ram_used_mb=body.ram_used_mb,
        vram_used_mb=body.gpu_vram_used_mb,
        active_model=body.active_models[0] if body.active_models else None,
        queue_depth=body.queue_depth,
        recorded_at=_utcnow(),
    )
    db.add(hb)
    await db.commit()
    return {"ok": True, "status": node.status}


# ── Admin node management ─────────────────────────────────────────────────────

@router.get("/nodes")
async def list_nodes(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all cluster nodes with live health data."""
    return await list_healthy_workers(db)


@router.get("/nodes/{node_id}")
async def get_node(
    node_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy.orm import selectinload
    node = (await db.execute(
        select(WorkerNode).options(selectinload(WorkerNode.deployments))
        .where(WorkerNode.id == node_id)
    )).scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Node not found."})

    return {
        "id": node.id,
        "name": node.name,
        "hostname": node.hostname,
        "ip": node.ip_address,
        "port": node.port,
        "notebook_port": node.notebook_port,
        "status": node.status,
        "gpu_name": node.gpu_name,
        "gpu_vram_mb": node.gpu_vram_mb,
        "gpu_util_pct": node.gpu_util_pct,
        "gpu_vram_used_mb": node.gpu_vram_used_mb,
        "cpu_cores": node.cpu_cores,
        "cpu_util_pct": node.cpu_util_pct,
        "ram_total_mb": node.ram_total_mb,
        "ram_used_mb": node.ram_used_mb,
        "tags": node.tags,
        "last_heartbeat": node.last_heartbeat.isoformat() if node.last_heartbeat else None,
        "deployments": [
            {"model_id": d.model_id, "status": d.status, "port": d.vllm_port}
            for d in node.deployments
        ],
    }


@router.post("/nodes/{node_id}/action")
async def node_action(
    node_id: str,
    body: NodeActionRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Approve, drain, reactivate, or remove a node."""
    node = (await db.execute(
        select(WorkerNode).where(WorkerNode.id == node_id)
    )).scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Node not found."})

    if body.action == "approve":
        node.status = "active"
        node.enrolled_by = admin.id
    elif body.action == "drain":
        node.status = "draining"
    elif body.action == "reactivate":
        node.status = "active"
    elif body.action == "remove":
        await db.delete(node)
        await db.commit()
        return {"ok": True, "message": "Node removed."}
    else:
        raise HTTPException(status_code=400, detail={"code": "invalid_action", "message": f"Unknown action: {body.action}"})

    await db.commit()
    return {"ok": True, "node_id": node.id, "status": node.status}


# ── Model deployments ─────────────────────────────────────────────────────────

@router.post("/nodes/{node_id}/deploy")
async def deploy_model(
    node_id: str,
    body: DeployModelRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Register a model deployment on a node (after starting vLLM manually or via Docker)."""
    node = (await db.execute(
        select(WorkerNode).where(WorkerNode.id == node_id)
    )).scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Node not found."})

    deployment = NodeModelDeployment(
        node_id=node_id,
        model_id=body.model_id,
        model_name=body.model_id,
        served_name=body.served_name,
        vllm_port=body.vllm_port,
        gpu_memory_util=body.gpu_memory_util,
        max_model_len=body.max_model_len,
        status="ready",
        deployed_by=admin.id,
    )
    db.add(deployment)
    await db.commit()
    return {"ok": True, "deployment_id": deployment.id}


@router.delete("/nodes/{node_id}/deploy/{deployment_id}")
async def remove_deployment(
    node_id: str,
    deployment_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    dep = (await db.execute(
        select(NodeModelDeployment).where(
            NodeModelDeployment.id == deployment_id,
            NodeModelDeployment.node_id == node_id,
        )
    )).scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Deployment not found."})
    await db.delete(dep)
    await db.commit()
    return {"ok": True}


# ── Heartbeat history ─────────────────────────────────────────────────────────

@router.get("/nodes/{node_id}/history")
async def node_history(
    node_id: str,
    limit: int = 60,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Last N heartbeat samples for a node (for charts)."""
    rows = (await db.execute(
        select(ClusterHeartbeat)
        .where(ClusterHeartbeat.node_id == node_id)
        .order_by(ClusterHeartbeat.recorded_at.desc())
        .limit(limit)
    )).scalars().all()
    return [
        {
            "ts": r.recorded_at.isoformat(),
            "gpu_util": r.gpu_util,
            "cpu_util": r.cpu_util,
            "vram_used_mb": r.vram_used_mb,
            "ram_used_mb": r.ram_used_mb,
            "queue_depth": r.queue_depth,
            "active_model": r.active_model,
        }
        for r in reversed(rows)
    ]
