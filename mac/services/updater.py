"""GitHub-based auto-update checker. Fail-silent, never crashes the app."""

import asyncio
import json
import logging
import pathlib
from datetime import datetime, timezone
from typing import Optional

from mac.config import settings

log = logging.getLogger(__name__)

CACHE_KEY = "mac:update_status"
CACHE_TTL_SECONDS = 6 * 3600

VERSION_FILE = pathlib.Path(__file__).resolve().parent.parent / "VERSION"


def get_current_version() -> str:
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or "0.0.0"
    except Exception:  # noqa: BLE001
        return "0.0.0"


def _semver_tuple(v: str) -> tuple[int, int, int]:
    """Best-effort semver parse. Strips leading 'v'. Returns (0,0,0) on failure."""
    s = v.strip().lstrip("v")
    parts = s.split(".")[:3]
    out = []
    for p in parts:
        try:
            out.append(int("".join(c for c in p if c.isdigit()) or "0"))
        except ValueError:
            out.append(0)
    while len(out) < 3:
        out.append(0)
    return tuple(out)  # type: ignore[return-value]


async def _redis_get_cached() -> Optional[dict]:
    try:
        import redis.asyncio as redis_async
        r = redis_async.from_url(settings.redis_url, decode_responses=True)
        raw = await r.get(CACHE_KEY)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


async def _redis_set_cached(payload: dict) -> None:
    try:
        import redis.asyncio as redis_async
        r = redis_async.from_url(settings.redis_url, decode_responses=True)
        await r.setex(CACHE_KEY, CACHE_TTL_SECONDS, json.dumps(payload))
    except Exception:  # noqa: BLE001
        pass


async def _fetch_latest_release() -> Optional[dict]:
    """Hit GitHub releases API; returns None on any failure."""
    url = f"https://api.github.com/repos/{settings.mac_github_repo}/releases/latest"
    try:
        import aiohttp
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers={"Accept": "application/vnd.github+json"}) as resp:
                if resp.status != 200:
                    return None
                return await resp.json()
    except Exception as e:  # noqa: BLE001
        log.debug("Update check failed: %s", e)
        return None


async def check_for_update(use_cache: bool = True) -> dict:
    """Returns a status dict. Always succeeds (returns offline placeholder on failure)."""
    current = get_current_version()
    if use_cache:
        cached = await _redis_get_cached()
        if cached:
            return cached
    release = await _fetch_latest_release()
    now_iso = datetime.now(timezone.utc).isoformat()
    if not release:
        payload = {
            "current": current,
            "latest": None,
            "update_available": False,
            "notes": None,
            "release_url": None,
            "checked_at": now_iso,
            "error": "GitHub unreachable or no releases yet",
        }
        return payload
    latest = release.get("tag_name", "0.0.0")
    payload = {
        "current": current,
        "latest": latest,
        "update_available": _semver_tuple(latest) > _semver_tuple(current),
        "notes": (release.get("body") or "")[:2000],
        "release_url": release.get("html_url"),
        "checked_at": now_iso,
        "error": None,
    }
    await _redis_set_cached(payload)
    return payload


async def background_check_loop():
    """Periodic update check. Cancelled at app shutdown."""
    interval_s = max(60, settings.mac_update_check_interval_hours * 3600)
    while True:
        try:
            await check_for_update(use_cache=False)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("Updater loop iteration failed: %s", e)
        try:
            await asyncio.sleep(interval_s)
        except asyncio.CancelledError:
            raise
