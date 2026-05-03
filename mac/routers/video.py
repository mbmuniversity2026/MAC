"""Video Studio — admin-only FFmpeg-driven video editor.

Admin-only always — no feature flag can restrict this.
"""

import asyncio
import json
import mimetypes
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db
from mac.middleware.auth_middleware import require_admin
from mac.models.user import User
from mac.models.video import VideoProject, VideoJob
from mac.services import llm_service, activity_service

router = APIRouter(prefix="/admin/video", tags=["Video Studio"])

VIDEO_DIR = Path(os.environ.get("MAC_VIDEO_DIR", "./data/video_studio"))
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
(VIDEO_DIR / "uploads").mkdir(exist_ok=True)
(VIDEO_DIR / "outputs").mkdir(exist_ok=True)

ALLOWED_MEDIA = {
    ".mp4", ".mov", ".mkv", ".avi", ".webm",
    ".mp3", ".wav", ".ogg", ".m4a",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
}

_running_jobs: dict[str, asyncio.subprocess.Process] = {}


def _utcnow():
    return datetime.now(timezone.utc)


def _safe_cmd(cmd: str) -> bool:
    """Reject obviously dangerous shell patterns."""
    dangerous = [";", "&&", "||", "`", "$(",  "rm ", "del ", "format ", ">", ">>", "|"]
    cmd_lower = cmd.lower()
    return not any(d in cmd_lower for d in dangerous)


# ── Projects ──────────────────────────────────────────────────────────────────

@router.post("/projects", status_code=201)
async def create_project(
    body: dict,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    name = (body.get("name") or "Untitled Project").strip()[:200]
    proj = VideoProject(name=name, owner_id=admin.id)
    db.add(proj)
    await db.commit()
    await activity_service.log("video", f"Admin created video project '{name}'")
    return {"id": proj.id, "name": proj.name, "created_at": proj.created_at.isoformat()}


@router.get("/projects")
async def list_projects(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VideoProject).where(VideoProject.status == "active").order_by(VideoProject.created_at.desc())
    )
    projects = result.scalars().all()
    return [
        {
            "id": p.id, "name": p.name,
            "file_count": len(p.files_json or []),
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
        }
        for p in projects
    ]


@router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    proj = (await db.execute(
        select(VideoProject).where(VideoProject.id == project_id)
    )).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "id": proj.id, "name": proj.name,
        "files": proj.files_json or [],
        "timeline": proj.timeline_json or {},
        "created_at": proj.created_at.isoformat(),
    }


# ── Media upload ──────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/upload", status_code=201)
async def upload_media(
    project_id: str,
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    proj = (await db.execute(
        select(VideoProject).where(VideoProject.id == project_id)
    )).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    ext = Path(file.filename or "file").suffix.lower()
    if ext not in ALLOWED_MEDIA:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    file_id = str(uuid.uuid4())
    dest = VIDEO_DIR / "uploads" / f"{file_id}{ext}"
    size = 0
    with dest.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > 2 * 1024 * 1024 * 1024:  # 2 GB
                dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="File exceeds 2 GB limit")
            f.write(chunk)

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    media_type = "video" if mime.startswith("video") else ("audio" if mime.startswith("audio") else "image")

    entry = {
        "id": file_id,
        "filename": file.filename,
        "path": str(dest),
        "mime": mime,
        "media_type": media_type,
        "size": size,
        "uploaded_at": _utcnow().isoformat(),
    }
    files = list(proj.files_json or [])
    files.append(entry)
    proj.files_json = files
    await db.commit()
    await activity_service.log("video", f"Admin uploaded '{file.filename}' to project '{proj.name}'")
    return entry


@router.delete("/projects/{project_id}/files/{file_id}", status_code=204)
async def delete_media(
    project_id: str,
    file_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    proj = (await db.execute(
        select(VideoProject).where(VideoProject.id == project_id)
    )).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    files = [f for f in (proj.files_json or []) if f["id"] != file_id]
    removed = [f for f in (proj.files_json or []) if f["id"] == file_id]
    for f in removed:
        Path(f["path"]).unlink(missing_ok=True)
    proj.files_json = files
    await db.commit()


# ── Timeline save ─────────────────────────────────────────────────────────────

@router.put("/projects/{project_id}/timeline")
async def save_timeline(
    project_id: str,
    body: dict,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    proj = (await db.execute(
        select(VideoProject).where(VideoProject.id == project_id)
    )).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    proj.timeline_json = body
    await db.commit()
    return {"status": "saved"}


# ── AI Agent — generate FFmpeg command ────────────────────────────────────────

@router.post("/projects/{project_id}/agent")
async def ai_agent(
    project_id: str,
    body: dict,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Ask the AI to generate an FFmpeg command from a natural language instruction."""
    instruction = (body.get("instruction") or "").strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="instruction is required")

    proj = (await db.execute(
        select(VideoProject).where(VideoProject.id == project_id)
    )).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    files = proj.files_json or []
    file_list = "\n".join(
        f"  {i+1}. {f['filename']} ({f['media_type']}, {f['size']//1024}KB) → {f['path']}"
        for i, f in enumerate(files)
    ) or "  (no media files uploaded yet)"

    output_dir = str(VIDEO_DIR / "outputs")
    system = f"""You are a video editing AI for MAC (MBM AI Cloud).
The user gives instructions in plain English or Hindi.
Generate a safe FFmpeg command for the requested operation.

Available media files:
{file_list}

Output directory: {output_dir}/

Format your response EXACTLY as:
DESCRIPTION: <one line describing what the command does>
COMMAND: ffmpeg <arguments>

Rules:
- Use absolute paths from the file list above
- Output files go to: {output_dir}/output_<timestamp>.mp4 (or appropriate extension)
- Never use shell operators (; && || | > >> ` $())
- Keep commands safe and correct
"""

    try:
        result = await llm_service.chat_completion(
            model="qwen2.5:7b",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": instruction},
            ],
            temperature=0.2,
            max_tokens=512,
        )
        content = result["choices"][0]["message"]["content"].strip()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI unavailable: {str(e)}")

    # Parse DESCRIPTION and COMMAND
    description = ""
    command = ""
    for line in content.splitlines():
        if line.upper().startswith("DESCRIPTION:"):
            description = line.split(":", 1)[1].strip()
        elif line.upper().startswith("COMMAND:"):
            command = line.split(":", 1)[1].strip()

    if not command:
        # Fallback: take the whole response as the command
        command = content

    return {
        "description": description or "Run FFmpeg command",
        "command": command,
        "raw": content,
    }


# ── Job: create + run ─────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/jobs", status_code=201)
async def create_job(
    project_id: str,
    body: dict,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new FFmpeg job for a project."""
    command = (body.get("command") or "").strip()
    description = (body.get("description") or "FFmpeg job").strip()

    if not command:
        raise HTTPException(status_code=400, detail="command is required")
    if not command.lstrip().startswith("ffmpeg"):
        raise HTTPException(status_code=400, detail="Command must start with 'ffmpeg'")
    if not _safe_cmd(command):
        raise HTTPException(status_code=400, detail="Command contains unsafe shell operators")

    proj = (await db.execute(
        select(VideoProject).where(VideoProject.id == project_id)
    )).scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    job = VideoJob(
        project_id=project_id,
        description=description,
        ffmpeg_command=command,
        status="queued",
    )
    db.add(job)
    await db.commit()
    return {"id": job.id, "status": job.status, "description": description}


@router.post("/jobs/{job_id}/run")
async def run_job(
    job_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Start executing an FFmpeg job. Returns SSE progress stream."""
    job = (await db.execute(
        select(VideoJob).where(VideoJob.id == job_id)
    )).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == "running":
        raise HTTPException(status_code=409, detail="Job is already running")

    job.status = "running"
    job.started_at = _utcnow()
    await db.commit()

    cmd = job.ffmpeg_command
    await activity_service.log("video", f"Admin started FFmpeg job: {job.description[:60]}")

    async def _stream():
        yield f"data: {json.dumps({'type': 'start', 'job_id': job_id})}\n\n"
        try:
            # Add progress reporting: -progress pipe:1 -nostats
            progress_cmd = cmd + " -progress pipe:1 -nostats -y"
            proc = await asyncio.create_subprocess_shell(
                progress_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _running_jobs[job_id] = proc

            duration_us = 0
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()

                # Parse ffmpeg progress key=value pairs
                if "=" in text:
                    key, _, val = text.partition("=")
                    key = key.strip()
                    val = val.strip()
                    if key == "out_time_us" and val.isdigit():
                        out_us = int(val)
                        pct = min(99, int(out_us / max(duration_us, 1) * 100)) if duration_us else 0
                        async with get_db() as db2:
                            j2 = (await db2.execute(select(VideoJob).where(VideoJob.id == job_id))).scalar_one_or_none()
                            if j2:
                                j2.progress_pct = pct
                                await db2.commit()
                        yield f"data: {json.dumps({'type': 'progress', 'pct': pct})}\n\n"
                    elif key == "duration" and ":" in val:
                        # Parse HH:MM:SS.ms
                        try:
                            parts = val.split(":")
                            h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
                            duration_us = int((h * 3600 + m * 60 + s) * 1_000_000)
                        except Exception:
                            pass
                    elif key == "progress" and val == "end":
                        break

            await proc.wait()
            _running_jobs.pop(job_id, None)

            # Determine output file
            output_path = None
            stderr_output = (await proc.stderr.read()).decode("utf-8", errors="replace")
            if proc.returncode == 0:
                # Find output path from command (last .mp4/.mkv/.webm etc in command)
                import re
                matches = re.findall(r'["\']?(/[^\s"\']+\.(?:mp4|mkv|webm|mp3|wav|gif))["\']?', cmd)
                if matches:
                    output_path = matches[-1]

                async with get_db() as db2:
                    j2 = (await db2.execute(select(VideoJob).where(VideoJob.id == job_id))).scalar_one_or_none()
                    if j2:
                        j2.status = "done"
                        j2.progress_pct = 100
                        j2.completed_at = _utcnow()
                        j2.output_path = output_path
                        await db2.commit()

                await activity_service.log("video", f"FFmpeg job completed: {job.description[:60]}")
                yield f"data: {json.dumps({'type': 'done', 'output_path': output_path})}\n\n"
            else:
                err_msg = stderr_output[-500:] if stderr_output else "FFmpeg failed"
                async with get_db() as db2:
                    j2 = (await db2.execute(select(VideoJob).where(VideoJob.id == job_id))).scalar_one_or_none()
                    if j2:
                        j2.status = "error"
                        j2.error_message = err_msg
                        j2.completed_at = _utcnow()
                        await db2.commit()

                yield f"data: {json.dumps({'type': 'error', 'message': err_msg[:300]})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/jobs/{job_id}/progress")
async def job_progress(
    job_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get current job progress."""
    job = (await db.execute(select(VideoJob).where(VideoJob.id == job_id))).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "id": job.id, "status": job.status,
        "progress_pct": job.progress_pct,
        "description": job.description,
        "output_path": job.output_path,
        "error_message": job.error_message,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


@router.post("/jobs/{job_id}/cancel", status_code=200)
async def cancel_job(
    job_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    proc = _running_jobs.get(job_id)
    if proc:
        proc.terminate()
    job = (await db.execute(select(VideoJob).where(VideoJob.id == job_id))).scalar_one_or_none()
    if job:
        job.status = "cancelled"
        job.completed_at = _utcnow()
        await db.commit()
    return {"status": "cancelled"}


@router.get("/projects/{project_id}/jobs")
async def list_jobs(
    project_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VideoJob).where(VideoJob.project_id == project_id).order_by(VideoJob.created_at.desc())
    )
    jobs = result.scalars().all()
    return [
        {
            "id": j.id, "description": j.description, "status": j.status,
            "progress_pct": j.progress_pct, "output_path": j.output_path,
            "created_at": j.created_at.isoformat(),
            "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        }
        for j in jobs
    ]


# ── Activity SSE stream ────────────────────────────────────────────────────────

@router.get("/admin/activity/stream")
async def activity_stream(
    admin: User = Depends(require_admin),
):
    """SSE stream of live platform activity (admin only)."""
    q = await activity_service.subscribe()

    async def _gen():
        # Send recent history first
        for entry in reversed(activity_service.get_recent(50)):
            yield f"data: {json.dumps(entry)}\n\n"

        try:
            while True:
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            activity_service.unsubscribe(q)

    return StreamingResponse(_gen(), media_type="text/event-stream")
