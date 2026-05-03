"""Live activity feed service — IST-timestamped, human-readable entries.

Stores the last 500 events in memory for the SSE stream.
Called from routers on every significant action.
"""

import asyncio
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Any

IST = timezone(timedelta(hours=5, minutes=30))
_FEED: deque = deque(maxlen=500)
_LISTENERS: list[asyncio.Queue] = []

# Emoji icons per category
_ICONS = {
    "chat":       "🟢",
    "attendance": "✅",
    "upload":     "📚",
    "download":   "⬇️",
    "auth":       "🔑",
    "quota":      "⚠️",
    "cluster":    "🖥",
    "feature":    "⚙️",
    "copy_check": "📝",
    "doubt":      "💬",
    "video":      "🎬",
    "thumbnail":  "🖼",
    "voice":      "🎙",
    "system":     "🔧",
    "default":    "•",
}


def _ist_now() -> str:
    return datetime.now(IST).strftime("%H:%M:%S IST")


def _build_entry(category: str, message: str) -> dict:
    icon = _ICONS.get(category, _ICONS["default"])
    ts = _ist_now()
    return {"icon": icon, "time": ts, "message": message, "category": category}


async def log(category: str, message: str) -> None:
    """Add a human-readable IST entry to the live feed and notify SSE listeners."""
    entry = _build_entry(category, message)
    _FEED.appendleft(entry)
    dead = []
    for q in _LISTENERS:
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        try:
            _LISTENERS.remove(q)
        except ValueError:
            pass


def get_recent(limit: int = 200) -> list[dict]:
    return list(_FEED)[:limit]


async def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _LISTENERS.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _LISTENERS.remove(q)
    except ValueError:
        pass
