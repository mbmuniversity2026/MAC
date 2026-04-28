"""RAG / Knowledgebase endpoints — /rag (Phase 7)."""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from mac.database import get_db
from mac.middleware.feature_gate import feature_required
from mac.schemas.rag import (
    RAGIngestResponse, RAGDocumentInfo, RAGDocumentsResponse, RAGDocumentDetail,
    RAGQueryRequest, RAGQueryResponse, RAGSourceChunk,
    RAGCollectionCreateRequest, RAGCollectionInfo, RAGCollectionsResponse,
)
from mac.services import rag_service, llm_service
from mac.middleware.auth_middleware import get_current_user, require_admin
from mac.models.user import User
from mac.utils.security import generate_request_id

router = APIRouter(prefix="/rag", tags=["RAG"])


@router.post("/ingest", response_model=RAGIngestResponse)
async def ingest_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    collection: str = Form(default="general"),
    user: User = Depends(get_current_user),
    _fg: User = Depends(feature_required("rag_upload")),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document (PDF/DOCX/TXT) for RAG. Chunks, embeds, stores in vector DB."""
    # Validate file type
    allowed = {"text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
    if file.content_type not in allowed and not file.filename.endswith((".txt", ".md", ".pdf", ".docx")):
        raise HTTPException(status_code=400, detail={
            "code": "invalid_file",
            "message": "Supported formats: TXT, MD, PDF, DOCX",
        })

    # Read file content
    content_bytes = await file.read()
    file_size = len(content_bytes)

    # Extract text based on type
    if file.filename.endswith((".txt", ".md")):
        text_content = content_bytes.decode("utf-8", errors="replace")
    else:
        # For PDF/DOCX, store raw and note that advanced parsing requires additional libs
        text_content = content_bytes.decode("utf-8", errors="replace")

    # Ensure collection exists
    coll = await rag_service.get_collection_by_name(db, collection)
    if not coll:
        coll = await rag_service.create_collection(db, collection, f"Auto-created for {collection}", user.id)

    doc = await rag_service.ingest_document(
        db=db,
        collection_id=coll.id,
        title=title,
        filename=file.filename,
        content=text_content,
        content_type=file.content_type or "text/plain",
        file_size=file_size,
        uploaded_by=user.id,
    )

    return RAGIngestResponse(
        document_id=doc.id,
        title=doc.title,
        collection=collection,
        chunk_count=doc.chunk_count,
        status=doc.status,
    )


@router.get("/documents", response_model=RAGDocumentsResponse)
async def list_documents(
    collection: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all ingested documents."""
    collection_id = None
    if collection:
        coll = await rag_service.get_collection_by_name(db, collection)
        if coll:
            collection_id = coll.id

    docs = await rag_service.get_documents(db, collection_id)
    return RAGDocumentsResponse(
        documents=[RAGDocumentInfo(
            id=d.id, title=d.title, filename=d.filename,
            collection_id=d.collection_id, content_type=d.content_type,
            file_size=d.file_size, chunk_count=d.chunk_count,
            page_count=d.page_count, status=d.status,
            created_at=d.created_at.isoformat(),
        ) for d in docs],
        total=len(docs),
    )


@router.get("/documents/{doc_id}", response_model=RAGDocumentDetail)
async def get_document(doc_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Get document details and its chunks."""
    doc = await rag_service.get_document_by_id(db, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})

    return RAGDocumentDetail(
        id=doc.id, title=doc.title, filename=doc.filename,
        collection_id=doc.collection_id, content_type=doc.content_type,
        file_size=doc.file_size, chunk_count=doc.chunk_count,
        page_count=doc.page_count, status=doc.status,
        error_message=doc.error_message, uploaded_by=doc.uploaded_by,
        created_at=doc.created_at.isoformat(),
    )


@router.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Remove a document from knowledgebase (admin-only)."""
    deleted = await rag_service.delete_document(db, doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})
    return {"message": "Document deleted"}


@router.post("/query", response_model=RAGQueryResponse)
async def rag_query(
    body: RAGQueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ask a question — retrieves relevant chunks from knowledgebase, sends to LLM with context."""
    request_id = generate_request_id("mac-rag")

    # Step 1: Retrieve relevant chunks
    sources = await rag_service.query_rag(db, body.question, body.collection, body.top_k)

    # Step 2: Build context
    context_parts = []
    for i, src in enumerate(sources, 1):
        context_parts.append(f"[Source {i}: {src['document_title']}]\n{src['chunk_text']}")

    context = "\n\n".join(context_parts) if context_parts else "No relevant documents found in the knowledgebase."

    # Step 3: Generate answer
    system_prompt = (
        "You are a helpful academic assistant for MBM Engineering College. "
        "Answer the question using the provided context from the knowledgebase. "
        "Cite sources using [Source N] format. If the context doesn't answer the question, say so."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {body.question}"},
    ]

    try:
        result = await llm_service.chat_completion(
            model=body.model,
            messages=messages,
            temperature=0.3,
            max_tokens=1024,
        )
        answer = result["choices"][0]["message"]["content"]
        tokens = result["usage"]["total_tokens"]
    except Exception:
        answer = "Unable to generate answer. Please review the sources below."
        tokens = 0

    return RAGQueryResponse(
        id=request_id,
        answer=answer,
        model=body.model,
        sources=[RAGSourceChunk(**s) for s in sources] if body.include_sources else [],
        tokens_used=tokens,
    )


@router.get("/query/{query_id}/sources")
async def get_query_sources(query_id: str):
    """Get source citations for a RAG response (placeholder — sources are returned inline)."""
    return {"query_id": query_id, "message": "Sources are included in the /rag/query response directly."}


@router.post("/collections", response_model=RAGCollectionInfo)
async def create_collection(
    body: RAGCollectionCreateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a named collection (e.g., 'DSA', 'DBMS', 'OS') — admin-only."""
    existing = await rag_service.get_collection_by_name(db, body.name)
    if existing:
        raise HTTPException(status_code=409, detail={"code": "conflict", "message": f"Collection '{body.name}' already exists"})

    coll = await rag_service.create_collection(db, body.name, body.description, admin.id)
    return RAGCollectionInfo(
        id=coll.id, name=coll.name, description=coll.description,
        document_count=0, created_at=coll.created_at.isoformat(),
    )


@router.get("/collections", response_model=RAGCollectionsResponse)
async def list_collections(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """List all collections."""
    colls = await rag_service.get_collections(db)
    return RAGCollectionsResponse(
        collections=[RAGCollectionInfo(
            id=c.id, name=c.name, description=c.description,
            document_count=c.document_count, created_at=c.created_at.isoformat(),
        ) for c in colls],
        total=len(colls),
    )
