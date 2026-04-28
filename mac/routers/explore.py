"""Explore endpoints — /explore — public discovery API."""

import time
from fastapi import APIRouter, HTTPException, Query, Depends
from mac.schemas.explore import (
    ModelInfo, ModelDetail, ModelsListResponse,
    EndpointInfo, EndpointsResponse,
    HealthResponse, NodeHealth,
    UsageStatsResponse,
)
from mac.services.llm_service import DEFAULT_MODELS
from mac.middleware.auth_middleware import require_admin
from mac.models.user import User

router = APIRouter(prefix="/explore", tags=["Explore"])

_START_TIME = time.time()


@router.get("/models", response_model=ModelsListResponse)
async def list_models(
    status: str = Query("all", description="Filter: loaded, offline"),
    capability: str = Query("all", description="Filter: code, chat, vision, speech, math"),
    model_type: str = Query("all", description="Filter: chat, stt, tts, embedding, vision"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List all available models from registry."""
    models = []
    for model_id, info in DEFAULT_MODELS.items():
        mt = info.get("model_type", "chat")

        if model_type != "all" and mt != model_type:
            continue

        if capability != "all" and capability not in info.get("capabilities", []):
            continue

        models.append(ModelInfo(
            id=model_id,
            name=info["name"],
            model_type=mt,
            specialty=info.get("specialty", ""),
            parameters=info.get("parameters", ""),
            context_length=info.get("context_length", 4096),
            quantisation=info.get("quantisation", ""),
            vram_mb=info.get("vram_mb", 0),
            status="loaded",
            capabilities=info.get("capabilities", []),
        ))

    total = len(models)
    start = (page - 1) * per_page
    return ModelsListResponse(models=models[start:start + per_page], total=total, page=page, per_page=per_page)


@router.get("/models/search", response_model=ModelsListResponse)
async def search_models(tag: str = Query(..., description="Capability tag: vision, code, math, speech")):
    """Search models by capability tag."""
    models = []
    for model_id, info in DEFAULT_MODELS.items():
        if tag.lower() in [c.lower() for c in info.get("capabilities", [])]:
            models.append(ModelInfo(
                id=model_id,
                name=info["name"],
                model_type=info.get("model_type", "chat"),
                specialty=info.get("specialty", ""),
                parameters=info.get("parameters", ""),
                context_length=info.get("context_length", 4096),
                status="loaded",
                capabilities=info.get("capabilities", []),
            ))
    return ModelsListResponse(models=models, total=len(models))


@router.get("/models/{model_id}", response_model=ModelDetail)
async def get_model(model_id: str):
    """Get detailed info about a specific model."""
    if model_id not in DEFAULT_MODELS:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": f"Model '{model_id}' not found"})

    info = DEFAULT_MODELS[model_id]

    return ModelDetail(
        id=model_id,
        name=info["name"],
        specialty=info.get("specialty", ""),
        parameters=info.get("parameters", ""),
        context_length=info.get("context_length", 4096),
        capabilities=info.get("capabilities", []),
        example_prompt=info.get("example_prompt", ""),
        status="loaded",
    )


@router.get("/endpoints", response_model=EndpointsResponse)
async def list_endpoints():
    """List all API endpoints."""
    endpoints = [
        EndpointInfo(method="POST", path="/api/v1/auth/login", auth_required=False, description="Authenticate with roll number and password"),
        EndpointInfo(method="POST", path="/api/v1/auth/logout", auth_required=True, description="Logout / revoke session"),
        EndpointInfo(method="POST", path="/api/v1/auth/refresh", auth_required=False, description="Refresh access token"),
        EndpointInfo(method="GET", path="/api/v1/auth/me", auth_required=True, description="Get current user profile"),
        EndpointInfo(method="POST", path="/api/v1/auth/change-password", auth_required=True, description="Change password"),
        EndpointInfo(method="GET", path="/api/v1/explore/models", auth_required=False, description="List all models"),
        EndpointInfo(method="GET", path="/api/v1/explore/models/search", auth_required=False, description="Search models by tag"),
        EndpointInfo(method="GET", path="/api/v1/explore/models/{model_id}", auth_required=False, description="Model details"),
        EndpointInfo(method="GET", path="/api/v1/explore/endpoints", auth_required=False, description="List all endpoints"),
        EndpointInfo(method="GET", path="/api/v1/explore/health", auth_required=False, description="Platform health check"),
        EndpointInfo(method="POST", path="/api/v1/query/chat", auth_required=True, description="Chat completion (multi-turn)"),
        EndpointInfo(method="POST", path="/api/v1/query/completions", auth_required=True, description="Text completion"),
        EndpointInfo(method="POST", path="/api/v1/query/embeddings", auth_required=True, description="Generate embeddings"),
        EndpointInfo(method="POST", path="/api/v1/query/rerank", auth_required=True, description="Re-rank documents"),
        EndpointInfo(method="POST", path="/api/v1/query/vision", auth_required=True, description="Vision — image analysis"),
        EndpointInfo(method="POST", path="/api/v1/query/speech-to-text", auth_required=True, description="Speech-to-text transcription"),
        EndpointInfo(method="POST", path="/api/v1/query/text-to-speech", auth_required=True, description="Text-to-speech audio generation"),
        EndpointInfo(method="GET", path="/api/v1/usage/me", auth_required=True, description="My usage stats"),
        EndpointInfo(method="GET", path="/api/v1/usage/me/history", auth_required=True, description="My request history"),
        EndpointInfo(method="GET", path="/api/v1/usage/me/quota", auth_required=True, description="My quota status"),
        EndpointInfo(method="GET", path="/api/v1/usage/admin/all", auth_required=True, description="All users usage (admin)"),
        EndpointInfo(method="GET", path="/api/v1/usage/admin/models", auth_required=True, description="Per-model usage (admin)"),
        EndpointInfo(method="GET", path="/api/v1/models", auth_required=True, description="List models with status"),
        EndpointInfo(method="GET", path="/api/v1/models/{model_id}", auth_required=True, description="Model details + health"),
        EndpointInfo(method="POST", path="/api/v1/models/{model_id}/load", auth_required=True, description="Load model into GPU (admin)"),
        EndpointInfo(method="POST", path="/api/v1/models/{model_id}/unload", auth_required=True, description="Unload model from GPU (admin)"),
        EndpointInfo(method="GET", path="/api/v1/models/{model_id}/health", auth_required=True, description="Model health metrics"),
        EndpointInfo(method="POST", path="/api/v1/models/download", auth_required=True, description="Download a model (admin)"),
        EndpointInfo(method="GET", path="/api/v1/integration/routing-rules", auth_required=True, description="View smart routing rules"),
        EndpointInfo(method="PUT", path="/api/v1/integration/routing-rules", auth_required=True, description="Update routing rules (admin)"),
        EndpointInfo(method="GET", path="/api/v1/integration/workers", auth_required=True, description="List worker nodes"),
        EndpointInfo(method="GET", path="/api/v1/integration/queue", auth_required=True, description="Queue status"),
        EndpointInfo(method="GET", path="/api/v1/keys/my-key", auth_required=True, description="Get your API key"),
        EndpointInfo(method="POST", path="/api/v1/keys/generate", auth_required=True, description="Generate new API key"),
        EndpointInfo(method="GET", path="/api/v1/keys/my-key/stats", auth_required=True, description="API key usage stats"),
        EndpointInfo(method="DELETE", path="/api/v1/keys/my-key", auth_required=True, description="Revoke your API key"),
        EndpointInfo(method="GET", path="/api/v1/keys/admin/all", auth_required=True, description="All API keys (admin)"),
        EndpointInfo(method="GET", path="/api/v1/quota/limits", auth_required=True, description="Default quota limits"),
        EndpointInfo(method="GET", path="/api/v1/quota/me", auth_required=True, description="Your quota status"),
        EndpointInfo(method="PUT", path="/api/v1/quota/admin/user/{roll}", auth_required=True, description="Override user quota (admin)"),
        EndpointInfo(method="GET", path="/api/v1/quota/admin/exceeded", auth_required=True, description="Users exceeding quotas (admin)"),
        EndpointInfo(method="POST", path="/api/v1/guardrails/check-input", auth_required=True, description="Check input for policy violations"),
        EndpointInfo(method="POST", path="/api/v1/guardrails/check-output", auth_required=True, description="Check output for PII/unsafe content"),
        EndpointInfo(method="GET", path="/api/v1/guardrails/rules", auth_required=True, description="List guardrail rules (admin)"),
        EndpointInfo(method="PUT", path="/api/v1/guardrails/rules", auth_required=True, description="Update guardrail rules (admin)"),
        EndpointInfo(method="POST", path="/api/v1/rag/ingest", auth_required=True, description="Ingest document into knowledge base"),
        EndpointInfo(method="GET", path="/api/v1/rag/documents", auth_required=True, description="List ingested documents"),
        EndpointInfo(method="POST", path="/api/v1/rag/query", auth_required=True, description="RAG-augmented query"),
        EndpointInfo(method="POST", path="/api/v1/rag/collections", auth_required=True, description="Create RAG collection (admin)"),
        EndpointInfo(method="GET", path="/api/v1/rag/collections", auth_required=True, description="List RAG collections"),
        EndpointInfo(method="POST", path="/api/v1/search/web", auth_required=True, description="Web search via SearXNG"),
        EndpointInfo(method="POST", path="/api/v1/search/wikipedia", auth_required=True, description="Wikipedia search"),
        EndpointInfo(method="POST", path="/api/v1/search/grounded", auth_required=True, description="Search + LLM grounded answer"),
        EndpointInfo(method="GET", path="/api/v1/search/cache", auth_required=True, description="Search cache stats"),
    ]
    return EndpointsResponse(endpoints=endpoints, total=len(endpoints))


@router.get("/health", response_model=HealthResponse)
async def health():
    """Platform health — models loaded, uptime."""
    model_names = [info["served_name"] for info in DEFAULT_MODELS.values()]

    return HealthResponse(
        status="healthy",
        uptime_seconds=int(time.time() - _START_TIME),
        version="1.0.0",
        nodes=[NodeHealth(
            id="hf-inference",
            gpu="HuggingFace Serverless",
            models_loaded=model_names,
            status="active",
            context_window=8192,
        )],
        models_loaded=len(DEFAULT_MODELS),
        models_total=len(DEFAULT_MODELS),
    )
