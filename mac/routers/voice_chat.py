"""Voice-to-voice chat — WebSocket pipeline.

Pipeline: Browser mic → Whisper STT → vLLM → TTS → Browser speaker

Client sends JSON control frames or raw audio bytes.
Control frames: {"type": "start"} | {"type": "stop"} | {"type": "ping"}
Audio frames: raw WebM/Opus bytes from MediaRecorder.

Server sends JSON frames:
  {"type": "transcript", "text": "..."}       — Whisper result
  {"type": "llm_chunk", "text": "..."}        — streaming LLM token
  {"type": "audio_chunk", "data": "<base64>"} — TTS audio bytes
  {"type": "done"}                             — turn complete
  {"type": "error", "message": "..."}         — error
  {"type": "pong"}                             — keepalive
"""

import asyncio
import base64
import io
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user
from mac.middleware.feature_gate import feature_required
from mac.models.user import User
from mac.services import llm_service, activity_service
from mac.utils.security import decode_access_token

router = APIRouter(prefix="/voice", tags=["Voice Chat"])

# VAD silence threshold (ms) — allow "umms" and thinking pauses
VAD_SILENCE_MS = 800
# Max audio buffer size (bytes) before forced transcription
MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB

SYSTEM_PROMPT_EN = (
    "You are MAC, the MBM AI Cloud assistant. Respond naturally and conversationally "
    "as if speaking aloud. Keep responses concise — 1-3 sentences for simple questions, "
    "up to a short paragraph for complex ones. Avoid bullet points or markdown formatting."
)
SYSTEM_PROMPT_HI = (
    "Aap MAC hain, MBM AI Cloud ke assistant. Naturally aur conversationally reply karein "
    "jaise bol rahe hon. Responses short rakhein — simple sawaalon ke liye 1-3 sentences. "
    "Bullet points ya formatting use na karein."
)


async def _auth_ws(token: str | None, db: AsyncSession) -> User | None:
    """Authenticate a WebSocket connection via JWT token query param."""
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        if not payload:
            return None
        from mac.services.auth_service import get_user_by_id
        user = await get_user_by_id(db, payload.get("sub", ""))
        if user and user.is_active:
            return user
    except Exception:
        pass
    return None


async def _transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> dict:
    """Send audio to Whisper and return {text, language}."""
    try:
        result = await llm_service.speech_to_text(
            audio_bytes=audio_bytes,
            filename=filename,
            model="default",
            language="",  # auto-detect
        )
        return {"text": result.get("text", ""), "language": result.get("language", "en")}
    except Exception as e:
        return {"text": "", "language": "en", "error": str(e)}


async def _llm_stream(messages: list[dict], model: str):
    """Stream LLM response, yielding text chunks."""
    async for chunk in llm_service.chat_completion_stream(
        model=model,
        messages=messages,
        temperature=0.7,
        max_tokens=300,
    ):
        if chunk.startswith("data: ") and "[DONE]" not in chunk:
            try:
                data = json.loads(chunk[6:].strip())
                content = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                if content:
                    yield content
            except Exception:
                pass


async def _tts(text: str, language: str = "en") -> bytes | None:
    """Convert text to speech. Returns audio bytes or None if TTS unavailable."""
    voice = "hi_IN" if language in ("hi", "hin") else "en_IN"
    try:
        return await llm_service.text_to_speech(
            text=text,
            voice=voice,
            speed=1.0,
            response_format="mp3",
        )
    except Exception:
        return None


@router.websocket("/stream")
async def voice_stream(
    websocket: WebSocket,
    token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket voice-to-voice pipeline.
    Authenticate via ?token=<JWT> query param.
    """
    await websocket.accept()

    # Auth
    user = await _auth_ws(token, db)
    if not user:
        await websocket.send_json({"type": "error", "message": "Unauthorized"})
        await websocket.close(code=4001)
        return

    # Feature gate (admin always passes)
    if user.role != "admin":
        from mac.services.feature_flag_service import is_enabled
        if not await is_enabled(db, "model_voice", user.role):
            await websocket.send_json({"type": "error", "message": "Voice chat is disabled by admin"})
            await websocket.close(code=4003)
            return

    conversation: list[dict] = []
    audio_buffer = bytearray()
    last_audio_ts = time.time()
    vad_task: asyncio.Task | None = None
    processing = False

    async def _process_audio():
        nonlocal audio_buffer, processing
        if not audio_buffer or processing:
            return
        processing = True
        buf_copy = bytes(audio_buffer)
        audio_buffer.clear()

        try:
            # 1. Transcribe
            stt = await _transcribe(buf_copy)
            text = stt.get("text", "").strip()
            lang = stt.get("language", "en")

            if not text:
                processing = False
                return

            await websocket.send_json({"type": "transcript", "text": text})

            # 2. Build messages
            sys_prompt = SYSTEM_PROMPT_HI if lang in ("hi", "hin") else SYSTEM_PROMPT_EN
            if not conversation:
                conversation.append({"role": "system", "content": sys_prompt})
            conversation.append({"role": "user", "content": text})

            # 3. Stream LLM response, accumulate sentences for TTS
            full_response = ""
            sentence_buf = ""
            model = "qwen2.5:7b"

            async for chunk in _llm_stream(conversation, model):
                full_response += chunk
                sentence_buf += chunk
                await websocket.send_json({"type": "llm_chunk", "text": chunk})

                # Send to TTS when we have a complete sentence
                if any(sentence_buf.endswith(p) for p in (".", "!", "?", "।", "\n")):
                    sentence = sentence_buf.strip()
                    sentence_buf = ""
                    if sentence:
                        audio = await _tts(sentence, lang)
                        if audio:
                            await websocket.send_json({
                                "type": "audio_chunk",
                                "data": base64.b64encode(audio).decode(),
                                "mime": "audio/mpeg",
                            })

            # TTS for any remaining text
            if sentence_buf.strip():
                audio = await _tts(sentence_buf.strip(), lang)
                if audio:
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "data": base64.b64encode(audio).decode(),
                        "mime": "audio/mpeg",
                    })

            if full_response:
                conversation.append({"role": "assistant", "content": full_response})

            await websocket.send_json({"type": "done"})

            await activity_service.log(
                "voice",
                f"{user.name} ({user.role.title()}) used voice chat — lang:{lang}",
            )

        except Exception as e:
            await websocket.send_json({"type": "error", "message": str(e)})
        finally:
            processing = False

    async def _vad_silence_watcher():
        """Watch for VAD_SILENCE_MS of silence then trigger processing."""
        nonlocal last_audio_ts
        while True:
            await asyncio.sleep(0.1)
            if audio_buffer and not processing:
                elapsed_ms = (time.time() - last_audio_ts) * 1000
                if elapsed_ms >= VAD_SILENCE_MS:
                    await _process_audio()

    vad_task = asyncio.create_task(_vad_silence_watcher())

    try:
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive(), timeout=60.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "pong"})
                continue

            if msg["type"] == "websocket.disconnect":
                break

            # JSON control frame
            if msg.get("text"):
                try:
                    frame = json.loads(msg["text"])
                    if frame.get("type") == "stop":
                        await _process_audio()
                    elif frame.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif frame.get("type") == "clear":
                        conversation.clear()
                        audio_buffer.clear()
                except Exception:
                    pass

            # Raw audio bytes from MediaRecorder
            elif msg.get("bytes"):
                chunk = msg["bytes"]
                if len(audio_buffer) + len(chunk) < MAX_AUDIO_BYTES:
                    audio_buffer.extend(chunk)
                    last_audio_ts = time.time()

    except WebSocketDisconnect:
        pass
    finally:
        if vad_task:
            vad_task.cancel()
