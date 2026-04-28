"""RAG / Knowledgebase schemas (Phase 7)."""

from pydantic import BaseModel, Field
from typing import Optional, List


class RAGIngestResponse(BaseModel):
    document_id: str
    title: str
    collection: str
    chunk_count: int = 0
    status: str = "processing"
    message: str = "Document queued for processing"


class RAGDocumentInfo(BaseModel):
    id: str
    title: str
    filename: str
    collection_id: str
    content_type: str
    file_size: int
    chunk_count: int
    page_count: int
    status: str
    created_at: str


class RAGDocumentsResponse(BaseModel):
    documents: List[RAGDocumentInfo]
    total: int
    page: int = 1


class RAGDocumentDetail(RAGDocumentInfo):
    error_message: Optional[str] = None
    uploaded_by: str


class RAGQueryRequest(BaseModel):
    question: str = Field(..., max_length=2000)
    collection: Optional[str] = None
    top_k: int = Field(default=5, ge=1, le=20)
    model: str = "auto"
    include_sources: bool = True


class RAGSourceChunk(BaseModel):
    document_id: str
    document_title: str
    chunk_text: str
    relevance_score: float
    page: Optional[int] = None


class RAGQueryResponse(BaseModel):
    id: str
    answer: str
    model: str
    sources: List[RAGSourceChunk] = []
    tokens_used: int = 0


class RAGCollectionInfo(BaseModel):
    id: str
    name: str
    description: str
    document_count: int
    created_at: str


class RAGCollectionCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: str = Field(default="", max_length=500)


class RAGCollectionsResponse(BaseModel):
    collections: List[RAGCollectionInfo]
    total: int
