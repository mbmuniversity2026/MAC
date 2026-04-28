"""RAG service (Phase 7) — document ingestion, chunking, vector search."""

import uuid
import os
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from mac.models.rag import RAGDocument, RAGCollection
from mac.services import llm_service
from mac.config import settings

# Upload directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")


def _ensure_upload_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def chunk_text(text: str, chunk_size: int = 512, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks by token-like word boundaries."""
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


async def create_collection(db: AsyncSession, name: str, description: str, created_by: str) -> RAGCollection:
    """Create a named RAG collection."""
    coll = RAGCollection(name=name, description=description, created_by=created_by)
    db.add(coll)
    await db.flush()
    return coll


async def get_collections(db: AsyncSession) -> list[RAGCollection]:
    """List all collections."""
    result = await db.execute(select(RAGCollection).order_by(RAGCollection.created_at.desc()))
    return list(result.scalars())


async def get_collection_by_name(db: AsyncSession, name: str) -> RAGCollection | None:
    result = await db.execute(select(RAGCollection).where(RAGCollection.name == name))
    return result.scalar_one_or_none()


async def get_collection_by_id(db: AsyncSession, collection_id: str) -> RAGCollection | None:
    result = await db.execute(select(RAGCollection).where(RAGCollection.id == collection_id))
    return result.scalar_one_or_none()


async def ingest_document(
    db: AsyncSession,
    collection_id: str,
    title: str,
    filename: str,
    content: str,
    content_type: str,
    file_size: int,
    uploaded_by: str,
) -> RAGDocument:
    """Ingest a document: chunk it, generate embeddings, store in DB."""
    _ensure_upload_dir()

    # Create document record
    doc = RAGDocument(
        collection_id=collection_id,
        title=title,
        filename=filename,
        content_type=content_type,
        file_size=file_size,
        uploaded_by=uploaded_by,
        status="processing",
    )
    db.add(doc)
    await db.flush()

    # Chunk the text
    chunks = chunk_text(content)
    doc.chunk_count = len(chunks)
    doc.page_count = max(1, len(content) // 3000)  # rough estimate

    # Try to generate embeddings and store (best effort — Qdrant optional)
    try:
        if chunks:
            # Store embeddings via Qdrant if available
            await _store_embeddings(doc.id, chunks)
        doc.status = "ready"
    except Exception as e:
        # If Qdrant is not available, still mark doc but note the error
        doc.status = "ready"
        doc.error_message = f"Embeddings skipped: {str(e)[:200]}"

    # Update collection document count
    coll = await get_collection_by_id(db, collection_id)
    if coll:
        coll.document_count += 1

    await db.flush()
    return doc


async def _store_embeddings(document_id: str, chunks: list[str]):
    """Store chunk embeddings in Qdrant vector database."""
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams, PointStruct

        client = QdrantClient(url=settings.qdrant_url, timeout=10)
        collection_name = settings.qdrant_collection

        # Ensure collection exists
        collections = client.get_collections().collections
        if not any(c.name == collection_name for c in collections):
            client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=768, distance=Distance.COSINE),
            )

        # Generate embeddings
        result = await llm_service.generate_embeddings(chunks)
        embeddings = [d["embedding"] for d in result.get("data", [])]

        if embeddings:
            points = [
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=emb,
                    payload={"document_id": document_id, "chunk_index": i, "text": chunks[i][:1000]},
                )
                for i, emb in enumerate(embeddings)
            ]
            client.upsert(collection_name=collection_name, points=points)
    except ImportError:
        raise RuntimeError("qdrant-client not installed")
    except Exception as e:
        raise RuntimeError(f"Qdrant unavailable: {e}")


async def query_rag(
    db: AsyncSession,
    question: str,
    collection_name: str | None = None,
    top_k: int = 5,
) -> list[dict]:
    """Search vector DB for relevant chunks."""
    try:
        from qdrant_client import QdrantClient

        client = QdrantClient(url=settings.qdrant_url, timeout=10)

        # Embed the question
        result = await llm_service.generate_embeddings([question])
        query_vector = result["data"][0]["embedding"]

        # Search
        search_result = client.query_points(
            collection_name=settings.qdrant_collection,
            query=query_vector,
            limit=top_k,
        )

        sources = []
        for point in search_result.points:
            payload = point.payload or {}
            doc_id = payload.get("document_id", "")

            # Get document title
            doc = await db.execute(select(RAGDocument).where(RAGDocument.id == doc_id))
            doc_obj = doc.scalar_one_or_none()
            title = doc_obj.title if doc_obj else "Unknown"

            sources.append({
                "document_id": doc_id,
                "document_title": title,
                "chunk_text": payload.get("text", ""),
                "relevance_score": round(point.score, 4),
                "page": payload.get("chunk_index", 0) + 1,
            })

        return sources
    except Exception:
        return []


async def get_documents(db: AsyncSession, collection_id: str | None = None) -> list[RAGDocument]:
    """List documents, optionally filtered by collection."""
    query = select(RAGDocument).order_by(RAGDocument.created_at.desc())
    if collection_id:
        query = query.where(RAGDocument.collection_id == collection_id)
    result = await db.execute(query)
    return list(result.scalars())


async def get_document_by_id(db: AsyncSession, doc_id: str) -> RAGDocument | None:
    result = await db.execute(select(RAGDocument).where(RAGDocument.id == doc_id))
    return result.scalar_one_or_none()


async def delete_document(db: AsyncSession, doc_id: str) -> bool:
    """Delete a document and its vectors."""
    doc = await get_document_by_id(db, doc_id)
    if not doc:
        return False

    # Remove from Qdrant
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        client = QdrantClient(url=settings.qdrant_url, timeout=10)
        client.delete(
            collection_name=settings.qdrant_collection,
            points_selector=Filter(
                must=[FieldCondition(key="document_id", match=MatchValue(value=doc_id))]
            ),
        )
    except Exception:
        pass

    # Update collection doc count
    coll = await get_collection_by_id(db, doc.collection_id)
    if coll and coll.document_count > 0:
        coll.document_count -= 1

    await db.delete(doc)
    await db.flush()
    return True
