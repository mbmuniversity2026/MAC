"""First-boot setup schemas."""

from typing import Optional
from pydantic import BaseModel, Field, EmailStr


class SetupStatus(BaseModel):
    is_first_run: bool
    has_jwt_secret: bool
    version: str


class CreateAdminRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=200)  # not EmailStr to avoid email-validator dep
    password: str = Field(..., min_length=8, max_length=128)


class CreateAdminResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict  # minimal user payload — full UserProfile lives in mac.schemas.auth
