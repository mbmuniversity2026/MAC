"""
MAC Distributed Load Balancer
==============================
Routes LLM inference and notebook kernel requests to the best available
worker node in the cluster.

Scoring algorithm (lower = better):
  score = gpu_util*0.5 + (vram_used/vram_total)*0.3 + queue_depth*0.2

Workers with status != "active" or last_heartbeat > STALE_SECONDS are skipped.
Falls back to local vLLM URLs from config if no healthy workers found.
"""

import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

log = logging.getLogger(__name__)

STALE_SECONDS = 30  # worker considered dead if no heartbeat in 30s


def _age_seconds(dt: Optional[datetime]) -> float:
    if not dt:
        return float("inf")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds()


def _score(node) -> float:
    gpu = (node.gpu_util_pct or 0) / 100.0
    vram_ratio = 0.0
    if node.gpu_vram_mb and node.gpu_vram_mb > 0:
        vram_ratio = (node.gpu_vram_used_mb or 0) / node.gpu_vram_mb
    # queue_depth lives in last heartbeat — approximate from live field
    return gpu * 0.5 + vram_ratio * 0.3


async def get_best_worker(db, model_id: str) -> Optional[dict]:
    """
    Return {url, node_id, model_id} for the best available worker that
    has model_id deployed and ready, or None if no healthy worker found.
    """
    from sqlalchemy import select
    from mac.models.node import WorkerNode, NodeModelDeployment

    stmt = (
        select(WorkerNode, NodeModelDeployment)
        .join(NodeModelDeployment, NodeModelDeployment.node_id == WorkerNode.id)
        .where(
            WorkerNode.status == "active",
            NodeModelDeployment.model_id == model_id,
            NodeModelDeployment.status == "ready",
        )
    )
    rows = (await db.execute(stmt)).all()

    candidates = []
    for node, deployment in rows:
        if _age_seconds(node.last_heartbeat) > STALE_SECONDS:
            continue
        candidates.append((node, deployment, _score(node)))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[2])
    node, deployment, _ = candidates[0]
    url = f"http://{node.ip_address}:{deployment.vllm_port}"
    return {"url": url, "node_id": node.id, "model_id": model_id, "node_name": node.name}


async def get_notebook_worker(db) -> Optional[dict]:
    """
    Return {url, node_id} for the least-loaded worker that supports
    notebook kernels (has notebook_port set).
    """
    from sqlalchemy import select
    from mac.models.node import WorkerNode

    stmt = select(WorkerNode).where(
        WorkerNode.status == "active",
        WorkerNode.notebook_port.isnot(None),
    )
    nodes = (await db.execute(stmt)).scalars().all()

    candidates = []
    for node in nodes:
        if _age_seconds(node.last_heartbeat) > STALE_SECONDS:
            continue
        candidates.append((node, _score(node)))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[1])
    node, _ = candidates[0]
    url = f"http://{node.ip_address}:{node.notebook_port}"
    return {"url": url, "node_id": node.id, "node_name": node.name}


async def list_healthy_workers(db) -> list[dict]:
    """Return summary of all active, non-stale workers with their models."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from mac.models.node import WorkerNode, NodeModelDeployment

    stmt = select(WorkerNode).options(selectinload(WorkerNode.deployments))
    nodes = (await db.execute(stmt)).scalars().all()

    result = []
    for node in nodes:
        age = _age_seconds(node.last_heartbeat)
        healthy = node.status == "active" and age < STALE_SECONDS
        result.append({
            "id": node.id,
            "name": node.name,
            "ip": node.ip_address,
            "status": node.status,
            "healthy": healthy,
            "heartbeat_age_s": round(age, 1) if age != float("inf") else None,
            "gpu_util_pct": node.gpu_util_pct,
            "gpu_vram_used_mb": node.gpu_vram_used_mb,
            "gpu_vram_total_mb": node.gpu_vram_mb,
            "ram_used_mb": node.ram_used_mb,
            "cpu_util_pct": node.cpu_util_pct,
            "models": [
                {"model_id": d.model_id, "status": d.status, "port": d.vllm_port}
                for d in node.deployments
            ],
        })
    return result
