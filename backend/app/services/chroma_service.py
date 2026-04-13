import chromadb
from chromadb.config import Settings as ChromaSettings
from app.core.config import settings
from app.services.pdf_service import Chunk

COLLECTION_NAME = "pdf_chunks"

_client: chromadb.HttpClient | None = None


def _get_client() -> chromadb.HttpClient:
    global _client
    if _client is None:
        _client = chromadb.HttpClient(
            host=settings.CHROMA_HOST,
            port=settings.CHROMA_PORT,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
    return _client


def _get_collection():
    client = _get_client()
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def upsert_chunks(pdf_id: int, chunks: list[Chunk], embeddings: list[list[float]]) -> None:
    """Store all chunks for a PDF in ChromaDB."""
    collection = _get_collection()
    ids = [f"pdf_{pdf_id}_chunk_{c.chunk_index}" for c in chunks]
    metadatas = [
        {"pdf_id": pdf_id, "page_number": c.page_number, "chunk_index": c.chunk_index}
        for c in chunks
    ]
    documents = [c.text for c in chunks]
    collection.upsert(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)


def query_chunks(
    pdf_id: int,
    query_embedding: list[float],
    n_results: int = 5,
) -> list[dict]:
    """
    Return top-n chunks for a PDF ordered by cosine similarity.
    Each result: {text, page_number, chunk_index, distance}
    """
    collection = _get_collection()
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=n_results,
        where={"pdf_id": pdf_id},
        include=["documents", "metadatas", "distances"],
    )
    hits = []
    for doc, meta, dist in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        hits.append(
            {
                "text": doc,
                "page_number": meta.get("page_number"),
                "chunk_index": meta.get("chunk_index"),
                "distance": dist,
            }
        )
    return hits


def delete_pdf_chunks(pdf_id: int) -> None:
    collection = _get_collection()
    collection.delete(where={"pdf_id": pdf_id})
