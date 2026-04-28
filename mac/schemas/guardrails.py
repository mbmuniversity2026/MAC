"""Guardrail schemas (Phase 6)."""

from pydantic import BaseModel, Field
from typing import Optional, List


class GuardrailCheckRequest(BaseModel):
    text: str = Field(..., max_length=50000)
    check_type: str = Field(default="input", pattern="^(input|output)$")


class GuardrailViolation(BaseModel):
    category: str
    action: str  # block | flag | redact | log
    description: str
    matched_pattern: str = ""


class GuardrailCheckResponse(BaseModel):
    safe: bool
    text: str  # original or redacted text
    violations: List[GuardrailViolation] = []
    checked_rules: int = 0


class GuardrailRuleInfo(BaseModel):
    id: str
    category: str
    action: str
    pattern: str
    description: str
    enabled: bool
    priority: int


class GuardrailRulesResponse(BaseModel):
    rules: List[GuardrailRuleInfo]
    total: int


class GuardrailRuleCreateRequest(BaseModel):
    category: str = Field(..., pattern="^(prompt_injection|harmful|academic_dishonesty|pii|max_length|custom)$")
    action: str = Field(default="block", pattern="^(block|flag|redact|log)$")
    pattern: str = Field(..., max_length=2000)
    description: str = Field(..., max_length=200)
    enabled: bool = True
    priority: int = Field(default=100, ge=1, le=1000)


class GuardrailRulesUpdateRequest(BaseModel):
    rules: List[GuardrailRuleCreateRequest]
