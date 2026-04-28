"""Idempotent seeder for the 15 default feature flags.

Run on every app startup. INSERT-IF-NOT-EXISTS semantics: existing flags
keep their admin-set values; only missing keys are created.
"""

import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mac.models.feature_flag import FeatureFlag

log = logging.getLogger(__name__)

# (key, label, description, allowed_roles)
DEFAULT_FLAGS: list[tuple[str, str, str, list[str]]] = [
    ("ai_chat",          "AI Chat",              "Conversational AI access.",       ["student", "faculty", "admin"]),
    ("web_search",       "Web Search in Chat",   "SearXNG-backed web search tool.", ["student", "faculty", "admin"]),
    ("image_gen",        "Image Generation",     "Local image generation models.",  ["student", "faculty", "admin"]),
    ("voice_input",      "Voice Input (STT)",    "Whisper-based speech-to-text.",   ["student", "faculty", "admin"]),
    ("tts_output",       "Text-to-Speech",       "Piper TTS playback.",             ["student", "faculty", "admin"]),
    ("mbm_book",         "MBM Book (Notebooks)", "Jupyter-style notebooks UI.",     ["student", "faculty", "admin"]),
    ("rag_upload",       "Document Upload",      "RAG document ingestion.",         ["student", "faculty", "admin"]),
    ("copy_check",       "Copy Check",           "Answer-sheet evaluation.",        ["faculty", "admin"]),
    ("attendance",       "Attendance",           "Attendance recording.",           ["student", "faculty", "admin"]),
    ("doubts_forum",     "Doubts Forum",         "Q&A forum.",                      ["student", "faculty", "admin"]),
    ("file_sharing",     "File Sharing",         "Admin-uploaded shared files.",    ["student", "faculty", "admin"]),
    ("community_models", "Community Models",     "User-submitted models.",          ["student", "faculty", "admin"]),
    ("dark_mode",        "Dark Mode",            "User-toggleable dark theme.",     ["student", "faculty", "admin"]),
    ("guest_access",     "Guest Access",         "Anonymous read-only access.",     []),
    ("video_studio",     "Video Studio",         "FFmpeg-driven video editor.",     ["admin"]),
]


async def seed_default_flags(db: AsyncSession) -> int:
    """INSERT IF NOT EXISTS. Returns number of new flags created."""
    result = await db.execute(select(FeatureFlag.key))
    existing_keys = {row[0] for row in result.all()}
    created = 0
    for key, label, description, allowed_roles in DEFAULT_FLAGS:
        if key in existing_keys:
            continue
        db.add(FeatureFlag(
            key=key,
            label=label,
            description=description,
            enabled=True,
            allowed_roles=allowed_roles,
        ))
        created += 1
    if created:
        await db.flush()
        log.info("Seeded %d feature flags", created)
    return created
