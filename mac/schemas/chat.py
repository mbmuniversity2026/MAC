"""Chat / Query request/response schemas — OpenAI-compatible."""

from pydantic import BaseModel, Field
from typing import Optional, List, Union
from datetime import datetime


# ── Chat ──────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: Optional[str] = Field(default=None, max_length=32000)
    reasoning_content: Optional[str] = Field(default=None, max_length=64000)


class ChatRequest(BaseModel):
    model: str = Field(default="auto", examples=["auto", "qwen2.5-coder:7b"])
    messages: List[ChatMessage] = Field(..., min_length=1)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=8192)
    stream: bool = False
    top_p: float = Field(default=1.0, ge=0.0, le=1.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    stop: Optional[Union[str, List[str]]] = None
    context_id: Optional[str] = None


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatChoice(BaseModel):
    index: int = 0
    message: ChatMessage
    finish_reason: str = "stop"


class ChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: List[ChatChoice]
    usage: UsageInfo
    context_id: Optional[str] = None


# ── Completions ───────────────────────────────────────────

class CompletionRequest(BaseModel):
    model: str = Field(default="auto")
    prompt: str = Field(..., max_length=32000)
    max_tokens: int = Field(default=256, ge=1, le=8192)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    stop: Optional[Union[str, List[str]]] = None
    echo: bool = False


class CompletionChoice(BaseModel):
    text: str
    index: int = 0
    finish_reason: str = "stop"


class CompletionResponse(BaseModel):
    id: str
    object: str = "text_completion"
    created: int
    model: str
    choices: List[CompletionChoice]
    usage: UsageInfo


# ── Embeddings ────────────────────────────────────────────

class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: str = "default"


class EmbeddingData(BaseModel):
    object: str = "embedding"
    index: int
    embedding: List[float]


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data: List[EmbeddingData]
    model: str
    usage: UsageInfo


# ── Rerank ────────────────────────────────────────────────

class RerankRequest(BaseModel):
    query: str
    documents: List[str] = Field(..., min_length=1)
    top_k: Optional[int] = None


class RerankResult(BaseModel):
    index: int
    document: str
    relevance_score: float


class RerankResponse(BaseModel):
    results: List[RerankResult]


# ── Speech-to-Text ────────────────────────────────────────

class STTSegment(BaseModel):
    start: float
    end: float
    text: str


class STTResponse(BaseModel):
    id: str
    model: str = "whisper-large-v3"
    text: str
    language: str = "en"
    duration_seconds: float = 0.0
    segments: List[STTSegment] = []


# ── Text-to-Speech ────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str = Field(..., max_length=4096)
    voice: str = "default"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    response_format: str = Field(default="mp3", pattern="^(mp3|wav|opus)$")
