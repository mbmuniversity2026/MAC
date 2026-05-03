"""
File sharing API — admin uploads files, users download them.
Files are stored on disk at SHARED_FILES_DIR (default: ./shared_files/).
"""

import os
import uuid
import shutil
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from mac.database import get_db
from mac.middleware.auth_middleware import require_admin, get_current_user
from mac.middleware.feature_gate import feature_required
from mac.models.file_share import SharedFile, FileDownload
from mac.models.user import User

router = APIRouter(prefix="/files", tags=["File Sharing"],
                   dependencies=[Depends(feature_required("file_sharing"))])

SHARED_FILES_DIR = Path(os.environ.get("MAC_SHARED_FILES_DIR", "./shared_files"))
SHARED_FILES_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_MB = int(os.environ.get("MAC_MAX_FILE_MB", "500"))


def _utcnow():
    return datetime.now(timezone.utc)


# ── Admin: upload ──────────────────────────────────────────────────────────────

@router.post("/upload", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    display_name: Optional[str] = Query(None),
    recipient_type: str = Query("all"),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file to share with students/faculty."""
    # Size check (stream to temp first)
    file_id = str(uuid.uuid4())
    ext = Path(file.filename or "file").suffix
    stored_name = f"{file_id}{ext}"
    dest = SHARED_FILES_DIR / stored_name

    size = 0
    with dest.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_MB * 1024 * 1024:
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail={
                    "code": "file_too_large",
                    "message": f"File exceeds {MAX_FILE_MB} MB limit.",
                })
            f.write(chunk)

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

    shared = SharedFile(
        id=file_id,
        filename=stored_name,
        display_name=display_name or file.filename,
        size_bytes=size,
        mime_type=mime,
        storage_path=str(dest),
        uploaded_by=admin.id,
        recipient_type=recipient_type,
    )
    db.add(shared)
    await db.commit()
    return {
        "id": shared.id,
        "display_name": shared.display_name,
        "size_bytes": size,
        "mime_type": mime,
    }


# ── List files ────────────────────────────────────────────────────────────────

@router.get("")
async def list_files(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List files visible to current user."""
    stmt = select(SharedFile).order_by(SharedFile.created_at.desc())
    files = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": f.id,
            "display_name": f.display_name or f.filename,
            "size_bytes": f.size_bytes,
            "mime_type": f.mime_type,
            "recipient_type": f.recipient_type,
            "download_count": f.download_count,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "expires_at": f.expires_at.isoformat() if f.expires_at else None,
        }
        for f in files
        if f.expires_at is None or f.expires_at > _utcnow()
    ]


# ── Download ──────────────────────────────────────────────────────────────────

@router.get("/{file_id}/download")
async def download_file(
    file_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a shared file and record the download event."""
    shared = (await db.execute(
        select(SharedFile).where(SharedFile.id == file_id)
    )).scalar_one_or_none()

    if not shared:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "File not found."})

    if shared.expires_at and shared.expires_at < _utcnow():
        raise HTTPException(status_code=410, detail={"code": "expired", "message": "File has expired."})

    path = Path(shared.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail={"code": "missing", "message": "File data missing on disk."})

    # Record download
    dl = FileDownload(
        file_id=file_id,
        user_id=user.id,
        ip=request.client.host if request.client else None,
    )
    db.add(dl)
    shared.download_count = (shared.download_count or 0) + 1
    await db.commit()

    return FileResponse(
        path=str(path),
        filename=shared.display_name or shared.filename,
        media_type=shared.mime_type or "application/octet-stream",
    )


# ── Preview (inline viewing before download) ─────────────────────────────────

PREVIEWABLE_MIME = {
    # Images
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    # Video
    "video/mp4", "video/webm", "video/ogg",
    # Audio
    "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp3",
    # Documents
    "application/pdf",
    # Text / code
    "text/plain", "text/html", "text/css", "text/javascript",
    "application/json", "text/markdown", "text/csv",
    "text/x-python", "application/x-python",
}


@router.get("/{file_id}/preview")
async def preview_file(
    file_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream a file inline (not as attachment) for browser preview."""
    shared = (await db.execute(
        select(SharedFile).where(SharedFile.id == file_id)
    )).scalar_one_or_none()

    if not shared:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "File not found."})

    if shared.expires_at and shared.expires_at < _utcnow():
        raise HTTPException(status_code=410, detail={"code": "expired", "message": "File has expired."})

    path = Path(shared.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail={"code": "missing", "message": "File data missing."})

    mime = shared.mime_type or "application/octet-stream"

    # Only serve inline for safe previewable types
    if mime not in PREVIEWABLE_MIME:
        raise HTTPException(status_code=415, detail={
            "code": "not_previewable",
            "message": "This file type cannot be previewed inline.",
        })

    # For CSV: send as text/plain so browser renders it
    if mime == "text/csv":
        mime = "text/plain; charset=utf-8"

    from fastapi.responses import FileResponse
    return FileResponse(
        path=str(path),
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{shared.display_name or shared.filename}"'},
    )


# ── Admin: delete ─────────────────────────────────────────────────────────────

@router.delete("/{file_id}", status_code=204)
async def delete_file(
    file_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    shared = (await db.execute(
        select(SharedFile).where(SharedFile.id == file_id)
    )).scalar_one_or_none()
    if not shared:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "File not found."})

    path = Path(shared.storage_path)
    if path.exists():
        path.unlink()

    await db.delete(shared)
    await db.commit()


# ── Admin: download stats ─────────────────────────────────────────────────────

@router.get("/{file_id}/stats")
async def file_stats(
    file_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    shared = (await db.execute(
        select(SharedFile).where(SharedFile.id == file_id)
    )).scalar_one_or_none()
    if not shared:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "File not found."})

    downloads = (await db.execute(
        select(FileDownload).where(FileDownload.file_id == file_id)
        .order_by(FileDownload.downloaded_at.desc()).limit(100)
    )).scalars().all()

    return {
        "id": shared.id,
        "display_name": shared.display_name,
        "download_count": shared.download_count,
        "downloads": [
            {"user_id": d.user_id, "ip": d.ip, "at": d.downloaded_at.isoformat()}
            for d in downloads
        ],
    }
