"""MAC configuration — loaded from .env file.

Every value can be overridden by setting the corresponding environment variable
or by adding it to a .env file in the project root.  No source code edits needed.
"""

from pydantic_settings import BaseSettings
from pydantic import model_validator
from typing import List
import json


class Settings(BaseSettings):
    # ── App ───────────────────────────────────────────────
    mac_env: str = "development"
    mac_host: str = "0.0.0.0"
    mac_port: int = 8000
    mac_debug: bool = False
    mac_secret_key: str = "change-me"
    mac_cors_origins: str = '["*"]'
    mac_workers: int = 4

    # ── Database ──────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://mac:mac_password@localhost:5432/mac_db"

    @model_validator(mode="after")
    def _fix_database_url(self):
        """Auto-convert postgres:// or postgresql:// to postgresql+asyncpg://
        and strip sslmode query param (handled in connect_args)."""
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if "sslmode=" in url:
            import re
            url = re.sub(r'[?&]sslmode=[^&]*', '', url)
            url = url.replace('?&', '?').rstrip('?')
        self.database_url = url
        return self

    # ── Redis ─────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── JWT ───────────────────────────────────────────────
    jwt_secret_key: str = "change-me-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 1440  # 24h
    jwt_refresh_token_expire_days: int = 30

    # ── vLLM backends (local GPU inference) ───────────────
    vllm_base_url: str = "http://localhost:8001"
    vllm_api_key: str = ""
    vllm_timeout: int = 120          # HTTP timeout (seconds) for vLLM requests
    vllm_health_timeout: int = 5     # Timeout for model health checks

    # Per-slot endpoints — each maps to a vLLM instance
    vllm_speed_url: str = "http://localhost:8001"
    vllm_code_url: str = "http://localhost:8002"
    vllm_reasoning_url: str = "http://localhost:8003"
    vllm_intelligence_url: str = "http://localhost:8004"

    # ── Whisper / STT ─────────────────────────────────────
    whisper_url: str = "http://localhost:8005"
    whisper_model: str = "Systran/faster-whisper-small"
    whisper_timeout: int = 300  # audio transcription can be slow

    # ── TTS ───────────────────────────────────────────────
    tts_url: str = "http://localhost:8006"
    tts_model: str = "default"
    tts_timeout: int = 120

    # ── Embeddings ────────────────────────────────────────
    embedding_url: str = ""  # empty = use vllm_base_url
    embedding_model: str = "nomic-embed-text"
    embedding_timeout: int = 60

    # ── Model registry (configurable without code changes) ─
    # JSON array that *replaces* the built-in model list.
    # Each object needs: id, name, served_name, url_key, category,
    #   parameters, context_length, capabilities (list), specialty.
    # Leave empty to use the built-in defaults.
    mac_models_json: str = ""

    # Comma-separated model IDs to *enable* from the built-in list.
    # Example: "qwen2.5:7b,qwen2.5-coder:7b"  (only those two will be active)
    # Leave empty to enable all built-in models.
    mac_enabled_models: str = ""

    # Which model ID the "auto" keyword falls back to when no keyword match.
    # Leave empty → first model with category "speed" or "code".
    mac_auto_fallback: str = ""

    # Default max_tokens for chat/completion when the client doesn't specify.
    mac_default_max_tokens: int = 2048

    # Auto-download open-source model weights from Hugging Face cache.
    # Triggered on first real app use when enabled.
    mac_model_auto_download_on_use: bool = False
    mac_model_auto_download_limit: int = 0  # 0 = all detected open-source models

    # ── Qdrant (RAG vector DB) ────────────────────────────
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "mac_documents"

    # ── SearXNG (web search) ──────────────────────────────
    searxng_url: str = "http://localhost:8888"

    # ── Rate Limits ───────────────────────────────────────
    rate_limit_requests_per_hour: int = 100
    rate_limit_tokens_per_day: int = 50000

    # ── Notebook Kernels ──────────────────────────────────
    kernel_timeout: int = 120            # seconds per cell execution
    kernel_max_per_node: int = 10        # concurrent kernels per worker
    kernel_default_memory: str = "4g"    # Docker memory limit
    kernel_default_cpus: str = "2"       # Docker CPU limit
    kernel_image_prefix: str = "mac-kernel"  # Docker image name prefix

    # ── MAC Session 1 additions ───────────────────────────
    mac_dev_mode: bool = False                       # MAC_DEV_MODE — mock LLM streaming
    mac_download_limit_mbps: int = 100               # MAC_DOWNLOAD_LIMIT_MBPS
    mac_github_repo: str = "RamMAC17/MAC"            # MAC_GITHUB_REPO — for updater
    mac_discovery_port: int = 7700                   # MAC_DISCOVERY_PORT — UDP
    mac_update_check_interval_hours: int = 6         # background updater cadence

    @property
    def cors_origins(self) -> List[str]:
        return json.loads(self.mac_cors_origins)

    @property
    def is_dev(self) -> bool:
        return self.mac_env == "development"

    @property
    def is_sqlite(self) -> bool:
        return "sqlite" in self.database_url

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
