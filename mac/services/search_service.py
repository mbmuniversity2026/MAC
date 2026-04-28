"""Search service (Phase 8) — web search via SearXNG, Wikipedia, grounded answers."""

import time
import hashlib
from datetime import datetime, timezone, timedelta
import httpx
from mac.config import settings
from mac.services import llm_service
from mac.utils.security import generate_request_id

# SearXNG instance URL (self-hosted via Docker) — from config
SEARXNG_URL = settings.searxng_url

# Simple in-memory cache with TTL
_search_cache: dict[str, dict] = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour


def _cache_key(query: str, source: str) -> str:
    return hashlib.md5(f"{source}:{query.lower().strip()}".encode()).hexdigest()


def _get_cached(query: str, source: str) -> list[dict] | None:
    key = _cache_key(query, source)
    entry = _search_cache.get(key)
    if entry and datetime.now(timezone.utc) < entry["expires_at"]:
        return entry["results"]
    if entry:
        del _search_cache[key]
    return None


def _set_cache(query: str, source: str, results: list[dict]):
    key = _cache_key(query, source)
    _search_cache[key] = {
        "query": query,
        "source": source,
        "results": results,
        "cached_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=_CACHE_TTL_SECONDS),
    }


async def web_search(query: str, num_results: int = 10, language: str = "en") -> list[dict]:
    """Search the web via SearXNG (aggregates Google, Bing, DuckDuckGo, etc.)."""
    # Check cache first
    cached = _get_cached(query, "web")
    if cached is not None:
        return cached[:num_results]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{SEARXNG_URL}/search",
                params={
                    "q": query,
                    "format": "json",
                    "language": language,
                    "pageno": 1,
                    "categories": "general",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        for item in data.get("results", [])[:num_results]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("content", ""),
                "source": item.get("engine", ""),
            })

        _set_cache(query, "web", results)
        return results

    except Exception as e:
        # Fallback: return empty results if SearXNG unavailable
        return []


async def wikipedia_search(query: str, language: str = "en") -> list[dict]:
    """Search Wikipedia API directly."""
    cached = _get_cached(query, "wikipedia")
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Use Wikipedia API
            resp = await client.get(
                f"https://{language}.wikipedia.org/api/rest_v1/page/summary/{query.replace(' ', '_')}",
                headers={"User-Agent": "MAC-MBM-AI-Cloud/1.0"},
            )

            if resp.status_code == 200:
                data = resp.json()
                results = [{
                    "title": data.get("title", ""),
                    "summary": data.get("extract", ""),
                    "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
                    "thumbnail": data.get("thumbnail", {}).get("source"),
                }]
                _set_cache(query, "wikipedia", results)
                return results

            # Fallback: search endpoint
            resp = await client.get(
                f"https://{language}.wikipedia.org/w/api.php",
                params={
                    "action": "opensearch",
                    "search": query,
                    "limit": 5,
                    "format": "json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

            results = []
            if len(data) >= 4:
                titles, _, urls = data[1], data[2], data[3]
                for title, url in zip(titles, urls):
                    results.append({
                        "title": title,
                        "summary": "",
                        "url": url,
                        "thumbnail": None,
                    })

            _set_cache(query, "wikipedia", results)
            return results

    except Exception:
        return []


async def grounded_search(query: str, num_sources: int = 5, model: str = "auto") -> dict:
    """Search web + LLM: retrieve sources, generate cited answer."""
    request_id = generate_request_id("mac-search")

    # Step 1: Get web results
    web_results = await web_search(query, num_results=num_sources)

    # Step 2: Build context from search results
    context_parts = []
    for i, r in enumerate(web_results, 1):
        context_parts.append(f"[Source {i}] {r['title']}\n{r['snippet']}\nURL: {r['url']}")

    context = "\n\n".join(context_parts)

    # Step 3: Generate answer with LLM
    system_prompt = (
        "You are a research assistant. Answer the user's question using ONLY the provided sources. "
        "Cite sources using [Source N] format. If the sources don't contain enough information, say so."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Sources:\n{context}\n\nQuestion: {query}"},
    ]

    try:
        result = await llm_service.chat_completion(
            model=model,
            messages=messages,
            temperature=0.3,
            max_tokens=1024,
        )
        answer = result["choices"][0]["message"]["content"]
        tokens = result["usage"]["total_tokens"]
    except Exception:
        answer = "Unable to generate answer — LLM unavailable. Please review the sources below."
        tokens = 0

    return {
        "id": request_id,
        "answer": answer,
        "model": model,
        "sources": web_results,
        "tokens_used": tokens,
    }


def get_search_cache() -> list[dict]:
    """Get cached search entries."""
    now = datetime.now(timezone.utc)
    entries = []
    for key, entry in list(_search_cache.items()):
        if now < entry["expires_at"]:
            entries.append({
                "query": entry["query"],
                "result_count": len(entry["results"]),
                "cached_at": entry["cached_at"].isoformat(),
                "expires_at": entry["expires_at"].isoformat(),
            })
    return entries
