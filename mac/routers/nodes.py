"""Node management router — worker enrollment, heartbeat, deployments, cluster status."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User
from mac.schemas.nodes import (
    CreateEnrollmentTokenRequest, EnrollmentTokenResponse,
    NodeEnrollRequest, NodeInfoResponse,
    NodeHeartbeatRequest,
    DeployModelRequest, DeploymentInfoResponse,
    NodeListResponse, ClusterStatusResponse,
)
from mac.services import node_service, notification_service

router = APIRouter(prefix="/nodes", tags=["nodes"])


# ── Enrollment Tokens (Admin only) ───────────────────────

@router.post("/enrollment-token", response_model=EnrollmentTokenResponse)
async def create_enrollment_token(
    req: CreateEnrollmentTokenRequest,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate a one-time enrollment token for a new worker node."""
    plain_token, record = await node_service.create_enrollment_token(
        db, created_by=user.id, label=req.label, expires_in_hours=req.expires_in_hours,
    )
    await notification_service.log_audit(
        db, action="node.enrollment_token.create", resource_type="enrollment_token",
        resource_id=record.id, actor_id=user.id, actor_role=user.role,
        details=f"Label: {req.label}, expires_in: {req.expires_in_hours}h",
    )
    return EnrollmentTokenResponse(
        token=plain_token, label=record.label, expires_at=record.expires_at,
    )


# ── Node Enrollment (token-based, no user auth needed) ───

@router.post("/enroll", response_model=NodeInfoResponse)
async def enroll_node(
    req: NodeEnrollRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Enroll a new worker node using a valid enrollment token."""
    node = await node_service.enroll_node(
        db,
        enrollment_token=req.enrollment_token,
        name=req.name,
        hostname=req.hostname,
        ip_address=req.ip_address,
        port=req.port,
        gpu_name=req.gpu_name,
        gpu_vram_mb=req.gpu_vram_mb,
        ram_total_mb=req.ram_total_mb,
        cpu_cores=req.cpu_cores,
    )
    if not node:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_token",
            "message": "Invalid, expired, or already-used enrollment token",
        })

    await notification_service.log_audit(
        db, action="node.enroll", resource_type="worker_node",
        resource_id=node.id,
        details=f"Node: {node.name} ({node.ip_address}:{node.port})",
        ip_address=request.client.host if request.client else None,
    )

    return _node_to_response(node)


# ── Heartbeat (from worker agents) ──────────────────────

@router.post("/heartbeat/{node_id}")
async def node_heartbeat(
    node_id: str,
    req: NodeHeartbeatRequest,
    db: AsyncSession = Depends(get_db),
):
    """Worker nodes send periodic heartbeats with resource metrics."""
    success = await node_service.update_heartbeat(
        db, node_id,
        gpu_util_pct=req.gpu_util_pct,
        gpu_vram_used_mb=req.gpu_vram_used_mb,
        ram_used_mb=req.ram_used_mb,
        cpu_util_pct=req.cpu_util_pct,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Node not found")

    # Check resource limits — auto-throttle if over 85%
    node = await node_service.get_node(db, node_id)
    warnings = []
    if node and node.max_resource_pct:
        limit = node.max_resource_pct
        if req.gpu_util_pct and req.gpu_util_pct > limit:
            warnings.append(f"GPU utilization {req.gpu_util_pct}% exceeds {limit}% limit")
        if req.cpu_util_pct and req.cpu_util_pct > limit:
            warnings.append(f"CPU utilization {req.cpu_util_pct}% exceeds {limit}% limit")
        if node.ram_total_mb and req.ram_used_mb:
            ram_pct = (req.ram_used_mb / node.ram_total_mb) * 100
            if ram_pct > limit:
                warnings.append(f"RAM usage {ram_pct:.0f}% exceeds {limit}% limit")

    return {"status": "ok", "warnings": warnings}


# ── Worker Self-Registration (no user auth, node-id based) ─

@router.post("/register-model/{node_id}")
async def register_model(
    node_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Worker agents call this after enrollment to register which model they're serving.
    No user auth needed — validated by matching enrolled node IP."""
    body = await request.json()
    model_id = body.get("model_id", "")
    served_name = body.get("served_name", "")
    model_name = body.get("model_name", served_name)
    vllm_port = body.get("vllm_port", 8001)

    node = await node_service.get_node(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Security: verify request comes from the enrolled node's IP
    client_ip = request.client.host if request.client else None
    if client_ip and node.ip_address and client_ip != node.ip_address:
        # Allow Docker internal IPs and localhost too
        if not (client_ip.startswith("172.") or client_ip.startswith("10.") or client_ip == "127.0.0.1"):
            raise HTTPException(status_code=403, detail="IP mismatch")

    deployment = await node_service.deploy_model(
        db,
        node_id=node_id,
        model_id=model_id,
        model_name=model_name,
        served_name=served_name,
        deployed_by="worker-agent",
        vllm_port=vllm_port,
    )
    if not deployment:
        raise HTTPException(status_code=400, detail="Failed to register model")

    # Auto-mark as ready (worker already has it loaded)
    await node_service.update_deployment_status(db, deployment.id, "ready")

    return {"status": "registered", "deployment_id": deployment.id}


# ── Worker Deploy Poll (no user auth, node-id based) ────

@router.get("/pending-deployments/{node_id}")
async def pending_deployments(
    node_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Worker agents poll this to discover newly assigned models to deploy.
    Returns pending NodeModelDeployment records for this node."""
    node = await node_service.get_node(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Security: verify request comes from the enrolled node's IP
    client_ip = request.client.host if request.client else None
    if client_ip and node.ip_address and client_ip != node.ip_address:
        if not (client_ip.startswith("172.") or client_ip.startswith("10.") or client_ip == "127.0.0.1"):
            raise HTTPException(status_code=403, detail="IP mismatch")

    deployments = await node_service.get_pending_deployments_for_node(db, node_id)
    return {
        "pending": [
            {
                "deployment_id": d.id,
                "model_id": d.model_id,
                "model_name": d.model_name,
                "served_name": d.served_name,
                "vllm_port": d.vllm_port,
                "gpu_memory_util": d.gpu_memory_util,
                "max_model_len": d.max_model_len,
            }
            for d in deployments
        ]
    }


@router.post("/deployment/{deployment_id}/status")
async def update_deployment_status(
    deployment_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Worker agents report deployment status updates (e.g., pending → ready or failed)."""
    body = await request.json()
    status = body.get("status", "")
    error_message = body.get("error_message")
    if status not in ("ready", "failed", "removed"):
        raise HTTPException(400, "status must be 'ready', 'failed', or 'removed'")

    success = await node_service.update_deployment_status(db, deployment_id, status, error_message)
    if not success:
        raise HTTPException(404, "Deployment not found")
    await db.commit()
    return {"status": status}


# ── Node Management (Admin) ─────────────────────────────

@router.get("", response_model=NodeListResponse)
async def list_nodes(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all worker nodes with deployment info."""
    nodes = await node_service.get_all_nodes(db)
    return NodeListResponse(
        nodes=[_node_to_response(n) for n in nodes],
        total=len(nodes),
    )


@router.get("/cluster-status", response_model=ClusterStatusResponse)
async def cluster_status(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get overall cluster health and statistics."""
    status = await node_service.get_cluster_status(db)
    return ClusterStatusResponse(**status)


@router.get("/{node_id}", response_model=NodeInfoResponse)
async def get_node(
    node_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    node = await node_service.get_node(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return _node_to_response(node)


@router.post("/{node_id}/drain")
async def drain_node(
    node_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Mark a node as draining — stops new request routing."""
    success = await node_service.set_node_status(db, node_id, "draining")
    if not success:
        raise HTTPException(status_code=404, detail="Node not found")
    await notification_service.log_audit(
        db, action="node.drain", resource_type="worker_node",
        resource_id=node_id, actor_id=user.id, actor_role=user.role,
    )
    return {"status": "draining"}


@router.post("/{node_id}/activate")
async def activate_node(
    node_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    success = await node_service.set_node_status(db, node_id, "active")
    if not success:
        raise HTTPException(status_code=404, detail="Node not found")
    return {"status": "active"}


@router.delete("/{node_id}")
async def remove_node(
    node_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    success = await node_service.remove_node(db, node_id)
    if not success:
        raise HTTPException(status_code=404, detail="Node not found")
    await notification_service.log_audit(
        db, action="node.remove", resource_type="worker_node",
        resource_id=node_id, actor_id=user.id, actor_role=user.role,
    )
    return {"status": "removed"}


@router.post("/{node_id}/health-check")
async def check_node_health(
    node_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Check if a node's vLLM instance is responding."""
    node = await node_service.get_node(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    result = await node_service.check_node_health(node.ip_address, node.port)
    return result


# ── Model Deployment ─────────────────────────────────────

@router.post("/deploy", response_model=DeploymentInfoResponse)
async def deploy_model(
    req: DeployModelRequest,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Deploy a model on a specific worker node."""
    deployment = await node_service.deploy_model(
        db,
        node_id=req.node_id,
        model_id=req.model_id,
        model_name=req.model_name,
        served_name=req.served_name,
        deployed_by=user.id,
        vllm_port=req.vllm_port,
        gpu_memory_util=req.gpu_memory_util,
        max_model_len=req.max_model_len,
    )
    if not deployment:
        raise HTTPException(status_code=400, detail={
            "code": "deployment_failed",
            "message": "Node not found or not in active state",
        })

    await notification_service.log_audit(
        db, action="model.deploy", resource_type="node_model_deployment",
        resource_id=deployment.id, actor_id=user.id, actor_role=user.role,
        details=f"Model: {req.model_id} on node {req.node_id}",
    )

    return DeploymentInfoResponse(
        id=deployment.id,
        node_id=deployment.node_id,
        model_id=deployment.model_id,
        model_name=deployment.model_name,
        served_name=deployment.served_name,
        vllm_port=deployment.vllm_port,
        status=deployment.status,
        gpu_memory_util=deployment.gpu_memory_util,
        max_model_len=deployment.max_model_len,
        error_message=deployment.error_message,
        deployed_by=deployment.deployed_by,
        created_at=deployment.created_at,
    )


@router.put("/deployments/{deployment_id}/status")
async def update_deployment_status(
    deployment_id: str,
    status: str,
    error_message: str = None,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update the status of a model deployment."""
    if status not in ("pending", "downloading", "loading", "ready", "error", "unloaded"):
        raise HTTPException(status_code=400, detail="Invalid status")
    success = await node_service.update_deployment_status(db, deployment_id, status, error_message)
    if not success:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return {"status": status}


@router.get("/deployments/all", response_model=list[DeploymentInfoResponse])
async def list_all_deployments(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    deployments = await node_service.get_all_deployments(db)
    return [
        DeploymentInfoResponse(
            id=d.id, node_id=d.node_id, model_id=d.model_id,
            model_name=d.model_name, served_name=d.served_name,
            vllm_port=d.vllm_port, status=d.status,
            gpu_memory_util=d.gpu_memory_util, max_model_len=d.max_model_len,
            error_message=d.error_message, deployed_by=d.deployed_by,
            created_at=d.created_at,
        )
        for d in deployments
    ]


# ── Helpers ──────────────────────────────────────────────

def _node_to_response(node) -> NodeInfoResponse:
    return NodeInfoResponse(
        id=node.id,
        name=node.name,
        hostname=node.hostname,
        ip_address=node.ip_address,
        port=node.port,
        status=node.status,
        gpu_name=node.gpu_name,
        gpu_vram_mb=node.gpu_vram_mb,
        ram_total_mb=node.ram_total_mb,
        cpu_cores=node.cpu_cores,
        gpu_util_pct=node.gpu_util_pct,
        gpu_vram_used_mb=node.gpu_vram_used_mb,
        ram_used_mb=node.ram_used_mb,
        cpu_util_pct=node.cpu_util_pct,
        last_heartbeat=node.last_heartbeat,
        max_resource_pct=node.max_resource_pct,
        deployments=[
            DeploymentInfoResponse(
                id=d.id, node_id=d.node_id, model_id=d.model_id,
                model_name=d.model_name, served_name=d.served_name,
                vllm_port=d.vllm_port, status=d.status,
                gpu_memory_util=d.gpu_memory_util, max_model_len=d.max_model_len,
                error_message=d.error_message, deployed_by=d.deployed_by,
                created_at=d.created_at,
            )
            for d in (node.deployments or [])
        ],
        created_at=node.created_at,
    )
