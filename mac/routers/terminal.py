"""Admin WebSocket terminal — full PTY bash access to the container.

Protocol (text frames are JSON, binary frames are raw terminal I/O):
  Client → Server:
    raw bytes  — keyboard input forwarded directly to PTY
    {"type":"resize","cols":N,"rows":N} — terminal resize
    {"type":"ping"} — keepalive
  Server → Client:
    raw bytes  — PTY output (ANSI colours, cursor moves, etc.)
"""

import asyncio
import json
import os
import struct
import sys

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db, async_session
from mac.utils.security import decode_access_token

router = APIRouter(tags=["Admin Terminal"])

_USE_PTY = sys.platform != "win32"
if _USE_PTY:
    import fcntl
    import termios


# ── Auth helper ──────────────────────────────────────────

async def _require_admin_ws(token: str) -> bool:
    """Return True only if token is valid and user is admin."""
    if not token:
        return False
    try:
        payload = decode_access_token(token)
        if not payload:
            return False
        from mac.services.auth_service import get_user_by_id
        async with async_session() as db:
            user = await get_user_by_id(db, payload.get("sub", ""))
            return user is not None and user.is_active and user.role == "admin"
    except Exception:
        return False


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    """TIOCSWINSZ — update PTY window size."""
    if not _USE_PTY:
        return
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except Exception:
        pass


# ── WebSocket endpoint ───────────────────────────────────

@router.websocket("/api/v1/admin/terminal/ws")
async def terminal_ws(
    ws: WebSocket,
    token: str = Query(default=""),
    shell: str = Query(default=""),
):
    """
    Admin-only PTY terminal.

    Query params:
      token  — JWT access token (required, admin only)
      shell  — "" for this container's bash;
               "docker:<name>" to exec into another container
    """
    if not await _require_admin_ws(token):
        await ws.close(code=4001, reason="Unauthorized")
        return

    await ws.accept()

    # ── Determine command ────────────────────────────────
    docker_exec = shell.startswith("docker:")
    if docker_exec:
        container = shell[7:].strip()
        cmd = ["docker", "exec", "-it", container, "/bin/sh"]
        use_pty = False  # docker exec -it handles its own PTY
    else:
        cmd = ["/bin/bash", "--login"]
        use_pty = _USE_PTY

    # ── PTY branch (Linux/Mac — inside Docker) ───────────
    if use_pty:
        master_fd, slave_fd = os.openpty()
        _set_winsize(master_fd, 24, 80)

        proc_env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"}
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                env=proc_env,
            )
        except Exception as exc:
            os.close(master_fd)
            os.close(slave_fd)
            err = f"\r\n\x1b[31mFailed to start shell: {exc}\x1b[0m\r\n"
            await ws.send_bytes(err.encode())
            await ws.close()
            return

        os.close(slave_fd)
        loop = asyncio.get_event_loop()

        async def _pty_reader():
            try:
                while True:
                    data = await loop.run_in_executor(
                        None, lambda: os.read(master_fd, 8192)
                    )
                    if not data:
                        break
                    await ws.send_bytes(data)
            except (OSError, Exception):
                pass

        reader = asyncio.create_task(_pty_reader())
        try:
            while True:
                msg = await ws.receive()
                mtype = msg.get("type")
                if mtype == "websocket.disconnect":
                    break
                raw = msg.get("bytes")
                text = msg.get("text")
                if raw:
                    try:
                        os.write(master_fd, raw)
                    except OSError:
                        break
                elif text:
                    try:
                        frame = json.loads(text)
                        if frame.get("type") == "resize":
                            rows = max(1, int(frame.get("rows", 24)))
                            cols = max(1, int(frame.get("cols", 80)))
                            _set_winsize(master_fd, rows, cols)
                        elif frame.get("type") == "ping":
                            await ws.send_text('{"type":"pong"}')
                    except (json.JSONDecodeError, ValueError):
                        try:
                            os.write(master_fd, text.encode())
                        except OSError:
                            break
        except WebSocketDisconnect:
            pass
        finally:
            reader.cancel()
            try:
                proc.terminate()
            except Exception:
                pass
            try:
                os.close(master_fd)
            except OSError:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=3.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

    # ── Pipe branch (Windows or docker exec) ─────────────
    else:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except Exception as exc:
            await ws.send_bytes(f"\r\nFailed to start: {exc}\r\n".encode())
            await ws.close()
            return

        async def _pipe_reader():
            try:
                assert proc.stdout is not None
                while True:
                    chunk = await proc.stdout.read(8192)
                    if not chunk:
                        break
                    await ws.send_bytes(chunk)
            except Exception:
                pass

        reader = asyncio.create_task(_pipe_reader())
        try:
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                raw = msg.get("bytes")
                text = msg.get("text")
                assert proc.stdin is not None
                if raw:
                    proc.stdin.write(raw)
                    await proc.stdin.drain()
                elif text:
                    try:
                        frame = json.loads(text)
                        if frame.get("type") == "ping":
                            await ws.send_text('{"type":"pong"}')
                    except Exception:
                        proc.stdin.write(text.encode())
                        await proc.stdin.drain()
        except WebSocketDisconnect:
            pass
        finally:
            reader.cancel()
            try:
                proc.stdin.close()
                proc.terminate()
            except Exception:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=3.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
