"""Model submission service — submit, review, deploy community models.

Flow:
1. User submits HuggingFace/GitHub model link → status: submitted
2. Admin reviews → approved | rejected
3. Approved model gets deployed to submitter's worker node → deploying
4. Worker confirms model live → status: live, added to main model list
"""

import re
import logging
from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from mac.models.model_submission import ModelSubmission

logger = logging.getLogger(__name__)


def _utcnow():
    return datetime.now(timezone.utc)


# ── URL validation ────────────────────────────────────────

HF_PATTERN = re.compile(
    r"^https?://huggingface\.co/([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)/?$"
)
GITHUB_PATTERN = re.compile(
    r"^https?://github\.com/([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)/?$"
)
# Also accept raw HuggingFace model IDs like "Qwen/Qwen2.5-7B-Instruct"
HF_MODEL_ID = re.compile(r"^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$")


def parse_model_source(url_or_id: str) -> tuple[str, str, str]:
    """Parse a model URL or ID into (source, model_id, clean_url).
    Raises ValueError for invalid inputs."""
    url_or_id = url_or_id.strip()

    m = HF_PATTERN.match(url_or_id)
    if m:
        model_id = m.group(1)
        return "huggingface", model_id, url_or_id

    m = GITHUB_PATTERN.match(url_or_id)
    if m:
        model_id = m.group(1)
        return "github", model_id, url_or_id

    m = HF_MODEL_ID.match(url_or_id)
    if m:
        return "huggingface", url_or_id, f"https://huggingface.co/{url_or_id}"

    raise ValueError(
        "Invalid model reference. Provide a HuggingFace URL (https://huggingface.co/org/model), "
        "a HuggingFace model ID (org/model), or a GitHub repo URL."
    )


# ── Submission CRUD ───────────────────────────────────────

async def submit_model(
    db: AsyncSession,
    submitter_id: str,
    url_or_id: str,
    display_name: str,
    description: str = "",
    category: str = "general",
    parameters: str = "",
    context_length: int = 4096,
    quantization: str = "",
    min_vram_gb: float = 0.0,
    capabilities: list[str] | None = None,
) -> ModelSubmission:
    """Submit a new model for review."""
    source, model_id, clean_url = parse_model_source(url_or_id)

    # Check for duplicate pending submissions
    existing = await db.execute(
        select(ModelSubmission).where(
            ModelSubmission.model_id == model_id,
            ModelSubmission.status.in_(["submitted", "approved", "deploying", "live"]),
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"Model '{model_id}' already has an active submission")

    submission = ModelSubmission(
        submitter_id=submitter_id,
        model_source=source,
        model_url=clean_url,
        model_id=model_id,
        display_name=display_name,
        description=description,
        category=category,
        parameters=parameters,
        context_length=context_length,
        quantization=quantization or None,
        min_vram_gb=min_vram_gb,
        capabilities=capabilities or ["chat"],
    )
    db.add(submission)
    await db.flush()
    return submission


async def list_submissions(
    db: AsyncSession,
    status: str | None = None,
    submitter_id: str | None = None,
    limit: int = 50,
) -> list[ModelSubmission]:
    """List model submissions with optional filters."""
    query = select(ModelSubmission).order_by(ModelSubmission.created_at.desc()).limit(limit)
    if status:
        query = query.where(ModelSubmission.status == status)
    if submitter_id:
        query = query.where(ModelSubmission.submitter_id == submitter_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_submission(db: AsyncSession, submission_id: str) -> Optional[ModelSubmission]:
    result = await db.execute(
        select(ModelSubmission).where(ModelSubmission.id == submission_id)
    )
    return result.scalar_one_or_none()


async def review_submission(
    db: AsyncSession,
    submission_id: str,
    reviewer_id: str,
    decision: str,
    note: str = "",
) -> Optional[ModelSubmission]:
    """Approve or reject a submission. decision: 'approved' | 'rejected'"""
    if decision not in ("approved", "rejected"):
        raise ValueError("Decision must be 'approved' or 'rejected'")

    sub = await get_submission(db, submission_id)
    if not sub:
        return None
    if sub.status != "submitted":
        raise ValueError(f"Cannot review submission in '{sub.status}' status")

    sub.status = decision
    sub.reviewed_by = reviewer_id
    sub.review_note = note
    sub.updated_at = _utcnow()
    await db.flush()
    return sub


async def assign_worker(
    db: AsyncSession,
    submission_id: str,
    worker_node_id: str,
    vllm_port: int,
) -> Optional[ModelSubmission]:
    """Assign a worker node + port to an approved model for deployment."""
    sub = await get_submission(db, submission_id)
    if not sub:
        return None
    if sub.status != "approved":
        raise ValueError(f"Cannot assign worker to submission in '{sub.status}' status")

    sub.worker_node_id = worker_node_id
    sub.vllm_port = vllm_port
    sub.status = "deploying"
    sub.updated_at = _utcnow()
    await db.flush()
    return sub


async def mark_live(db: AsyncSession, submission_id: str) -> Optional[ModelSubmission]:
    """Mark a deploying model as live — it's now serving inference."""
    sub = await get_submission(db, submission_id)
    if not sub:
        return None
    if sub.status != "deploying":
        raise ValueError(f"Cannot mark live from '{sub.status}' status")

    sub.status = "live"
    sub.updated_at = _utcnow()
    await db.flush()
    logger.info(f"Model '{sub.model_id}' is now LIVE on worker {sub.worker_node_id}:{sub.vllm_port}")
    return sub


async def mark_failed(db: AsyncSession, submission_id: str, error: str = "") -> Optional[ModelSubmission]:
    """Mark a deployment as failed."""
    sub = await get_submission(db, submission_id)
    if not sub:
        return None
    sub.status = "failed"
    sub.review_note = (sub.review_note or "") + f"\nDeployment error: {error}"
    sub.updated_at = _utcnow()
    await db.flush()
    return sub


async def retire_model(db: AsyncSession, submission_id: str) -> Optional[ModelSubmission]:
    """Retire a live model — remove from active registry."""
    sub = await get_submission(db, submission_id)
    if not sub:
        return None
    sub.status = "retired"
    sub.updated_at = _utcnow()
    await db.flush()
    return sub


async def get_live_models(db: AsyncSession) -> list[ModelSubmission]:
    """Get all currently live community models."""
    result = await db.execute(
        select(ModelSubmission).where(ModelSubmission.status == "live")
    )
    return list(result.scalars().all())


async def submission_stats(db: AsyncSession) -> dict:
    """Get counts by status."""
    result = await db.execute(
        select(ModelSubmission.status, func.count(ModelSubmission.id))
        .group_by(ModelSubmission.status)
    )
    return dict(result.all())
