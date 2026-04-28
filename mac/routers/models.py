"""Model management endpoints — /models (Phase 2) + Community Model Portal."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.schemas.models import (
    ModelStatusResponse, ModelHealthResponse, ModelDownloadRequest,
    DownloadProgressResponse,
)
from mac.schemas.explore import ModelInfo, ModelsListResponse, ModelDetail
from mac.services import model_service, notification_service
from mac.services import model_submission_service as sub_svc
from mac.services.llm_service import DEFAULT_MODELS, list_available_models, get_model_detail
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User

router = APIRouter(prefix="/models", tags=["Models"])


# ═══════════════════════════════════════════════════════════
#  Community Model Portal — FIXED-PATH routes FIRST
#  (must appear before /{model_id} to avoid route conflicts)
# ═══════════════════════════════════════════════════════════

def _sub_to_dict(s) -> dict:
    return {
        "id": s.id,
        "submitter_id": s.submitter_id,
        "model_source": s.model_source,
        "model_url": s.model_url,
        "model_id": s.model_id,
        "display_name": s.display_name,
        "description": s.description,
        "category": s.category,
        "parameters": s.parameters,
        "context_length": s.context_length,
        "quantization": s.quantization,
        "min_vram_gb": s.min_vram_gb,
        "worker_node_id": s.worker_node_id,
        "vllm_port": s.vllm_port,
        "status": s.status,
        "reviewed_by": s.reviewed_by,
        "review_note": s.review_note,
        "capabilities": s.capabilities,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


@router.post("/submit")
async def submit_model(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit a HuggingFace or GitHub model for community deployment."""
    url_or_id = body.get("model_url", "").strip()
    display_name = body.get("display_name", "").strip()
    if not url_or_id:
        raise HTTPException(400, "model_url is required (HF URL, model ID, or GitHub URL)")
    if not display_name:
        raise HTTPException(400, "display_name is required")

    try:
        sub = await sub_svc.submit_model(
            db,
            submitter_id=user.id,
            url_or_id=url_or_id,
            display_name=display_name,
            description=body.get("description", ""),
            category=body.get("category", "general"),
            parameters=body.get("parameters", ""),
            context_length=body.get("context_length", 4096),
            quantization=body.get("quantization", ""),
            min_vram_gb=body.get("min_vram_gb", 0.0),
            capabilities=body.get("capabilities"),
        )
        await notification_service.log_audit(
            db, action="model.submit", resource_type="model_submission",
            resource_id=sub.id, actor_id=user.id, actor_role=user.role,
            details=f"Model: {sub.model_id}",
        )
        await db.commit()
        return {"submission": _sub_to_dict(sub)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/submissions")
async def list_submissions(
    status: str = "",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List model submissions. Non-admin users see only their own."""
    submitter = None if user.role == "admin" else user.id
    subs = await sub_svc.list_submissions(db, status=status or None, submitter_id=submitter)
    return {"submissions": [_sub_to_dict(s) for s in subs]}


@router.get("/submissions/{submission_id}")
async def get_submission(
    submission_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sub = await sub_svc.get_submission(db, submission_id)
    if not sub:
        raise HTTPException(404, "Submission not found")
    if user.role != "admin" and sub.submitter_id != user.id:
        raise HTTPException(403, "Access denied")
    return _sub_to_dict(sub)


@router.post("/submissions/{submission_id}/review")
async def review_submission(
    submission_id: str,
    body: dict,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin approve or reject a model submission."""
    decision = body.get("decision", "").strip()
    note = body.get("note", "")
    if decision not in ("approved", "rejected"):
        raise HTTPException(400, "decision must be 'approved' or 'rejected'")

    try:
        sub = await sub_svc.review_submission(db, submission_id, user.id, decision, note)
        if not sub:
            raise HTTPException(404, "Submission not found")
        await notification_service.log_audit(
            db, action=f"model.{decision}", resource_type="model_submission",
            resource_id=sub.id, actor_id=user.id, actor_role=user.role,
            details=f"Model: {sub.model_id}, Note: {note[:200]}",
        )
        await db.commit()
        return {"submission": _sub_to_dict(sub)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/submissions/{submission_id}/assign")
async def assign_worker(
    submission_id: str,
    body: dict,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Assign a worker node to host an approved model.
    Also registers a NodeModelDeployment so cluster routing can find it."""
    from mac.services import node_service

    worker_node_id = body.get("worker_node_id", "").strip()
    vllm_port = body.get("vllm_port", 0)
    if not worker_node_id:
        raise HTTPException(400, "worker_node_id is required")
    if not vllm_port or vllm_port < 1024:
        raise HTTPException(400, "vllm_port must be >= 1024")

    try:
        sub = await sub_svc.assign_worker(db, submission_id, worker_node_id, vllm_port)
        if not sub:
            raise HTTPException(404, "Submission not found")

        # Also create a NodeModelDeployment so the cluster router can find this model
        deployment = await node_service.deploy_model(
            db,
            node_id=worker_node_id,
            model_id=sub.model_id,
            model_name=sub.display_name,
            served_name=sub.model_id,  # HF model ID is the served name for vLLM
            deployed_by=user.id,
            vllm_port=vllm_port,
        )
        if deployment:
            # Store deployment ID on submission for tracking
            sub.review_note = (sub.review_note or "") + f"\nDeployment ID: {deployment.id}"

        await db.commit()
        return {"submission": _sub_to_dict(sub), "deployment_id": deployment.id if deployment else None}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/submissions/{submission_id}/live")
async def mark_live(
    submission_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Mark a deploying model as live — enables inference routing."""
    from mac.services import node_service

    try:
        sub = await sub_svc.mark_live(db, submission_id)
        if not sub:
            raise HTTPException(404, "Submission not found")

        # Also mark the NodeModelDeployment as ready so cluster routing picks it up
        if sub.worker_node_id and sub.vllm_port:
            from mac.models.node import NodeModelDeployment
            from sqlalchemy import select, update
            stmt = (
                update(NodeModelDeployment)
                .where(
                    NodeModelDeployment.node_id == sub.worker_node_id,
                    NodeModelDeployment.model_id == sub.model_id,
                )
                .values(status="ready")
            )
            await db.execute(stmt)

        await notification_service.log_audit(
            db, action="model.live", resource_type="model_submission",
            resource_id=sub.id, actor_id=user.id, actor_role=user.role,
            details=f"Model: {sub.model_id} now LIVE",
        )
        await db.commit()
        return {"submission": _sub_to_dict(sub)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/submissions/{submission_id}/retire")
async def retire_model(
    submission_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Retire a live model from the registry."""
    from mac.services import node_service

    try:
        sub = await sub_svc.retire_model(db, submission_id)
        if not sub:
            raise HTTPException(404, "Submission not found")

        # Also mark the NodeModelDeployment as removed
        if sub.worker_node_id:
            from mac.models.node import NodeModelDeployment
            from sqlalchemy import update
            stmt = (
                update(NodeModelDeployment)
                .where(
                    NodeModelDeployment.node_id == sub.worker_node_id,
                    NodeModelDeployment.model_id == sub.model_id,
                )
                .values(status="removed")
            )
            await db.execute(stmt)

        await db.commit()
        return {"submission": _sub_to_dict(sub)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/community")
async def list_community_models(db: AsyncSession = Depends(get_db)):
    """Public: list all live community models."""
    models = await sub_svc.get_live_models(db)
    return {
        "models": [
            {
                "id": m.model_id,
                "name": m.display_name,
                "source": m.model_source,
                "url": m.model_url,
                "category": m.category,
                "parameters": m.parameters,
                "context_length": m.context_length,
                "quantization": m.quantization,
                "capabilities": m.capabilities,
            }
            for m in models
        ]
    }


@router.get("/submission-stats")
async def submission_stats(
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: get submission counts by status."""
    stats = await sub_svc.submission_stats(db)
    return {"stats": stats}


@router.post("/download", response_model=DownloadProgressResponse)
async def download_model(body: ModelDownloadRequest, admin: User = Depends(require_admin)):
    """Download a model from Ollama registry (admin-only)."""
    task_id = await model_service.pull_model(body.model_id)
    progress = model_service.get_download_progress(task_id)
    if progress:
        return DownloadProgressResponse(**progress)
    return DownloadProgressResponse(task_id=task_id, model_id=body.model_id, status="queued")


@router.get("/download/{task_id}", response_model=DownloadProgressResponse)
async def download_progress(task_id: str):
    """Check model download progress."""
    progress = model_service.get_download_progress(task_id)
    if not progress:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Download task not found"})
    return DownloadProgressResponse(**progress)


# ═══════════════════════════════════════════════════════════
#  Core Model Management — parameterized routes LAST
# ═══════════════════════════════════════════════════════════

@router.get("", response_model=ModelsListResponse)
async def list_models(db: AsyncSession = Depends(get_db)):
    """List all models (built-in + live community) with their current status."""
    backend_models = await list_available_models()
    backend_ids = {m.get("id", "") for m in backend_models}

    models = []
    for model_id, info in DEFAULT_MODELS.items():
        tag = info["served_name"]
        is_loaded = tag in backend_ids or any(tag in mid for mid in backend_ids)

        models.append(ModelInfo(
            id=model_id,
            name=info["name"],
            specialty=info.get("specialty", ""),
            parameters=info.get("parameters", ""),
            context_length=info.get("context_length", 4096),
            status="loaded" if is_loaded else "offline",
            capabilities=info.get("capabilities", []),
        ))

    # Also include live community models
    live_community = await sub_svc.get_live_models(db)
    for m in live_community:
        if m.model_id not in DEFAULT_MODELS:
            models.append(ModelInfo(
                id=m.model_id,
                name=m.display_name,
                specialty=m.description or f"Community {m.category} model",
                parameters=m.parameters or "",
                context_length=m.context_length or 4096,
                status="loaded",  # live = loaded
                capabilities=m.capabilities or ["chat"],
            ))

    return ModelsListResponse(models=models, total=len(models))


@router.get("/{model_id}", response_model=ModelDetail)
async def get_model(model_id: str):
    """Get detailed model info."""
    if model_id not in DEFAULT_MODELS:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": f"Model '{model_id}' not found"})

    info = DEFAULT_MODELS[model_id]
    detail = await get_model_detail(info["served_name"])
    return ModelDetail(
        id=model_id,
        name=info["name"],
        specialty=info.get("specialty", ""),
        parameters=info.get("parameters", ""),
        context_length=info.get("context_length", 4096),
        capabilities=info.get("capabilities", []),
        status="loaded" if detail else "offline",
    )


@router.post("/{model_id}/load", response_model=ModelStatusResponse)
async def load_model(model_id: str, admin: User = Depends(require_admin)):
    """Load a model into GPU memory (admin-only)."""
    try:
        result = await model_service.load_model(model_id)
        return ModelStatusResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=503, detail={"code": "load_failed", "message": str(e)})


@router.post("/{model_id}/unload", response_model=ModelStatusResponse)
async def unload_model(model_id: str, admin: User = Depends(require_admin)):
    """Unload a model from GPU memory (admin-only)."""
    try:
        result = await model_service.unload_model(model_id)
        return ModelStatusResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=503, detail={"code": "unload_failed", "message": str(e)})


@router.get("/{model_id}/health", response_model=ModelHealthResponse)
async def model_health(model_id: str):
    """Check if a model is ready and responsive."""
    result = await model_service.get_model_health(model_id)
    return ModelHealthResponse(**result)
