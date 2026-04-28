"""Admin-uploaded files shared to users + per-download audit trail."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, BigInteger, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from mac.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


def _gen_uuid():
    return str(uuid.uuid4())


class SharedFile(Base):
    """A file uploaded by admin and made downloadable by a target audience."""
    __tablename__ = "shared_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_gen_uuid)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    # recipient_type: "all" | "branch" | "section" | "role" | "user"
    recipient_type: Mapped[str] = mapped_column(String(16), nullable=False, default="all")
    # recipient_json: shape depends on recipient_type, e.g. {"branch_id": "..."}, {"role": "student"}
    recipient_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class FileDownload(Base):
    """One download event of a shared file."""
    __tablename__ = "file_downloads"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("shared_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
