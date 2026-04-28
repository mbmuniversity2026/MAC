"""Search endpoints — /search (Phase 8)."""

from fastapi import APIRouter, Depends
from mac.schemas.search import (
    WebSearchRequest, WebSearchResponse, SearchResult,
    WikipediaSearchRequest, WikipediaSearchResponse, WikipediaSummary,
    GroundedSearchRequest, GroundedSearchResponse,
    SearchCacheResponse, SearchCacheEntry,
)
from mac.services import search_service
from mac.middleware.auth_middleware import get_current_user
from mac.models.user import User

router = APIRouter(prefix="/search", tags=["Search"])


@router.post("/web", response_model=WebSearchResponse)
async def web_search(body: WebSearchRequest, user: User = Depends(get_current_user)):
    """Search the web via SearXNG — aggregates Google, Bing, DuckDuckGo, Wikipedia."""
    results = await search_service.web_search(body.query, body.num_results, body.language)
    return WebSearchResponse(
        query=body.query,
        results=[SearchResult(**r) for r in results],
        total=len(results),
    )


@router.post("/wikipedia", response_model=WikipediaSearchResponse)
async def wikipedia_search(body: WikipediaSearchRequest, user: User = Depends(get_current_user)):
    """Targeted Wikipedia search with summary extraction."""
    results = await search_service.wikipedia_search(body.query, body.language)
    return WikipediaSearchResponse(
        query=body.query,
        results=[WikipediaSummary(**r) for r in results],
    )


@router.post("/grounded", response_model=GroundedSearchResponse)
async def grounded_search(body: GroundedSearchRequest, user: User = Depends(get_current_user)):
    """Search + LLM — retrieves web results, generates cited answer."""
    result = await search_service.grounded_search(body.query, body.num_sources, body.model)
    return GroundedSearchResponse(
        id=result["id"],
        answer=result["answer"],
        model=result["model"],
        sources=[SearchResult(**s) for s in result["sources"]],
        tokens_used=result["tokens_used"],
    )


@router.get("/cache", response_model=SearchCacheResponse)
async def search_cache(user: User = Depends(get_current_user)):
    """List recently cached search results."""
    entries = search_service.get_search_cache()
    return SearchCacheResponse(
        entries=[SearchCacheEntry(**e) for e in entries],
        total=len(entries),
    )
