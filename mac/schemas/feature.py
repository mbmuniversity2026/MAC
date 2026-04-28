"""Feature flag request/response schemas."""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class FeatureFlagOut(BaseModel):
    key: str
    label: str
    description: Optional[str] = None
    enabled: bool
    allowed_roles: list[str] = Field(default_factory=list)
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None

    class Config:
        from_attributes = True


class FeatureFlagUpdate(BaseModel):
    enabled: Optional[bool] = None
    allowed_roles: Optional[list[str]] = None


class FeatureStatusResponse(BaseModel):
    """Compact dict-shaped status for the no-auth status endpoint."""
    flags: dict[str, bool]
    roles: dict[str, list[str]]
