"""WebSocket endpoint for real-time notebook code execution.

Protocol:
  Client → Server:
    {"type": "execute", "cell_id": "...", "code": "...", "language": "python"}
    {"type": "interrupt", "kernel_id": "..."}
    {"type": "ping"}

  Server → Client:
    {"type": "status", "cell_id": "...", "execution_state": "busy|idle"}
    {"type": "stream", "cell_id": "...", "name": "stdout|stderr", "text": "..."}
    {"type": "error", "cell_id": "...", "ename": "...", "evalue": "...", "traceback": [...]}
    {"type": "pong"}
"""

import json
import uuid
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from mac.services.kernel_manager import kernel_manager
from mac.utils.security import decode_access_token

logger = logging.getLogger(__name__)

router = APIRouter()

# Active WebSocket connections: {notebook_id: [websocket, ...]}
_connections: dict[str, list[WebSocket]] = {}


@router.websocket("/ws/notebook/{notebook_id}")
async def notebook_ws(websocket: WebSocket, notebook_id: str, token: str = Query(default=None)):
    """WebSocket for real-time notebook code execution and streaming output.
    Auth: pass JWT as ?token= query param."""
    # Validate JWT token
    if not token:
        await websocket.close(code=4001, reason="Missing auth token")
        return
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await websocket.accept()
    logger.info("WS connected: notebook=%s client=%s", notebook_id, websocket.client)

    if notebook_id not in _connections:
        _connections[notebook_id] = []
    _connections[notebook_id].append(websocket)

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "execute":
                await _handle_execute(websocket, notebook_id, msg)
            elif msg_type == "interrupt":
                await _handle_interrupt(websocket, msg)
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                await websocket.send_json({"type": "error", "message": f"Unknown type: {msg_type}"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WS error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        conns = _connections.get(notebook_id, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns and notebook_id in _connections:
            del _connections[notebook_id]


async def _handle_execute(ws: WebSocket, notebook_id: str, msg: dict):
    """Execute code and stream results back via WebSocket."""
    cell_id = msg.get("cell_id", str(uuid.uuid4()))
    code = msg.get("code", "")
    language = msg.get("language", "python")
    kernel_id = msg.get("kernel_id")

    # Notify: execution starting
    await ws.send_json({
        "type": "status",
        "cell_id": cell_id,
        "execution_state": "busy",
    })

    try:
        async for output in kernel_manager.execute_code(
            kernel_id=kernel_id,
            code=code,
            language=language,
        ):
            output["cell_id"] = cell_id
            await ws.send_json(output)

            # Broadcast to other viewers of this notebook
            for conn in _connections.get(notebook_id, []):
                if conn != ws:
                    try:
                        await conn.send_json(output)
                    except Exception:
                        pass

    except Exception as e:
        await ws.send_json({
            "type": "error",
            "cell_id": cell_id,
            "ename": type(e).__name__,
            "evalue": str(e),
            "traceback": [],
        })

    # Notify: execution complete
    await ws.send_json({
        "type": "status",
        "cell_id": cell_id,
        "execution_state": "idle",
    })


async def _handle_interrupt(ws: WebSocket, msg: dict):
    kernel_id = msg.get("kernel_id")
    if kernel_id:
        await kernel_manager.interrupt_kernel(kernel_id)
        await ws.send_json({"type": "kernel_status", "kernel_id": kernel_id, "status": "interrupted"})
