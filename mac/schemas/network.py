"""Network info / discovery schemas."""

from typing import Optional
from pydantic import BaseModel, Field


class NetworkInfo(BaseModel):
    primary: str
    all_ips: list[str] = Field(default_factory=list)
    hostname: str
    qr_svg: str  # inline SVG of "http://<primary>"


class DiscoveredNode(BaseModel):
    ip: str
    hostname: Optional[str] = None
    version: Optional[str] = None
    raw: str
