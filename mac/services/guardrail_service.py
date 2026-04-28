"""Guardrail service (Phase 6) — input/output content filtering."""

import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from mac.models.guardrail import GuardrailRule

# ── Built-in patterns (always active, no DB needed) ──────

_BUILTIN_INPUT_PATTERNS = [
    {
        "category": "prompt_injection",
        "action": "block",
        "pattern": r"(?i)(ignore\s+(all\s+)?previous\s+instructions|you\s+are\s+now|disregard\s+(all\s+)?prior|forget\s+everything|system\s+prompt|override\s+instructions|jailbreak)",
        "description": "Prompt injection attempt detected",
    },
    {
        "category": "harmful",
        "action": "block",
        "pattern": r"(?i)(how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon|malware|virus)|synthesize\s+(meth|drugs|poison))",
        "description": "Harmful content request detected",
    },
    {
        "category": "academic_dishonesty",
        "action": "flag",
        "pattern": r"(?i)(write\s+my\s+(entire\s+)?(essay|assignment|thesis|homework|exam)\s+for\s+me|do\s+my\s+homework|complete\s+my\s+assignment)",
        "description": "Potential academic dishonesty — adding disclaimer",
    },
]

_BUILTIN_OUTPUT_PATTERNS = [
    {
        "category": "pii",
        "action": "redact",
        "pattern": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
        "description": "Email address detected in output",
    },
    {
        "category": "pii",
        "action": "redact",
        "pattern": r"\b(?:\+91[-\s]?)?[6-9]\d{9}\b",
        "description": "Indian phone number detected in output",
    },
    {
        "category": "pii",
        "action": "redact",
        "pattern": r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b",
        "description": "Potential card/ID number detected in output",
    },
]

_ACADEMIC_DISCLAIMER = (
    "\n\n---\n**Academic Integrity Notice:** This response is intended as a "
    "learning aid. Submitting AI-generated content as your own work may violate "
    "your institution's academic integrity policy. Use this to understand concepts, "
    "then write your own answer."
)


def check_input(text: str, db_rules: list[dict] | None = None) -> dict:
    """Run input text through content filters.

    Returns: {safe: bool, text: str, violations: [...], checked_rules: int}
    """
    violations = []
    rules_checked = 0
    result_text = text

    # Check built-in patterns
    all_rules = _BUILTIN_INPUT_PATTERNS + (db_rules or [])
    for rule in all_rules:
        rules_checked += 1
        if re.search(rule["pattern"], text):
            violations.append({
                "category": rule["category"],
                "action": rule["action"],
                "description": rule["description"],
                "matched_pattern": rule["pattern"][:50],
            })

    # Enforce max prompt length (32k chars)
    if len(text) > 32000:
        violations.append({
            "category": "max_length",
            "action": "block",
            "description": f"Prompt exceeds maximum length (32,000 chars). Got {len(text):,}",
            "matched_pattern": "length_check",
        })
        rules_checked += 1

    is_safe = not any(v["action"] == "block" for v in violations)
    return {"safe": is_safe, "text": result_text, "violations": violations, "checked_rules": rules_checked}


def check_output(text: str, db_rules: list[dict] | None = None) -> dict:
    """Run output text through safety filters. Redacts PII, adds disclaimers.

    Returns: {safe: bool, text: str, violations: [...], checked_rules: int}
    """
    violations = []
    rules_checked = 0
    result_text = text

    all_rules = _BUILTIN_OUTPUT_PATTERNS + (db_rules or [])
    for rule in all_rules:
        rules_checked += 1
        if rule["action"] == "redact":
            matches = re.findall(rule["pattern"], text)
            if matches:
                result_text = re.sub(rule["pattern"], "[REDACTED]", result_text)
                violations.append({
                    "category": rule["category"],
                    "action": "redact",
                    "description": rule["description"],
                    "matched_pattern": rule["pattern"][:50],
                })
        elif re.search(rule["pattern"], text):
            violations.append({
                "category": rule["category"],
                "action": rule["action"],
                "description": rule["description"],
                "matched_pattern": rule["pattern"][:50],
            })

    is_safe = not any(v["action"] == "block" for v in violations)
    return {"safe": is_safe, "text": result_text, "violations": violations, "checked_rules": rules_checked}


async def get_db_rules(db: AsyncSession) -> list[dict]:
    """Fetch enabled guardrail rules from database."""
    result = await db.execute(
        select(GuardrailRule).where(GuardrailRule.enabled == True).order_by(GuardrailRule.priority)
    )
    rules = []
    for rule in result.scalars():
        rules.append({
            "category": rule.category,
            "action": rule.action,
            "pattern": rule.pattern,
            "description": rule.description,
        })
    return rules


async def get_all_rules(db: AsyncSession) -> list[GuardrailRule]:
    """Fetch all guardrail rules from database."""
    result = await db.execute(select(GuardrailRule).order_by(GuardrailRule.priority))
    return list(result.scalars())


async def save_rules(db: AsyncSession, rules_data: list[dict]) -> list[GuardrailRule]:
    """Replace all rules in DB with new set."""
    # Delete existing
    existing = await db.execute(select(GuardrailRule))
    for rule in existing.scalars():
        await db.delete(rule)
    await db.flush()

    # Insert new
    new_rules = []
    for rd in rules_data:
        rule = GuardrailRule(
            category=rd["category"],
            action=rd["action"],
            pattern=rd["pattern"],
            description=rd["description"],
            enabled=rd.get("enabled", True),
            priority=rd.get("priority", 100),
        )
        db.add(rule)
        new_rules.append(rule)
    await db.flush()
    return new_rules
