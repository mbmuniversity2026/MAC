"""
Veena TTS Server — OpenAI-compatible /v1/audio/speech endpoint
Model: maya-research/Veena (Orpheus-style: Llama + SNAC 24kHz codec)
Speakers: kavya, agastya, maitri, vinaya  (Hindi + English + Hinglish)
"""

import io
import os
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("veena")

app = FastAPI(title="Veena TTS", version="1.0")

# ── Config ────────────────────────────────────────────────────────────────────
MODEL_ID    = os.getenv("VEENA_MODEL",  "maya-research/Veena")
SNAC_ID     = os.getenv("SNAC_MODEL",   "hubertsiuzdak/snac_24khz")
SAMPLE_RATE = 24000

_auto = os.getenv("VEENA_DEVICE", "auto")
if _auto == "auto":
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
else:
    DEVICE = _auto

log.info("Veena will use device: %s", DEVICE)

# ── Voice aliases ─────────────────────────────────────────────────────────────
VOICE_MAP: dict[str, str] = {
    # Native Veena speakers
    "kavya":   "kavya",
    "agastya": "agastya",
    "maitri":  "maitri",
    "vinaya":  "vinaya",
    # Language-code aliases (from voice_chat.py)
    "hi_IN":   "kavya",
    "en_IN":   "kavya",
    "default": "kavya",
    # OpenAI voice name aliases (for drop-in compatibility)
    "alloy":   "kavya",
    "nova":    "kavya",
    "shimmer": "vinaya",
    "echo":    "agastya",
    "onyx":    "agastya",
    "fable":   "maitri",
}

# ── Orpheus audio-token range ─────────────────────────────────────────────────
# Veena follows Orpheus-TTS convention: audio tokens start at ID 128266
AUDIO_TOKEN_OFFSET = 128266
AUDIO_TOKEN_COUNT  = 4096 * 8   # generous upper bound

# ── Global model state ────────────────────────────────────────────────────────
_model     = None
_tokenizer = None
_snac      = None
_executor  = ThreadPoolExecutor(max_workers=1)  # serialise GPU calls


# ── Model loader (blocking — called from startup executor) ────────────────────

def _load_models():
    global _model, _tokenizer, _snac

    from transformers import AutoModelForCausalLM, AutoTokenizer
    import snac as snac_module

    log.info("Loading Veena tokenizer …")
    _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

    log.info("Loading Veena model on %s …", DEVICE)
    model_kwargs: dict = {"low_cpu_mem_usage": True}
    if DEVICE == "cuda":
        from transformers import BitsAndBytesConfig
        model_kwargs["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True)
        model_kwargs["device_map"] = "auto"
    else:
        model_kwargs["torch_dtype"] = torch.float32

    _model = AutoModelForCausalLM.from_pretrained(MODEL_ID, **model_kwargs)
    if DEVICE == "cpu":
        _model = _model.to("cpu")
    _model.eval()

    log.info("Loading SNAC codec (%s) …", SNAC_ID)
    _snac = snac_module.SNAC.from_pretrained(SNAC_ID).eval()
    if DEVICE == "cuda":
        _snac = _snac.to("cuda")

    log.info("✓ Veena TTS ready — speakers: kavya, agastya, maitri, vinaya")


# ── SNAC audio-token decoding ─────────────────────────────────────────────────

def _decode_snac(audio_tokens: list[int]) -> np.ndarray | None:
    """
    Decode Orpheus-style 7-token audio frames through SNAC to a float32 waveform.

    Frame structure (7 tokens per frame):
      token[0]           → SNAC level-0 code  (1 per frame)
      token[1], token[2] → SNAC level-1 codes (2 per frame)
      token[3..6]        → SNAC level-2 codes (4 per frame)
    """
    n = (len(audio_tokens) // 7) * 7
    if n == 0:
        return None
    audio_tokens = audio_tokens[:n]

    c0, c1, c2 = [], [], []
    for i in range(0, n, 7):
        g = audio_tokens[i : i + 7]
        c0.append(g[0] % 4096)
        c1.extend([g[1] % 4096, g[2] % 4096])
        c2.extend([g[3] % 4096, g[4] % 4096, g[5] % 4096, g[6] % 4096])

    snac_dev = next(_snac.parameters()).device
    codes = [
        torch.tensor(c0, dtype=torch.int32).unsqueeze(0).to(snac_dev),
        torch.tensor(c1, dtype=torch.int32).unsqueeze(0).to(snac_dev),
        torch.tensor(c2, dtype=torch.int32).unsqueeze(0).to(snac_dev),
    ]
    with torch.inference_mode():
        audio = _snac.decode(codes)

    return audio.squeeze().cpu().float().numpy()


# ── Core generation (blocking) ────────────────────────────────────────────────

def _generate_wav(text: str, speaker: str, temperature: float, top_p: float) -> bytes:
    # Build prompt — Orpheus/Veena format
    # Uses the model's own special tokens; fall back to plain text if tokenizer
    # doesn't have them (the model will still produce some audio).
    try:
        prompt = f"<|audio|><|{speaker}|>{text}<|eoa|>"
        _ = _tokenizer.encode("<|audio|>")   # probe: raises if token missing
    except Exception:
        # Fallback: simpler prompt that many Orpheus variants accept
        prompt = f"{speaker}: {text}"

    inputs = _tokenizer(prompt, return_tensors="pt")
    input_ids = inputs["input_ids"].to(_model.device)

    with torch.inference_mode():
        output_ids = _model.generate(
            input_ids,
            max_new_tokens=1500,
            do_sample=True,
            temperature=temperature,
            top_p=top_p,
            repetition_penalty=1.1,
            eos_token_id=_tokenizer.eos_token_id,
        )

    new_tokens = output_ids[0, input_ids.shape[1] :].tolist()

    # Extract audio tokens (IDs in Orpheus audio range)
    audio_tokens = [
        t - AUDIO_TOKEN_OFFSET
        for t in new_tokens
        if AUDIO_TOKEN_OFFSET <= t < AUDIO_TOKEN_OFFSET + AUDIO_TOKEN_COUNT
    ]

    if not audio_tokens:
        raise RuntimeError(
            "No audio tokens in model output — check that the model is Veena/Orpheus-style."
        )

    waveform = _decode_snac(audio_tokens)
    if waveform is None:
        raise RuntimeError("SNAC decode produced empty waveform.")

    # Normalise to prevent clipping
    peak = np.abs(waveform).max()
    if peak > 0:
        waveform = waveform / peak * 0.95

    buf = io.BytesIO()
    sf.write(buf, waveform, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


# ── FastAPI lifecycle ─────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(_executor, _load_models)
    except Exception:
        log.exception("Model load failed — server will return 503 until fixed.")


# ── OpenAI-compatible TTS endpoint ───────────────────────────────────────────

class SpeechRequest(BaseModel):
    model:           str   = "veena"
    input:           str
    voice:           str   = "kavya"
    speed:           float = 1.0
    response_format: str   = "wav"


@app.post("/v1/audio/speech")
async def speech(req: SpeechRequest):
    if _model is None:
        raise HTTPException(503, detail="Model still loading — retry in a moment.")

    speaker = VOICE_MAP.get(req.voice.lower(), "kavya")
    temp    = max(0.1, min(1.5, 0.8))
    topp    = max(0.1, min(1.0, 0.95))

    loop = asyncio.get_event_loop()
    try:
        wav_bytes = await loop.run_in_executor(
            _executor, _generate_wav, req.input, speaker, temp, topp
        )
    except Exception as exc:
        log.exception("TTS generation error")
        raise HTTPException(500, detail=str(exc))

    return Response(content=wav_bytes, media_type="audio/wav")


# ── Health + model-list endpoints (so MAC API can poll) ──────────────────────

@app.get("/health")
def health():
    return {"status": "ok" if _model is not None else "loading", "device": DEVICE}


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [
            {"id": "veena", "object": "model", "owned_by": "maya-research"},
        ],
    }
