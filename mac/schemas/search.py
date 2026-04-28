"""Search schemas (Phase 8)."""

from pydantic import BaseModel, Field
from typing import Optional, List


class WebSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    num_results: int = Field(default=10, ge=1, le=50)
    language: str = "en"


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str
    source: str = ""


class WebSearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
    total: int


class WikipediaSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
    language: str = "en"


class WikipediaSummary(BaseModel):
    title: str
    summary: str
    url: str
    thumbnail: Optional[str] = None


class WikipediaSearchResponse(BaseModel):
    query: str
    results: List[WikipediaSummary]


class GroundedSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    num_sources: int = Field(default=5, ge=1, le=20)
    model: str = "auto"


class GroundedSearchResponse(BaseModel):
    id: str
    answer: str
    model: str
    sources: List[SearchResult] = []
    tokens_used: int = 0


class SearchCacheEntry(BaseModel):
    query: str
    result_count: int
    cached_at: str
    expires_at: str


class SearchCacheResponse(BaseModel):
    entries: List[SearchCacheEntry]
    total: int
