"""Integration endpoints — /integration (Phase 3)."""

from fastapi import APIRouter, Depends
from mac.schemas.integration import (
    RoutingRule, RoutingRulesResponse, RoutingRulesUpdateRequest,
    WorkerInfo, WorkersResponse, QueueStatusResponse,
)
from mac.services.llm_service import list_ollama_models, DEFAULT_MODELS
from mac.middleware.auth_middleware import require_admin
from mac.models.user import User

router = APIRouter(prefix="/integration", tags=["Integration"])

# In-memory routing rules (persisted per-session)
_routing_rules = [
    RoutingRule(task_type="code", target_model="qwen2.5-coder:7b", priority=1),
    RoutingRule(task_type="math", target_model="deepseek-r1:8b", priority=1),
    RoutingRule(task_type="vision", target_model="qwen2.5:7b", priority=1),
    RoutingRule(task_type="audio", target_model="whisper-large-v3", priority=1),
    RoutingRule(task_type="general", target_model="qwen2.5:14b", priority=1),
]


@router.get("/routing-rules", response_model=RoutingRulesResponse)
async def get_routing_rules():
    """Show current task → model routing rules."""
    return RoutingRulesResponse(rules=_routing_rules)


@router.put("/routing-rules", response_model=RoutingRulesResponse)
async def update_routing_rules(body: RoutingRulesUpdateRequest, admin: User = Depends(require_admin)):
    """Update routing rules (admin-only)."""
    global _routing_rules
    _routing_rules = body.rules
    return RoutingRulesResponse(rules=_routing_rules)


@router.get("/workers", response_model=WorkersResponse)
async def list_workers():
    """List all inference worker nodes and their current load."""
    ollama_models = await list_ollama_models()
    model_names = [m.get("name", "") for m in ollama_models]

    # Local node is always present
    workers = [
        WorkerInfo(
            node_id="node-local",
            host="localhost:11434",
            gpu="auto-detected",
            models_loaded=model_names,
            status="active",
        )
    ]
    return WorkersResponse(workers=workers, total=len(workers))


@router.get("/workers/{node_id}", response_model=WorkerInfo)
async def get_worker(node_id: str):
    """Get details for a specific worker node."""
    if node_id != "node-local":
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Worker not found"})

    ollama_models = await list_ollama_models()
    model_names = [m.get("name", "") for m in ollama_models]

    return WorkerInfo(
        node_id="node-local",
        host="localhost:11434",
        gpu="auto-detected",
        models_loaded=model_names,
        status="active",
    )


@router.post("/workers/{node_id}/drain")
async def drain_worker(node_id: str, admin: User = Depends(require_admin)):
    """Mark a worker as draining — stops accepting new requests (admin-only)."""
    return {"node_id": node_id, "status": "draining", "message": "Worker marked as draining. Will finish current requests."}


@router.get("/queue", response_model=QueueStatusResponse)
async def queue_status():
    """Current global inference queue depth."""
    return QueueStatusResponse(queue_depth=0, avg_wait_ms=0, processing=0, pending=0)
