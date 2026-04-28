"""Node management service — worker enrollment, heartbeat, model deployment routing."""

import secrets
import hashlib
import json
import httpx
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from mac.models.node import WorkerNode, NodeModelDeployment, EnrollmentToken
from mac.config import settings


def _utcnow():
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── Enrollment Tokens ─────────────────────────────────────

async def create_enrollment_token(
    db: AsyncSession, created_by: str, label: str = "Worker Node", expires_in_hours: int = 24
) -> tuple[str, EnrollmentToken]:
    """Create a one-time enrollment token. Returns (plain_token, db_record)."""
    plain_token = f"mac_enroll_{secrets.token_urlsafe(32)}"
    token = EnrollmentToken(
        token_hash=_hash(plain_token),
        label=label,
        expires_at=_utcnow() + timedelta(hours=expires_in_hours),
        created_by=created_by,
    )
    db.add(token)
    await db.flush()
    return plain_token, token


async def validate_enrollment_token(db: AsyncSession, plain_token: str) -> Optional[EnrollmentToken]:
    """Validate and return enrollment token if valid, unused, and not expired."""
    token_hash = _hash(plain_token)
    result = await db.execute(
        select(EnrollmentToken).where(
            EnrollmentToken.token_hash == token_hash,
            EnrollmentToken.used == False,
            EnrollmentToken.expires_at > _utcnow(),
        )
    )
    return result.scalar_one_or_none()


# ── Node Management ──────────────────────────────────────

async def enroll_node(
    db: AsyncSession,
    enrollment_token: str,
    name: str,
    hostname: str,
    ip_address: str,
    port: int = 8001,
    enrolled_by: Optional[str] = None,
    **hw_specs,
) -> Optional[WorkerNode]:
    """Enroll a new worker node using a valid enrollment token."""
    token_record = await validate_enrollment_token(db, enrollment_token)
    if not token_record:
        return None

    # Mark token as used
    token_record.used = True

    node = WorkerNode(
        name=name,
        hostname=hostname,
        ip_address=ip_address,
        port=port,
        token_hash=_hash(enrollment_token),
        status="active",
        enrolled_by=enrolled_by,
        gpu_name=hw_specs.get("gpu_name"),
        gpu_vram_mb=hw_specs.get("gpu_vram_mb"),
        ram_total_mb=hw_specs.get("ram_total_mb"),
        cpu_cores=hw_specs.get("cpu_cores"),
        last_heartbeat=_utcnow(),
    )
    db.add(node)
    await db.flush()

    token_record.used_by_node_id = node.id
    return node


async def get_node(db: AsyncSession, node_id: str) -> Optional[WorkerNode]:
    result = await db.execute(
        select(WorkerNode)
        .options(selectinload(WorkerNode.deployments))
        .where(WorkerNode.id == node_id)
    )
    return result.scalar_one_or_none()


async def get_all_nodes(db: AsyncSession) -> list[WorkerNode]:
    result = await db.execute(
        select(WorkerNode)
        .options(selectinload(WorkerNode.deployments))
        .order_by(WorkerNode.created_at.desc())
    )
    return list(result.scalars().all())


async def update_heartbeat(
    db: AsyncSession, node_id: str,
    gpu_util_pct: Optional[float] = None,
    gpu_vram_used_mb: Optional[int] = None,
    ram_used_mb: Optional[int] = None,
    cpu_util_pct: Optional[float] = None,
) -> bool:
    """Update node health metrics."""
    stmt = (
        update(WorkerNode)
        .where(WorkerNode.id == node_id)
        .values(
            last_heartbeat=_utcnow(),
            gpu_util_pct=gpu_util_pct,
            gpu_vram_used_mb=gpu_vram_used_mb,
            ram_used_mb=ram_used_mb,
            cpu_util_pct=cpu_util_pct,
            status="active",
        )
    )
    result = await db.execute(stmt)
    return result.rowcount > 0


async def set_node_status(db: AsyncSession, node_id: str, status: str) -> bool:
    stmt = update(WorkerNode).where(WorkerNode.id == node_id).values(status=status)
    result = await db.execute(stmt)
    return result.rowcount > 0


async def remove_node(db: AsyncSession, node_id: str) -> bool:
    node = await get_node(db, node_id)
    if not node:
        return False
    await db.delete(node)
    return True


# ── Model Deployment ─────────────────────────────────────

async def deploy_model(
    db: AsyncSession,
    node_id: str,
    model_id: str,
    model_name: str,
    served_name: str,
    deployed_by: str,
    vllm_port: int = 8001,
    gpu_memory_util: float = 0.85,
    max_model_len: int = 8192,
) -> Optional[NodeModelDeployment]:
    """Register a model deployment on a specific node."""
    node = await get_node(db, node_id)
    if not node or node.status not in ("active", "draining"):
        return None

    deployment = NodeModelDeployment(
        node_id=node_id,
        model_id=model_id,
        model_name=model_name,
        served_name=served_name,
        vllm_port=vllm_port,
        status="pending",
        gpu_memory_util=gpu_memory_util,
        max_model_len=max_model_len,
        deployed_by=deployed_by,
    )
    db.add(deployment)
    await db.flush()
    return deployment


async def get_deployment(db: AsyncSession, deployment_id: str) -> Optional[NodeModelDeployment]:
    result = await db.execute(
        select(NodeModelDeployment).where(NodeModelDeployment.id == deployment_id)
    )
    return result.scalar_one_or_none()


async def update_deployment_status(
    db: AsyncSession, deployment_id: str, status: str, error_message: Optional[str] = None
) -> bool:
    values = {"status": status}
    if error_message is not None:
        values["error_message"] = error_message
    stmt = update(NodeModelDeployment).where(NodeModelDeployment.id == deployment_id).values(**values)
    result = await db.execute(stmt)
    return result.rowcount > 0


async def get_all_deployments(db: AsyncSession) -> list[NodeModelDeployment]:
    result = await db.execute(
        select(NodeModelDeployment).order_by(NodeModelDeployment.created_at.desc())
    )
    return list(result.scalars().all())


async def get_pending_deployments_for_node(db: AsyncSession, node_id: str) -> list[NodeModelDeployment]:
    """Get deployments assigned to a node that are still pending (worker should start serving them)."""
    result = await db.execute(
        select(NodeModelDeployment)
        .where(
            NodeModelDeployment.node_id == node_id,
            NodeModelDeployment.status == "pending",
        )
        .order_by(NodeModelDeployment.created_at.asc())
    )
    return list(result.scalars().all())


async def get_ready_deployment_for_model(db: AsyncSession, model_id: str) -> Optional[tuple[str, int, str]]:
    """Find the best available node for a model. Returns (ip_address, vllm_port, served_name) or None.
    Routes to least-loaded active node with a ready deployment for this model."""
    result = await db.execute(
        select(NodeModelDeployment, WorkerNode)
        .join(WorkerNode, NodeModelDeployment.node_id == WorkerNode.id)
        .where(
            NodeModelDeployment.model_id == model_id,
            NodeModelDeployment.status == "ready",
            WorkerNode.status == "active",
        )
        .order_by(WorkerNode.gpu_util_pct.asc().nullslast())
    )
    row = result.first()
    if row:
        deployment, node = row
        return node.ip_address, deployment.vllm_port, deployment.served_name
    return None


# ── Cluster Status ────────────────────────────────────────

async def get_cluster_status(db: AsyncSession) -> dict:
    """Get overall cluster statistics."""
    nodes = await get_all_nodes(db)
    active = [n for n in nodes if n.status == "active"]
    all_deployments = []
    for n in nodes:
        all_deployments.extend(n.deployments)
    ready_deployments = [d for d in all_deployments if d.status == "ready"]

    return {
        "total_nodes": len(nodes),
        "active_nodes": len(active),
        "total_models_deployed": len(all_deployments),
        "models_ready": len(ready_deployments),
        "total_gpu_vram_mb": sum(n.gpu_vram_mb or 0 for n in nodes),
        "total_gpu_vram_used_mb": sum(n.gpu_vram_used_mb or 0 for n in active),
    }


# ── Smart Routing (cross-node) ───────────────────────────

async def resolve_model_endpoint(db: AsyncSession, model_id: str) -> Optional[tuple[str, str]]:
    """Resolve a model_id to (base_url, served_name) via cluster routing.
    Returns e.g. ('http://192.168.1.50:8001', 'Qwen/Qwen2.5-Coder-7B-Instruct-AWQ') or None."""
    result = await get_ready_deployment_for_model(db, model_id)
    if result:
        ip, port, served_name = result
        return f"http://{ip}:{port}", served_name
    return None


async def check_node_health(ip_address: str, port: int, timeout: int = 5) -> dict:
    """Check if a vLLM instance on a node is responding."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"http://{ip_address}:{port}/v1/models")
            if resp.status_code == 200:
                return {"healthy": True, "models": resp.json()}
            return {"healthy": False, "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"healthy": False, "error": str(e)}
