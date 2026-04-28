"""Guardrail endpoints — /guardrails (Phase 6)."""

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.schemas.guardrails import (
    GuardrailCheckRequest, GuardrailCheckResponse, GuardrailViolation,
    GuardrailRulesResponse, GuardrailRuleInfo,
    GuardrailRulesUpdateRequest,
)
from mac.services import guardrail_service
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User
from mac.models.guardrail import GuardrailRule

router = APIRouter(prefix="/guardrails", tags=["Guardrails"])


@router.post("/check-input", response_model=GuardrailCheckResponse)
async def check_input(
    body: GuardrailCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run input text through content filters."""
    db_rules = await guardrail_service.get_db_rules(db)
    result = guardrail_service.check_input(body.text, db_rules)
    return GuardrailCheckResponse(
        safe=result["safe"],
        text=result["text"],
        violations=[GuardrailViolation(**v) for v in result["violations"]],
        checked_rules=result["checked_rules"],
    )


@router.post("/check-output", response_model=GuardrailCheckResponse)
async def check_output(
    body: GuardrailCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run model output through safety filters (PII redaction, harmful content check)."""
    db_rules = await guardrail_service.get_db_rules(db)
    result = guardrail_service.check_output(body.text, db_rules)
    return GuardrailCheckResponse(
        safe=result["safe"],
        text=result["text"],
        violations=[GuardrailViolation(**v) for v in result["violations"]],
        checked_rules=result["checked_rules"],
    )


@router.get("/rules", response_model=GuardrailRulesResponse)
async def get_rules(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """List all active guardrail rules (admin-only)."""
    rules = await guardrail_service.get_all_rules(db)
    return GuardrailRulesResponse(
        rules=[GuardrailRuleInfo(
            id=r.id,
            category=r.category,
            action=r.action,
            pattern=r.pattern,
            description=r.description,
            enabled=r.enabled,
            priority=r.priority,
        ) for r in rules],
        total=len(rules),
    )


@router.put("/rules", response_model=GuardrailRulesResponse)
async def update_rules(
    body: GuardrailRulesUpdateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update guardrail rules — replaces all existing rules (admin-only)."""
    rules_data = [r.model_dump() for r in body.rules]
    new_rules = await guardrail_service.save_rules(db, rules_data)
    return GuardrailRulesResponse(
        rules=[GuardrailRuleInfo(
            id=r.id,
            category=r.category,
            action=r.action,
            pattern=r.pattern,
            description=r.description,
            enabled=r.enabled,
            priority=r.priority,
        ) for r in new_rules],
        total=len(new_rules),
    )


@router.patch("/rules/{rule_id}/toggle")
async def toggle_rule(
    rule_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Enable or disable a single guardrail rule (admin-only)."""
    rule = (await db.execute(select(GuardrailRule).where(GuardrailRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.enabled = not rule.enabled
    await db.commit()
    return {"id": rule_id, "enabled": rule.enabled}


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a guardrail rule (admin-only)."""
    rule = (await db.execute(select(GuardrailRule).where(GuardrailRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()
    return {"deleted": rule_id}


@router.post("/rules")
async def add_rule(
    body: dict = Body(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Add a single new guardrail rule (admin-only)."""
    import uuid
    rule = GuardrailRule(
        id=str(uuid.uuid4()),
        category=body.get("category", "custom"),
        action=body.get("action", "block"),
        pattern=body.get("pattern", ""),
        description=body.get("description", ""),
        enabled=body.get("enabled", True),
        priority=body.get("priority", 100),
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return GuardrailRuleInfo(
        id=rule.id, category=rule.category, action=rule.action,
        pattern=rule.pattern, description=rule.description,
        enabled=rule.enabled, priority=rule.priority,
    )
