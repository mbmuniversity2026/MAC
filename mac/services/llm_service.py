"""LLM service — proxy requests to local vLLM GPU inference backends + cluster routing."""

import json
import re
import time
import httpx
from typing import AsyncIterator, Optional
from mac.config import settings
from mac.utils.security import generate_request_id

# ═══════════════════════════════════════════════════════════
#  MAC SYSTEM PROMPT — Identity & Guardrails
# ═══════════════════════════════════════════════════════════

_MAC_SYSTEM_PROMPT = (
    "You are MAC (MBM AI Cloud), an AI assistant built entirely by the Computer Science and Engineering "
    "department at MBM University (Jai Narain Vyas University), Jodhpur, Rajasthan, India. "
    "MBM University — formerly MBM Engineering College (Mugneeram Bangur Memorial) — was established "
    "in 1951 and became a full university in 2021. It is one of Rajasthan's premier engineering institutions. "
    "MAC runs fully offline on the university's own NVIDIA RTX 3060 GPU servers — no cloud APIs, no external services. "
    "When asked who you are, say: I am MAC, built by the CSE team at MBM University, Jodhpur. "
    "Never say you are Qwen, ChatGPT, Claude, Sarvam, or any other AI. "
    "Never mention Alibaba, OpenAI, Anthropic, or Sarvam AI as your creator. "
    "You assist MBM students, faculty, and staff with academics, coding, research, and general knowledge. "
    "Be helpful, accurate, concise, respectful, and professional. "
    "Do not generate harmful, hateful, or explicit content. "
    "If asked about hardware: you run on an NVIDIA RTX 3060 12GB GPU at MBM University, Jodhpur."
)

# Base language models (no chat template) — use /v1/completions instead of /v1/chat/completions
_COMPLETIONS_ONLY_MODELS: set[str] = {"sarvamai/sarvam-2b-v0.5"}
_PHONE_GARBAGE_RE = re.compile(r"^[\s\d()+\-/.]{10,}$")


def _inject_system_prompt(messages: list[dict]) -> list[dict]:
    """Prepend the MAC identity system prompt if no system message exists."""
    identity_fix = (
        "\nCorrection: MBM means Mugneeram Bangur Memorial. Do not describe MBM University as "
        "Jai Narain Vyas University. Do not invent phone numbers, IDs, or random numeric strings."
    )
    if messages and messages[0].get("role") == "system":
        # Merge with existing system prompt
        messages = list(messages)
        messages[0] = {**messages[0], "content": _MAC_SYSTEM_PROMPT + identity_fix + "\n\n" + messages[0]["content"]}
        return messages
    return [{"role": "system", "content": _MAC_SYSTEM_PROMPT + identity_fix}] + list(messages)


# ═══════════════════════════════════════════════════════════
#  MODEL REGISTRY
#  Priority: MAC_MODELS_JSON env → built-in defaults
#  Then filtered by MAC_ENABLED_MODELS if set.
# ═══════════════════════════════════════════════════════════

_BUILTIN_MODELS: dict[str, dict] = {
    # ── Chat / LLM models ────────────────────────────────

    # Sarvam-2B — bilingual Hindi/English base model (no chat template)
    # Uses /v1/completions fallback. Best for short answers and voice.
    "sarvam:2b": {
        "name": "Sarvam 2B",
        "model_type": "chat",
        "specialty": "Bilingual Hindi+English — optimised for voice and quick answers",
        "parameters": "2.5B",
        "context_length": 4096,
        "capabilities": ["chat", "completion"],
        "category": "speed",
        "served_name": "sarvamai/sarvam-2b-v0.5",
        "url_key": "vllm_speed_url",
    },

    "qwen2.5:7b": {
        "name": "Qwen2.5 7B",
        "model_type": "chat",
        "specialty": "Fast general chat, summarisation, Q&A",
        "parameters": "7B",
        "context_length": 32768,
        "capabilities": ["chat", "completion"],
        "category": "speed",
        "served_name": "Qwen/Qwen2.5-7B-Instruct-AWQ",
        "url_key": "vllm_speed_url",
    },
    "qwen2.5-coder:7b": {
        "name": "Qwen2.5-Coder 7B",
        "model_type": "chat",
        "specialty": "Code generation, debugging, explanation",
        "parameters": "7B",
        "context_length": 32768,
        "capabilities": ["code", "chat", "completion"],
        "category": "code",
        "served_name": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "url_key": "vllm_code_url",
    },
    "qwen2.5-coder:7b-awq": {
        "name": "Qwen2.5-Coder 7B AWQ",
        "model_type": "chat",
        "specialty": "Code generation, debugging, explanation (quantized, fits 12GB GPU)",
        "parameters": "7B",
        "context_length": 32768,
        "capabilities": ["code", "chat", "completion"],
        "category": "code",
        "served_name": "Qwen/Qwen2.5-Coder-7B-Instruct-AWQ",
        "url_key": "vllm_code_url",
    },
    "deepseek-r1:14b": {
        "name": "DeepSeek-R1 14B",
        "model_type": "chat",
        "specialty": "Maths, reasoning, step-by-step logic, deep thinking",
        "parameters": "14B",
        "context_length": 65536,
        "capabilities": ["reasoning", "math", "chat"],
        "category": "reasoning",
        "served_name": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
        "url_key": "vllm_reasoning_url",
    },
    "deepseek-r1:7b": {
        "name": "DeepSeek-R1 7B",
        "model_type": "chat",
        "specialty": "Maths, reasoning, step-by-step logic (lighter, fits 12GB)",
        "parameters": "7B",
        "context_length": 32768,
        "capabilities": ["reasoning", "math", "chat"],
        "category": "reasoning",
        "served_name": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        "url_key": "vllm_reasoning_url",
    },
    "gemma3:27b": {
        "name": "Gemma 3 27B",
        "model_type": "chat",
        "specialty": "Highest intelligence — complex analysis, creative writing, research",
        "parameters": "27B",
        "context_length": 8192,
        "capabilities": ["chat", "completion", "reasoning"],
        "category": "intel",
        "served_name": "google/gemma-3-27b-it",
        "url_key": "vllm_intelligence_url",
    },

    # ── Speech-to-Text (Whisper) ─────────────────────────
    "whisper-small": {
        "name": "Faster-Whisper Small",
        "model_type": "stt",
        "specialty": "Fast speech-to-text, good for short clips, low VRAM (~1 GB)",
        "parameters": "244M",
        "context_length": 0,
        "capabilities": ["speech"],
        "category": "stt",
        "served_name": "Systran/faster-whisper-small",
        "url_key": "whisper_url",
    },
    "whisper-medium": {
        "name": "Faster-Whisper Medium",
        "model_type": "stt",
        "specialty": "Balanced accuracy, multi-language transcription (~2 GB VRAM)",
        "parameters": "769M",
        "context_length": 0,
        "capabilities": ["speech"],
        "category": "stt",
        "served_name": "Systran/faster-whisper-medium",
        "url_key": "whisper_url",
    },
    "whisper-large-v3-turbo": {
        "name": "Faster-Whisper Large V3 Turbo",
        "model_type": "stt",
        "specialty": "Best accuracy, handles accents & noisy audio (~4 GB VRAM)",
        "parameters": "809M",
        "context_length": 0,
        "capabilities": ["speech"],
        "category": "stt",
        "served_name": "Systran/faster-whisper-large-v3-turbo",
        "url_key": "whisper_url",
    },

    # ── Text-to-Speech ───────────────────────────────────
    "veena-tts": {
        "name": "Veena TTS",
        "model_type": "tts",
        "specialty": "Indian-accent neural TTS — Hindi, English, Hinglish (kavya/agastya/maitri/vinaya voices)",
        "parameters": "3B (4-bit)",
        "context_length": 0,
        "capabilities": ["tts"],
        "category": "tts",
        "served_name": "veena",
        "url_key": "tts_url",
    },
    "tts-piper": {
        "name": "Piper TTS",
        "model_type": "tts",
        "specialty": "Lightweight offline TTS, CPU-friendly (~50 MB RAM)",
        "parameters": "~20M",
        "context_length": 0,
        "capabilities": ["tts"],
        "category": "tts",
        "served_name": "piper",
        "url_key": "tts_url",
    },
    "tts-coqui": {
        "name": "Coqui XTTS-v2",
        "model_type": "tts",
        "specialty": "High-quality voice cloning & multi-language TTS (~2 GB)",
        "parameters": "~500M",
        "context_length": 0,
        "capabilities": ["tts"],
        "category": "tts",
        "served_name": "tts_models/multilingual/multi-dataset/xtts_v2",
        "url_key": "tts_url",
    },

    # ── Embedding models ─────────────────────────────────
    "nomic-embed-text": {
        "name": "Nomic Embed Text",
        "model_type": "embedding",
        "specialty": "General-purpose text embeddings for RAG & search (~550 MB)",
        "parameters": "137M",
        "context_length": 8192,
        "capabilities": ["embedding"],
        "category": "embedding",
        "served_name": "nomic-embed-text",
        "url_key": "embedding_url",
    },
    "bge-small-en-v1.5": {
        "name": "BGE Small EN",
        "model_type": "embedding",
        "specialty": "Tiny, fast English embeddings — perfect for low-RAM setups (~130 MB)",
        "parameters": "33M",
        "context_length": 512,
        "capabilities": ["embedding"],
        "category": "embedding",
        "served_name": "BAAI/bge-small-en-v1.5",
        "url_key": "embedding_url",
    },

    # ── Vision models ────────────────────────────────────
    "moondream2": {
        "name": "Moondream 2",
        "model_type": "vision",
        "specialty": "Tiny vision-language model, image captioning & Q&A (~2 GB)",
        "parameters": "1.9B",
        "context_length": 2048,
        "capabilities": ["vision", "chat"],
        "category": "vision",
        "served_name": "vikhyatk/moondream2",
        "url_key": "vllm_speed_url",
    },
}


def _load_models() -> dict[str, dict]:
    """Load model registry: MAC_MODELS_JSON env > built-in defaults, filtered by MAC_ENABLED_MODELS."""
    if settings.mac_models_json.strip():
        try:
            models_list = json.loads(settings.mac_models_json)
            registry: dict[str, dict] = {}
            for m in models_list:
                mid = m.pop("id")
                m.setdefault("model_type", "chat")
                registry[mid] = m
            return registry
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
    registry = dict(_BUILTIN_MODELS)
    enabled = settings.mac_enabled_models.strip()
    if enabled:
        enabled_set = {e.strip() for e in enabled.split(",") if e.strip()}
        registry = {k: v for k, v in registry.items() if k in enabled_set}
    return registry


DEFAULT_MODELS = _load_models()


def _get_auto_model() -> str:
    """Determine the auto-routing fallback model from config or first code/speed model."""
    fb = settings.mac_auto_fallback.strip()
    if fb:
        return fb
    for cat in ("code", "speed"):
        for mid, info in DEFAULT_MODELS.items():
            if info.get("category") == cat:
                return mid
    return next(iter(DEFAULT_MODELS), "qwen2.5:7b")


AUTO_MODEL = _get_auto_model()


def _find_by_category(category: str) -> str:
    """Return the first model ID matching *category*, or AUTO_MODEL as fallback."""
    for mid, info in DEFAULT_MODELS.items():
        if info.get("category") == category:
            return mid
    return AUTO_MODEL


# Smart routing keywords
_CODE_KEYWORDS = {"code", "function", "bug", "error", "debug", "python", "javascript",
                  "typescript", "java", "rust", "golang", "c++", "compile", "syntax",
                  "refactor", "class", "api", "algorithm", "programming", "script",
                  "html", "css", "sql", "git", "docker", "def ", "import ", "print("}
_MATH_KEYWORDS = {"math", "equation", "calculate", "prove", "integral", "derivative",
                  "theorem", "matrix", "algebra", "calculus", "probability",
                  "statistics", "geometry", "trigonometry", "factorial", "logarithm",
                  "solve", "sum of", "product of", "limit", "series"}
_INTEL_KEYWORDS = {"explain", "analyze", "analyse", "research", "essay", "write",
                   "creative", "story", "compare", "evaluate", "summarize", "summarise",
                   "thesis", "report", "critical", "philosophy", "history", "science",
                   "detailed", "comprehensive", "in-depth"}


def _smart_route(messages: list[dict] | None = None) -> str:
    """Pick the best model based on message content."""
    if not messages:
        return AUTO_MODEL
    text = " ".join(m.get("content", "") for m in messages).lower()
    code_score = sum(1 for k in _CODE_KEYWORDS if k in text)
    math_score = sum(1 for k in _MATH_KEYWORDS if k in text)
    intel_score = sum(1 for k in _INTEL_KEYWORDS if k in text)

    if math_score > code_score and math_score >= 2:
        return _find_by_category("reasoning")
    if code_score >= 1:
        return _find_by_category("code")
    if intel_score >= 2:
        return _find_by_category("intel")
    return _find_by_category("speed")


def _resolve_model(model_id: str, messages: list[dict] | None = None) -> tuple[str, str]:
    """Resolve model ID → (served_name, base_url).
    Uses local vLLM config. For cluster-aware routing, use _resolve_model_cluster."""
    if model_id == "auto":
        model_id = _smart_route(messages)
    if model_id in DEFAULT_MODELS:
        m = DEFAULT_MODELS[model_id]
        url = getattr(settings, m.get("url_key", "vllm_speed_url"), settings.vllm_base_url)
        return m["served_name"], url
    # Fallback: unknown model → send to default vLLM endpoint
    return model_id, settings.vllm_base_url


async def _resolve_model_cluster(
    model_id: str, messages: list[dict] | None = None
) -> tuple[str, str]:
    """Cluster-aware model resolution. Tries worker nodes first, then local vLLM.
    Also resolves live community models via model_submissions.
    Returns (served_name, base_url)."""
    if model_id == "auto":
        model_id = _smart_route(messages)

    served_name = model_id
    local_url = settings.vllm_base_url

    if model_id in DEFAULT_MODELS:
        m = DEFAULT_MODELS[model_id]
        served_name = m["served_name"]
        local_url = getattr(settings, m.get("url_key", "vllm_speed_url"), settings.vllm_base_url)

    # Try cluster routing via load balancer (score-based, stale-aware)
    try:
        from mac.database import async_session as async_session_factory
        from mac.services.load_balancer import get_best_worker

        async with async_session_factory() as db:
            worker = await get_best_worker(db, model_id)
            if not worker:
                # Try served_name (community models register with HF path as model_id)
                worker = await get_best_worker(db, served_name)
            if worker:
                try:
                    async with httpx.AsyncClient(timeout=3) as client:
                        resp = await client.get(f"{worker['url']}/health")
                        if resp.status_code == 200:
                            return served_name, worker["url"]
                except httpx.RequestError:
                    pass
    except Exception:
        pass  # DB unavailable, use local config

    return served_name, local_url


def _api_url(base: str, path: str) -> str:
    """Build full URL for a vLLM endpoint."""
    return f"{base.rstrip('/')}{path}"


def _auth_headers() -> dict:
    """Return auth headers if an API key is configured."""
    if settings.vllm_api_key:
        return {"Authorization": f"Bearer {settings.vllm_api_key}"}
    return {}


async def chat_completion(
    model: str,
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 2048,
    top_p: float = 1.0,
    frequency_penalty: float = 0.0,
    presence_penalty: float = 0.0,
    stop: list[str] | str | None = None,
) -> dict:
    """Chat completion via local vLLM (OpenAI-compatible API)."""
    resolved, base_url = await _resolve_model_cluster(model, messages)
    messages = _inject_system_prompt(messages)
    request_id = generate_request_id("mac-chat")
    start = time.time()

    payload: dict = {
        "model": resolved,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "frequency_penalty": frequency_penalty,
        "presence_penalty": presence_penalty,
        "stream": False,
    }
    if stop:
        payload["stop"] = stop if isinstance(stop, list) else [stop]

    async with httpx.AsyncClient(timeout=settings.vllm_timeout) as client:
        resp = await client.post(_api_url(base_url, "/v1/chat/completions"), json=payload, headers=_auth_headers())
        resp.raise_for_status()
        data = resp.json()

    latency_ms = int((time.time() - start) * 1000)
    usage = data.get("usage", {})
    choice = data["choices"][0]
    msg = choice["message"]
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content")
    if not content and reasoning:
        content = reasoning

    return {
        "id": data.get("id", request_id),
        "object": "chat.completion",
        "created": data.get("created", int(time.time())),
        "model": resolved,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content, **({
                    "reasoning_content": reasoning} if reasoning else {})},
                "finish_reason": choice.get("finish_reason", "stop"),
            }
        ],
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
        "context_id": None,
        "_latency_ms": latency_ms,
    }


async def _completions_to_chat_stream(
    messages: list[dict],
    resolved: str,
    base_url: str,
    temperature: float,
    max_tokens: int,
) -> AsyncIterator[str]:
    """Wrap /v1/completions SSE as chat completion SSE for base LMs (no chat template)."""
    # Build conversation history and extract last user message
    history_pairs = []
    turns: list[dict] = []
    for m in messages:
        role = m.get("role", "")
        content = m.get("content", "").strip()
        if role in ("user", "assistant"):
            turns.append({"role": role, "content": content})

    # Group into Q/A pairs
    i = 0
    while i < len(turns):
        if turns[i]["role"] == "user" and i + 1 < len(turns) and turns[i + 1]["role"] == "assistant":
            history_pairs.append((turns[i]["content"], turns[i + 1]["content"]))
            i += 2
        else:
            i += 1

    last_user = next((t["content"] for t in reversed(turns) if t["role"] == "user"), "Hello")

    # Primed continuation prompt — base models respond well when given the answer start
    # Detect identity/name questions and prime with the correct identity
    lu_lower = last_user.lower()
    is_identity = any(w in lu_lower for w in ("who are you", "what are you", "aap kaun", "kaun ho", "introduce", "your name", "tumhara naam"))

    history_text = ""
    for q, a in history_pairs[-3:]:  # last 3 turns for context
        history_text += f"Q: {q}\nMAC: {a}\n\n"

    if is_identity:
        primer = "I am MAC (MBM AI Cloud), an AI assistant built by the CSE department at MBM University (Mugneeram Bangur Memorial University), Jodhpur."
    else:
        primer = ""

    prompt = (
        "MAC is the AI assistant of MBM University (Mugneeram Bangur Memorial University), Jodhpur, "
        "built by the CSE department. MAC gives short, accurate, helpful answers. "
        "Do not invent phone numbers, IDs, contact numbers, or numeric strings.\n\n"
        f"{history_text}"
        f"Q: {last_user}\n"
        f"MAC: {primer}"
    )

    payload = {
        "model": resolved,
        "prompt": prompt,
        "temperature": 0.35,
        "max_tokens": min(max_tokens, 120),
        "stream": True,
        "stop": ["\nQ:", "\n\nQ:", "Q:", "\n\n\n", "User:", "\nUser:", "\n\nMAC:", "Phone:", "Contact:"],
        "repetition_penalty": 1.15,
    }
    request_id = generate_request_id("mac-chat")
    done_sent = False
    async with httpx.AsyncClient(timeout=settings.vllm_timeout) as client:
        try:
            async with client.stream(
                "POST", _api_url(base_url, "/v1/completions"), json=payload, headers=_auth_headers()
            ) as resp:
                if resp.status_code != 200:
                    yield "data: [DONE]\n\n"
                    return
                # Send primer first so client sees the full response
                if primer:
                    sse = {"id": request_id, "object": "chat.completion.chunk", "model": resolved,
                           "choices": [{"delta": {"content": primer + " "}, "index": 0}]}
                    yield f"data: {json.dumps(sse)}\n\n"
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    text = line[6:].strip()
                    if not text or text == "[DONE]":
                        if text == "[DONE]" and not done_sent:
                            done_sent = True
                            yield "data: [DONE]\n\n"
                        continue
                    try:
                        data = json.loads(text)
                        content = data.get("choices", [{}])[0].get("text", "")
                        if _PHONE_GARBAGE_RE.fullmatch(content.strip()):
                            continue
                        if content:
                            sse = {
                                "id": request_id,
                                "object": "chat.completion.chunk",
                                "model": resolved,
                                "choices": [{"delta": {"content": content}, "index": 0}],
                            }
                            yield f"data: {json.dumps(sse)}\n\n"
                    except Exception:
                        pass
        except Exception:
            pass
    if not done_sent:
        yield "data: [DONE]\n\n"


async def chat_completion_stream(
    model: str,
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 2048,
    top_p: float = 1.0,
    stop: list[str] | str | None = None,
) -> AsyncIterator[str]:
    """Stream a chat completion as SSE data lines."""
    import asyncio as _asyncio
    if settings.mac_dev_mode:
        request_id = generate_request_id("mac-dev")
        fake = (
            "I am MAC (MBM AI Cloud) running in **dev mode** — no real model is loaded. "
            "Set `MAC_DEV_MODE=0` and start vLLM to get real inference."
        )
        for word in fake.split(" "):
            chunk = {"id": request_id, "object": "chat.completion.chunk",
                     "model": model, "choices": [{"delta": {"content": word + " "}, "index": 0}]}
            yield f"data: {json.dumps(chunk)}\n\n"
            await _asyncio.sleep(0.04)
        yield "data: [DONE]\n\n"
        return

    resolved, base_url = await _resolve_model_cluster(model, messages)

    # Base LMs (no chat template) fall back to plain completions wrapped as chat SSE
    if resolved in _COMPLETIONS_ONLY_MODELS:
        async for chunk in _completions_to_chat_stream(messages, resolved, base_url, temperature, max_tokens):
            yield chunk
        return

    messages = _inject_system_prompt(messages)
    request_id = generate_request_id("mac-chat")

    payload: dict = {
        "model": resolved,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "stream": True,
    }
    if stop:
        payload["stop"] = stop if isinstance(stop, list) else [stop]

    done_sent = False
    async with httpx.AsyncClient(timeout=settings.vllm_timeout) as client:
        try:
            async with client.stream("POST", _api_url(base_url, "/v1/chat/completions"), json=payload, headers=_auth_headers()) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    err_msg = body.decode(errors="replace")[:200]
                    error_sse = {
                        "id": request_id,
                        "object": "chat.completion.chunk",
                        "error": {"code": "model_unavailable", "message": f"vLLM returned {resp.status_code}: {err_msg}"},
                    }
                    yield f"data: {json.dumps(error_sse)}\n\n"
                    yield "data: [DONE]\n\n"
                    return
                try:
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        text = line.removeprefix("data: ").strip()
                        if not text or text == "[DONE]":
                            if text == "[DONE]" and not done_sent:
                                done_sent = True
                                yield "data: [DONE]\n\n"
                            continue
                        try:
                            chunk = json.loads(text)
                        except json.JSONDecodeError:
                            continue
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            sse = {
                                "id": chunk.get("id", request_id),
                                "object": "chat.completion.chunk",
                                "choices": [{"delta": {"content": content}, "index": 0}],
                            }
                            yield f"data: {json.dumps(sse)}\n\n"
                        finish = chunk.get("choices", [{}])[0].get("finish_reason")
                        if finish and not done_sent:
                            done_sent = True
                            yield "data: [DONE]\n\n"
                except (httpx.RemoteProtocolError, httpx.ReadError):
                    pass
        except (httpx.RemoteProtocolError, httpx.ReadError):
            pass
    if not done_sent:
        yield "data: [DONE]\n\n"


async def text_completion(
    model: str,
    prompt: str,
    max_tokens: int = 256,
    temperature: float = 0.7,
    stop: list[str] | str | None = None,
) -> dict:
    """Text completion via chat endpoint (vLLM supports both)."""
    resolved, base_url = await _resolve_model_cluster(model)
    request_id = generate_request_id("mac-comp")
    start = time.time()

    payload: dict = {
        "model": resolved,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    if stop:
        payload["stop"] = stop if isinstance(stop, list) else [stop]

    async with httpx.AsyncClient(timeout=settings.vllm_timeout) as client:
        resp = await client.post(_api_url(base_url, "/v1/chat/completions"), json=payload, headers=_auth_headers())
        resp.raise_for_status()
        data = resp.json()

    latency_ms = int((time.time() - start) * 1000)
    usage = data.get("usage", {})
    choice = data["choices"][0]
    text = choice.get("text") or choice.get("message", {}).get("content") or ""

    return {
        "id": data.get("id", request_id),
        "object": "text_completion",
        "created": data.get("created", int(time.time())),
        "model": resolved,
        "choices": [{"text": text, "index": 0, "finish_reason": choice.get("finish_reason", "stop")}],
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
        "_latency_ms": latency_ms,
    }


async def generate_embeddings(texts: list[str], model: str = "default") -> dict:
    """Generate embeddings via /v1/embeddings endpoint."""
    resolved = settings.embedding_model if model == "default" else model
    base_url = settings.embedding_url.strip() or settings.vllm_base_url

    async with httpx.AsyncClient(timeout=settings.embedding_timeout) as client:
        resp = await client.post(
            _api_url(base_url, "/v1/embeddings"),
            json={"model": resolved, "input": texts},
            headers=_auth_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "object": "list",
        "data": data.get("data", []),
        "model": resolved,
        "usage": data.get("usage", {"prompt_tokens": 0, "total_tokens": 0}),
    }


async def list_available_models() -> list[dict]:
    """Return all configured models with live health status from vLLM."""
    results = []
    url_status: dict[str, str] = {}

    for model_id, info in DEFAULT_MODELS.items():
        url = getattr(settings, info.get("url_key", "vllm_speed_url"), settings.vllm_base_url)

        if url not in url_status:
            status = "offline"
            try:
                async with httpx.AsyncClient(timeout=settings.vllm_health_timeout) as client:
                    resp = await client.get(_api_url(url, "/v1/models"), headers=_auth_headers())
                    if resp.status_code == 200:
                        status = "loaded"
            except Exception:
                pass
            url_status[url] = status

        results.append({
            "id": info["served_name"],
            "name": info["name"],
            "friendly_id": model_id,
            "model_type": info.get("model_type", "chat"),
            "specialty": info["specialty"],
            "parameters": info["parameters"],
            "category": info["category"],
            "context_length": info["context_length"],
            "capabilities": info["capabilities"],
            "status": url_status[url],
        })

    # Include live community models from worker nodes
    try:
        from mac.database import async_session as async_session_factory
        from mac.services import model_submission_service as sub_svc

        async with async_session_factory() as db:
            live_models = await sub_svc.get_live_models(db)
            for m in live_models:
                if not any(r["friendly_id"] == m.model_id for r in results):
                    results.append({
                        "id": m.model_id,
                        "name": m.display_name,
                        "friendly_id": m.model_id,
                        "model_type": "chat",
                        "specialty": m.description or f"Community {m.category} model",
                        "parameters": m.parameters or "",
                        "category": m.category or "community",
                        "context_length": m.context_length or 4096,
                        "capabilities": m.capabilities or ["chat"],
                        "status": "loaded",
                        "source": "community",
                    })
    except Exception:
        pass  # DB unavailable, skip community models

    return results


# Backward compat
list_ollama_models = list_available_models


async def get_model_detail(model_name: str) -> dict | None:
    """Get info about a specific model."""
    for model_id, info in DEFAULT_MODELS.items():
        if model_name in (model_id, info["served_name"]):
            url = getattr(settings, info.get("url_key", "vllm_speed_url"), settings.vllm_base_url)
            try:
                async with httpx.AsyncClient(timeout=settings.vllm_health_timeout) as client:
                    resp = await client.get(_api_url(url, f"/v1/models/{info['served_name']}"), headers=_auth_headers())
                    resp.raise_for_status()
                    return {**resp.json(), "category": info["category"], "specialty": info["specialty"]}
            except Exception:
                return {"id": info["served_name"], "name": info["name"], "status": "offline"}
    return None


# Keep backward-compat alias
get_ollama_model_detail = get_model_detail


async def vision_chat(
    image_b64: str,
    prompt: str,
    model: str = "auto",
) -> dict:
    """Send an image + prompt to a vision model via OpenAI-compatible API."""
    resolved, base_url = _resolve_model(model)
    request_id = generate_request_id("mac-vis")
    start = time.time()

    payload = {
        "model": resolved,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            },
        ],
        "max_tokens": settings.mac_default_max_tokens,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=settings.vllm_timeout) as client:
        resp = await client.post(_api_url(base_url, "/v1/chat/completions"), json=payload, headers=_auth_headers())
        resp.raise_for_status()
        data = resp.json()

    latency_ms = int((time.time() - start) * 1000)
    choice = data["choices"][0]
    usage = data.get("usage", {})

    return {
        "id": data.get("id", request_id),
        "object": "chat.completion",
        "created": data.get("created", int(time.time())),
        "model": resolved,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": choice["message"]["content"]}, "finish_reason": choice.get("finish_reason", "stop")}],
        "usage": {"prompt_tokens": usage.get("prompt_tokens", 0), "completion_tokens": usage.get("completion_tokens", 0), "total_tokens": usage.get("total_tokens", 0)},
        "_latency_ms": latency_ms,
    }


# ═══════════════════════════════════════════════════════════
#  HELPERS – filter by model_type
# ═══════════════════════════════════════════════════════════

def get_models_by_type(model_type: str) -> dict[str, dict]:
    """Return all models from the registry matching a given model_type."""
    return {k: v for k, v in DEFAULT_MODELS.items() if v.get("model_type") == model_type}


# ═══════════════════════════════════════════════════════════
#  SPEECH-TO-TEXT (Whisper — OpenAI-compatible /v1/audio/transcriptions)
# ═══════════════════════════════════════════════════════════

async def speech_to_text(
    audio_bytes: bytes,
    filename: str = "audio.wav",
    model: str = "default",
    language: str = "en",
) -> dict:
    """Transcribe audio via an OpenAI-compatible Whisper endpoint."""
    resolved_model = settings.whisper_model if model in ("default", "auto") else model
    whisper_base = settings.whisper_url.strip()
    if not whisper_base:
        raise RuntimeError("WHISPER_URL not configured")

    request_id = generate_request_id("mac-stt")
    start = time.time()

    files = {"file": (filename, audio_bytes)}
    data = {"model": resolved_model, "language": language, "response_format": "verbose_json"}

    async with httpx.AsyncClient(timeout=settings.whisper_timeout) as client:
        resp = await client.post(
            _api_url(whisper_base, "/v1/audio/transcriptions"),
            files=files,
            data=data,
            headers=_auth_headers(),
        )
        resp.raise_for_status()
        result = resp.json()

    latency_ms = int((time.time() - start) * 1000)
    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": seg.get("start", 0.0),
            "end": seg.get("end", 0.0),
            "text": seg.get("text", ""),
        })

    return {
        "id": request_id,
        "model": resolved_model,
        "text": result.get("text", ""),
        "language": result.get("language", language),
        "duration_seconds": result.get("duration", 0.0),
        "segments": segments,
        "_latency_ms": latency_ms,
    }


# ═══════════════════════════════════════════════════════════
#  TEXT-TO-SPEECH (OpenAI-compatible /v1/audio/speech)
# ═══════════════════════════════════════════════════════════

async def text_to_speech(
    text: str,
    voice: str = "default",
    speed: float = 1.0,
    response_format: str = "mp3",
    model: str = "default",
) -> bytes:
    """Generate audio from text via an OpenAI-compatible TTS endpoint.
    Returns raw audio bytes in the requested format.
    """
    resolved_model = settings.tts_model if model in ("default", "auto") else model
    tts_base = settings.tts_url.strip()
    if not tts_base:
        raise RuntimeError("TTS_URL not configured")

    payload = {
        "model": resolved_model,
        "input": text,
        "voice": voice,
        "speed": speed,
        "response_format": response_format,
    }

    async with httpx.AsyncClient(timeout=settings.tts_timeout) as client:
        resp = await client.post(
            _api_url(tts_base, "/v1/audio/speech"),
            json=payload,
            headers=_auth_headers(),
        )
        resp.raise_for_status()
        return resp.content
