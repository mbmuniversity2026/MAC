"""MBM Book IDE — REST endpoints + WebSocket terminal.

Endpoints:
  POST   /mbmbook/session/start      — Allocate container on best cluster node
  DELETE /mbmbook/session/stop       — Stop and remove container (keeps volume)
  GET    /mbmbook/session            — Get current session status
  DELETE /mbmbook/workspace          — Delete workspace volume (all files gone)

  GET    /mbmbook/files              — List workspace files (?path=)
  GET    /mbmbook/files/read         — Read file content (?path=)
  POST   /mbmbook/files/write        — Write file content (JSON body)
  POST   /mbmbook/files/upload       — Upload file (multipart)
  GET    /mbmbook/files/download     — Download file (?path=)
  DELETE /mbmbook/files              — Delete file or directory (?path=)
  POST   /mbmbook/files/mkdir        — Create directory (JSON body)

  WS     /ws/mbmbook/terminal        — Full PTY terminal in container
"""

from __future__ import annotations

import asyncio
import json
import os
import struct
import sys

from fastapi import (
    APIRouter, Depends, HTTPException, Query,
    UploadFile, File, WebSocket, WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db, async_session
from mac.middleware.auth_middleware import get_current_user
from mac.models.user import User
from mac.services import mbmbook_service as svc
from mac.utils.security import decode_access_token
from mac.services.auth_service import get_user_by_id

router = APIRouter(prefix="/mbmbook", tags=["MBM Book IDE"])
ws_router = APIRouter(tags=["MBM Book WS"])  # no prefix — WS path is absolute

_USE_PTY = sys.platform != "win32"
if _USE_PTY:
    import fcntl
    import termios


# ── Pydantic schemas ──────────────────────────────────────────

class WriteBody(BaseModel):
    path: str
    content: str          # always text; binary via upload endpoint
    encoding: str = "utf-8"


class MkdirBody(BaseModel):
    path: str


# ── Helpers ───────────────────────────────────────────────────

def _session_dict(s) -> dict:
    return {
        "id": s.id,
        "status": s.status,
        "container_name": s.container_name,
        "node_ip": s.node_ip,
        "volume_name": s.volume_name,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "last_activity": s.last_activity.isoformat() if s.last_activity else None,
        "error_message": s.error_message,
    }


async def _require_running(user: User, db: AsyncSession):
    """Return the user's running session or raise 409."""
    session = await svc.get_session(db, user.id)
    if not session or session.status not in ("running", "starting"):
        raise HTTPException(
            status_code=409,
            detail="No active workspace. POST /mbmbook/session/start first.",
        )
    return session


# ── Session endpoints ─────────────────────────────────────────

@router.post("/session/start")
async def start_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Allocate or reconnect a Docker workspace container."""
    username = getattr(current_user, "name", "") or getattr(current_user, "username", "") or current_user.id
    session = await svc.start_session(db, current_user.id, username)
    try:
        from mac.services import activity_service as _act
        from datetime import datetime, timezone, timedelta
        _ist = datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%d/%m/%Y %H:%M:%S IST")
        await _act.log("mbmbook", f"[{_ist}] {current_user.name or current_user.roll_number} ENTERED MBM Book IDE — container: {session.container_name or 'starting'}")
    except Exception:
        pass
    return _session_dict(session)


@router.delete("/session/stop")
async def stop_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stop the container. Workspace volume is kept."""
    await svc.stop_session(db, current_user.id)
    try:
        from mac.services import activity_service as _act
        from datetime import datetime, timezone, timedelta
        _ist = datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%d/%m/%Y %H:%M:%S IST")
        await _act.log("mbmbook", f"[{_ist}] {current_user.name or current_user.roll_number} EXITED MBM Book IDE — container stopped")
    except Exception:
        pass
    return {"status": "stopped"}


@router.get("/session")
async def get_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return current session info (or null if none)."""
    session = await svc.get_session(db, current_user.id)
    if not session:
        return {"session": None}
    return {"session": _session_dict(session)}


class ActivityBody(BaseModel):
    event: str
    detail: str = ""
    ist: str = ""


@router.post("/activity")
async def log_activity(
    body: ActivityBody,
    current_user: User = Depends(get_current_user),
):
    """Log a client-side MBM Book activity event (entry, exit, fullscreen, etc.).
    Events are written to the server log and pushed to the admin activity stream."""
    import logging
    _log = logging.getLogger("mbmbook.activity")
    _log.info(
        "[MBM Book] event=%s user=%s (%s) ist=%s detail=%s",
        body.event, current_user.roll_number, current_user.name, body.ist, body.detail,
    )
    # Push to admin activity SSE stream
    try:
        from mac.services import activity_service
        await activity_service.log(
            "mbmbook",
            f"[{body.ist}] {current_user.name or current_user.roll_number} — {body.event}: {body.detail}",
        )
    except Exception:
        pass
    return {"ok": True}


@router.delete("/workspace")
async def delete_workspace(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete the workspace volume — all files are gone."""
    await svc.delete_workspace_volume(db, current_user.id)
    return {"status": "deleted"}


# ── File endpoints ────────────────────────────────────────────

@router.get("/files")
async def list_files(
    path: str = Query(default="/workspace"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _require_running(current_user, db)
    files = await svc.list_files(session, path)
    return {"files": files}


@router.get("/files/read")
async def read_file(
    path: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _require_running(current_user, db)
    try:
        content = await svc.read_file(session, path)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Cannot read file: {exc}")
    # Return as text if decodable, else base64
    try:
        text = content.decode("utf-8")
        return {"content": text, "encoding": "utf-8"}
    except UnicodeDecodeError:
        import base64
        return {"content": base64.b64encode(content).decode(), "encoding": "base64"}


@router.post("/files/write")
async def write_file(
    body: WriteBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _require_running(current_user, db)
    await svc.write_file(session, body.path, body.content.encode(body.encoding, errors="replace"))
    return {"status": "ok", "path": body.path}


@router.post("/files/upload")
async def upload_file(
    path: str = Query(default="/workspace"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _require_running(current_user, db)
    content = await file.read()
    dest = path.rstrip("/") + "/" + (file.filename or "upload.bin")
    await svc.write_file(session, dest, content)
    return {"status": "uploaded", "path": dest, "size": len(content)}


@router.get("/files/download")
async def download_file(
    path: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _require_running(current_user, db)
    try:
        content = await svc.read_file(session, path)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    filename = os.path.basename(path) or "file"

    async def _stream():
        yield content

    return StreamingResponse(
        _stream(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/files")
async def delete_file(
    path: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _require_running(current_user, db)
    await svc.delete_path(session, path)
    return {"status": "deleted", "path": path}


@router.post("/files/mkdir")
async def make_directory(
    body: MkdirBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _require_running(current_user, db)
    await svc.create_directory(session, body.path)
    return {"status": "created", "path": body.path}


# ── WebSocket terminal ────────────────────────────────────────

@ws_router.websocket("/ws/mbmbook/terminal")
async def mbmbook_terminal(
    ws: WebSocket,
    token: str = Query(default=""),
):
    """
    Full PTY terminal inside the user's workspace container.

    Protocol (same as admin terminal.py):
      Client → Server:  raw bytes = keyboard input
                        JSON {"type":"resize","rows":N,"cols":N}
                        JSON {"type":"ping"}
      Server → Client:  raw bytes = terminal output (ANSI)
    """
    # Auth
    user = await _ws_auth(token)
    if not user:
        await ws.close(code=4001, reason="Unauthorized")
        return

    # Get session
    async with async_session() as db:
        session = await svc.get_session(db, user.id)
        if not session or session.status != "running":
            await ws.close(code=4002, reason="No running workspace")
            return
        container_name = session.container_name
        node_ip = session.node_ip

    await ws.accept()

    # Build docker exec command
    cmd = _build_exec_cmd(container_name, node_ip)

    if _USE_PTY:
        await _pty_terminal(ws, cmd)
    else:
        await _pipe_terminal(ws, cmd)


def _build_exec_cmd(container_name: str, node_ip: str) -> list[str]:
    """Build `docker exec -it container bash` command."""
    base = ["docker"]
    if node_ip and node_ip != "local":
        base = ["docker", "-H", f"tcp://{node_ip}:2375"]
    return base + ["exec", "-it", container_name, "/bin/bash", "--login"]


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    if not _USE_PTY:
        return
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except Exception:
        pass


async def _pty_terminal(ws: WebSocket, cmd: list[str]) -> None:
    master_fd, slave_fd = os.openpty()
    _set_winsize(master_fd, 24, 80)
    env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"}
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd, env=env
        )
    except Exception as exc:
        os.close(master_fd); os.close(slave_fd)
        await ws.send_bytes(f"\r\n\x1b[31mFailed: {exc}\x1b[0m\r\n".encode())
        await ws.close(); return

    os.close(slave_fd)
    loop = asyncio.get_event_loop()

    async def _reader():
        try:
            while True:
                data = await loop.run_in_executor(None, lambda: os.read(master_fd, 8192))
                if not data: break
                await ws.send_bytes(data)
        except Exception:
            pass

    reader = asyncio.create_task(_reader())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect": break
            raw = msg.get("bytes"); text = msg.get("text")
            if raw:
                try: os.write(master_fd, raw)
                except OSError: break
            elif text:
                try:
                    frame = json.loads(text)
                    if frame.get("type") == "resize":
                        _set_winsize(master_fd, int(frame.get("rows", 24)), int(frame.get("cols", 80)))
                    elif frame.get("type") == "ping":
                        await ws.send_text('{"type":"pong"}')
                except (json.JSONDecodeError, ValueError):
                    try: os.write(master_fd, text.encode())
                    except OSError: break
    except WebSocketDisconnect:
        pass
    finally:
        reader.cancel()
        try: proc.terminate()
        except Exception: pass
        try: os.close(master_fd)
        except OSError: pass
        try: await asyncio.wait_for(proc.wait(), timeout=3.0)
        except Exception:
            try: proc.kill()
            except Exception: pass


async def _pipe_terminal(ws: WebSocket, cmd: list[str]) -> None:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except Exception as exc:
        await ws.send_bytes(f"\r\nFailed: {exc}\r\n".encode())
        await ws.close(); return

    async def _reader():
        try:
            assert proc.stdout is not None
            while True:
                chunk = await proc.stdout.read(8192)
                if not chunk: break
                await ws.send_bytes(chunk)
        except Exception:
            pass

    reader = asyncio.create_task(_reader())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect": break
            raw = msg.get("bytes"); text = msg.get("text")
            assert proc.stdin is not None
            if raw:
                proc.stdin.write(raw); await proc.stdin.drain()
            elif text:
                try:
                    frame = json.loads(text)
                    if frame.get("type") == "ping":
                        await ws.send_text('{"type":"pong"}')
                except Exception:
                    proc.stdin.write(text.encode()); await proc.stdin.drain()
    except WebSocketDisconnect:
        pass
    finally:
        reader.cancel()
        try: proc.stdin.close(); proc.terminate()
        except Exception: pass
        try: await asyncio.wait_for(proc.wait(), timeout=3.0)
        except Exception:
            try: proc.kill()
            except Exception: pass


async def _ws_auth(token: str) -> "User | None":
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        if not payload:
            return None
        async with async_session() as db:
            user = await get_user_by_id(db, payload.get("sub", ""))
            return user if (user and user.is_active) else None
    except Exception:
        return None
