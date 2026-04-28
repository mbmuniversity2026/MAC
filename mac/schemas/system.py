"""System version / update schemas."""

from typing import Optional
from pydantic import BaseModel


class VersionInfo(BaseModel):
    version: str
    build_date: Optional[str] = None


class UpdateStatus(BaseModel):
    current: str
    latest: Optional[str] = None
    update_available: bool = False
    notes: Optional[str] = None
    release_url: Optional[str] = None
    checked_at: Optional[str] = None
    error: Optional[str] = None
