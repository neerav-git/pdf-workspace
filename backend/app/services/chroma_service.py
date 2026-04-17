import chromadb
from chromadb.config import Settings as ChromaSettings
from app.core.config import settings
from app.services.pdf_service import Chunk

COLLECTION_NAME = "pdf_chunks"

_client = None


def _get_client():
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


def get_similar_chunks(
    pdf_id: int,
    chunk_id: str,
    n: int = 3,
) -> list[dict]:
    """
    Return up to *n* chunks from the same PDF that are most similar to *chunk_id*.

    Strategy:
      1. Fetch the embedding of chunk_id via collection.get().
      2. Query ChromaDB with that embedding, restricted to pdf_id.
      3. Exclude the source chunk itself from results.

    Returns [{chunk_id, chunk_index, page_number, text_preview, distance}] or [].
    """
    collection = _get_collection()

    # Step 1: retrieve the source chunk's embedding
    try:
        got = collection.get(ids=[chunk_id], include=["embeddings"])
        if not got["ids"] or not got["embeddings"]:
            return []
        embedding = got["embeddings"][0]
    except Exception:
        return []

    # Step 2: query similar chunks (request n+1 to have room after self-exclusion)
    try:
        results = collection.query(
            query_embeddings=[embedding],
            n_results=min(n + 1, 10),
            where={"pdf_id": pdf_id},
            include=["documents", "metadatas", "distances"],
        )
    except Exception:
        return []

    hits = []
    for cid, doc, meta, dist in zip(
        results["ids"][0],
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        if cid == chunk_id:          # skip self
            continue
        hits.append({
            "chunk_id": cid,
            "chunk_index": meta.get("chunk_index"),
            "page_number": meta.get("page_number"),
            "text_preview": doc[:200].strip(),
            "distance": round(dist, 4),
        })
        if len(hits) >= n:
            break

    return hits


def resolve_chunk_for_highlight(
    pdf_id: int,
    text_embedding: list[float],
    page_number: int,
) -> dict | None:
    """
    Find the best-matching chunk for a highlighted passage.

    Strategy:
      1. Query ChromaDB for the nearest chunk on the exact page.
      2. If the page filter returns no results (can happen with ChromaDB
         single-result collections), fall back to a PDF-wide query and
         pick the result whose page_number is closest to the target.

    Returns:
      {
        "chunk_id":           str,   e.g. "pdf_1_chunk_42"
        "chunk_index":        int,
        "actual_page":        int,   page the chunk actually lives on
        "section_path_json":  str | None,  present for newly-ingested PDFs
      }
    or None if nothing is found.
    """
    collection = _get_collection()

    # Attempt 1 — page-scoped query
    try:
        results = collection.query(
            query_embeddings=[text_embedding],
            n_results=1,
            where={"$and": [{"pdf_id": pdf_id}, {"page_number": page_number}]},
            include=["metadatas", "distances"],
        )
        if results["ids"][0]:
            meta = results["metadatas"][0][0]
            chunk_idx = meta.get("chunk_index", 0)
            return {
                "chunk_id": f"pdf_{pdf_id}_chunk_{chunk_idx}",
                "chunk_index": chunk_idx,
                "actual_page": meta.get("page_number", page_number),
                "section_path_json": meta.get("section_path_json"),
            }
    except Exception:
        pass

    # Attempt 2 — PDF-wide fallback, pick nearest page
    try:
        results = collection.query(
            query_embeddings=[text_embedding],
            n_results=5,
            where={"pdf_id": pdf_id},
            include=["metadatas", "distances"],
        )
        if not results["ids"][0]:
            return None

        best_meta = min(
            results["metadatas"][0],
            key=lambda m: abs(m.get("page_number", 0) - page_number),
        )
        chunk_idx = best_meta.get("chunk_index", 0)
        return {
            "chunk_id": f"pdf_{pdf_id}_chunk_{chunk_idx}",
            "chunk_index": chunk_idx,
            "actual_page": best_meta.get("page_number", page_number),
            "section_path_json": best_meta.get("section_path_json"),
        }
    except Exception:
        return None
