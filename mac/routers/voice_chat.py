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
import re
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
_PHONE_GARBAGE_RE = re.compile(r"^[\s\d()+\-/.]{10,}$")

# VAD silence threshold (ms) — allow "umms" and thinking pauses
VAD_SILENCE_MS = 800
# Max audio buffer size (bytes) before forced transcription
MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB

SYSTEM_PROMPT_EN = (
    "You are MAC — MBM AI Cloud — an AI assistant built entirely by the Computer Science and Engineering "
    "department at MBM University (formerly MBM Engineering College, Mugneeram Bangur Memorial), "
    "Jodhpur, Rajasthan, India. MBM University was established in 1951 and became a full university in 2021 — "
    "it is one of Rajasthan's premier engineering institutions. "
    "MAC runs fully offline on the university's own NVIDIA RTX 3060 GPU servers — no external cloud APIs. "
    "You assist MBM students, faculty, and staff with academics, research, coding, general knowledge, "
    "and university-related queries. "
    "Speak naturally and conversationally as if talking aloud. Keep answers concise — "
    "1-3 sentences for simple questions, up to a short paragraph for complex ones. "
    "Avoid bullet points or markdown. "
    "If asked who built you: say MAC was built by the CSE team at MBM University, Jodhpur. "
    "Never say you are Sarvam, ChatGPT, Claude, or any other AI system."
)
SYSTEM_PROMPT_HI = (
    "Aap MAC hain - MBM AI Cloud - jo MBM University (Mugneeram Bangur Memorial, pehle MBM Engineering "
    "College) ke Computer Science aur Engineering department ne banaya hai. "
    "MBM University Jodhpur, Rajasthan mein hai — 1951 mein sthaapit, aur 2021 mein university bani. "
    "MAC university ke apne NVIDIA RTX 3060 GPU servers par chalta hai — bilkul offline, koi cloud nahi. "
    "MBM ke students, faculty aur staff ki padhai, research, coding aur general queries mein madad karo. "
    "Naturally aur conversationally bolein jaise baat kar rahe hon. "
    "Simple sawaalon ka jawab 1-3 sentences mein dein. "
    "Bullet points ya formatting use na karein. "
    "Agar poochha jaaye kisne banaya: kahein MAC ko MBM University Jodhpur ki CSE team ne banaya. "
    "Kabhi mat kahein ki aap Sarvam, ChatGPT ya koi aur AI hain."
)

# Voice model — Sarvam-2B: bilingual Hindi/English, fast, fits 12 GB alongside Veena
_VOICE_MODEL = "sarvam:2b"


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


def _messages_to_prompt(messages: list[dict]) -> str:
    """Convert chat messages to a plain-text prompt for base LLMs."""
    lines = []
    for m in messages:
        role = m.get("role", "")
        content = m.get("content", "")
        if role == "system":
            lines.append(f"System: {content}")
        elif role == "user":
            lines.append(f"User: {content}")
        elif role == "assistant":
            lines.append(f"Assistant: {content}")
    lines.append("Assistant:")
    return "\n".join(lines)


async def _llm_stream(messages: list[dict], model: str):
    """Stream LLM response, yielding text chunks.
    Uses completions API with manual prompt (Sarvam-2B is a base model with no chat template).
    """
    import httpx
    from mac.config import settings

    prompt = _messages_to_prompt(messages)
    resolved = "sarvamai/sarvam-2b-v0.5"
    base_url = settings.vllm_speed_url

    payload = {
        "model": resolved,
        "prompt": prompt,
        "temperature": 0.35,
        "max_tokens": 120,
        "stream": True,
        "stop": ["User:", "\nUser:", "\n\nUser:", "Phone:", "Contact:"],
        "repetition_penalty": 1.15,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            async with client.stream(
                "POST", f"{base_url}/v1/completions", json=payload
            ) as resp:
                if resp.status_code != 200:
                    return
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    text = line[6:].strip()
                    if not text or text == "[DONE]":
                        continue
                    try:
                        data = json.loads(text)
                        content = data.get("choices", [{}])[0].get("text", "")
                        if _PHONE_GARBAGE_RE.fullmatch(content.strip()):
                            continue
                        if content:
                            yield content
                    except Exception:
                        pass
        except Exception:
            pass


async def _tts(text: str, language: str = "en") -> bytes | None:
    """Convert text to speech via Veena TTS. Returns WAV bytes or None."""
    # kavya: female, Hindi+English (default)  |  agastya: male, Hindi+English
    voice = "kavya" if language in ("hi", "hin") else "kavya"
    try:
        return await llm_service.text_to_speech(
            text=text,
            voice=voice,
            speed=1.0,
            response_format="wav",
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
        if not await is_enabled(db, "voice_input", user.role):
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
        if processing:
            return
        if not audio_buffer:
            await websocket.send_json({
                "type": "info",
                "state": "listening",
                "message": "I did not catch any speech. Please speak again.",
            })
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
                await websocket.send_json({
                    "type": "info",
                    "state": "listening",
                    "message": "I could not hear that clearly. Please try again.",
                })
                await websocket.send_json({"type": "done"})
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
            model = _VOICE_MODEL

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
                                "mime": "audio/wav",
                            })

            # TTS for any remaining text
            if sentence_buf.strip():
                audio = await _tts(sentence_buf.strip(), lang)
                if audio:
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "data": base64.b64encode(audio).decode(),
                        "mime": "audio/wav",
                    })

            if not full_response.strip():
                full_response = "I heard you, but I could not generate a clear response. Please try again."
                await websocket.send_json({"type": "llm_chunk", "text": full_response})
                audio = await _tts(full_response, lang)
                if audio:
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "data": base64.b64encode(audio).decode(),
                        "mime": "audio/wav",
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
