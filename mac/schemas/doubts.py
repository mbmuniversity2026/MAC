"""Schemas for student doubts/questions system."""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class CreateDoubtRequest(BaseModel):
    title: str = Field(max_length=300)
    body: str = Field(max_length=10000)
    department: str = Field(max_length=50)
    subject: Optional[str] = Field(default=None, max_length=100)
    target_faculty_id: Optional[str] = None
    is_anonymous: bool = False


class DoubtResponse(BaseModel):
    id: str
    title: str
    body: str
    department: str
    subject: Optional[str]
    target_faculty_id: Optional[str]
    student_id: str
    student_name: Optional[str] = None
    student_roll: Optional[str] = None
    status: str
    attachment_url: Optional[str]
    attachment_name: Optional[str]
    is_anonymous: bool
    reply_count: int = 0
    created_at: datetime
    updated_at: datetime


class CreateDoubtReplyRequest(BaseModel):
    body: str = Field(max_length=10000)


class DoubtReplyResponse(BaseModel):
    id: str
    doubt_id: str
    author_id: str
    author_name: Optional[str] = None
    author_role: Optional[str] = None
    body: str
    attachment_url: Optional[str]
    attachment_name: Optional[str]
    created_at: datetime


class DoubtListResponse(BaseModel):
    doubts: list[DoubtResponse]
    total: int
    page: int
    per_page: int


class DoubtDetailResponse(BaseModel):
    doubt: DoubtResponse
    replies: list[DoubtReplyResponse]
