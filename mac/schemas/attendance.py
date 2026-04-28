"""Schemas for attendance system."""

from pydantic import BaseModel, Field
from datetime import datetime, date
from typing import Optional


class CreateAttendanceSessionRequest(BaseModel):
    title: str = Field(max_length=200)
    department: str = Field(max_length=50)
    subject: Optional[str] = Field(default=None, max_length=100)
    session_date: date


class AttendanceSessionResponse(BaseModel):
    id: str
    title: str
    department: str
    subject: Optional[str]
    session_date: date
    is_open: bool
    opened_by: str
    opened_at: datetime
    closed_at: Optional[datetime]
    record_count: int = 0


class MarkAttendanceRequest(BaseModel):
    session_id: str
    face_image_base64: str  # base64 encoded JPEG from camera


class AttendanceRecordResponse(BaseModel):
    id: str
    session_id: str
    user_id: str
    student_name: Optional[str] = None
    roll_number: Optional[str] = None
    department: Optional[str] = None
    face_match_confidence: float
    face_verified: bool
    marked_at: datetime


class RegisterFaceRequest(BaseModel):
    face_image_base64: str  # base64 encoded JPEG


class RegisterFaceResponse(BaseModel):
    success: bool
    message: str


class AttendanceReportResponse(BaseModel):
    session: AttendanceSessionResponse
    records: list[AttendanceRecordResponse]
    total_present: int
    total_absent: int


class StudentAttendanceSummary(BaseModel):
    user_id: str
    student_name: str
    roll_number: str
    department: str
    total_sessions: int
    sessions_attended: int
    attendance_pct: float
