import httpx
from anthropic import Anthropic
from app.core.config import settings
from app.services.embedding_service import embed
from app.services.chroma_service import query_chunks

# Cosine distance above this threshold = chunks not relevant enough → web search
RELEVANCE_THRESHOLD = 0.75
CLAUDE_MODEL = "claude-sonnet-4-20250514"

_anthropic: Anthropic | None = None


def _get_anthropic() -> Anthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic


async def _tavily_search(query: str) -> list[dict]:
    """Search the web with Tavily and return result snippets."""
    if not settings.TAVILY_API_KEY:
        return []
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={"api_key": settings.TAVILY_API_KEY, "query": query, "max_results": 5},
        )
        resp.raise_for_status()
        return resp.json().get("results", [])


async def chat(
    pdf_id: int,
    message: str,
    history: list[dict],
) -> dict:
    """
    RAG chat against a single PDF.

    Returns:
        answer: str
        sources: list of {page_number, chunk_index, distance}
        web_search_triggered: bool
        web_results: list[dict] | None
    """
    # 1. Embed the user query
    query_embedding = embed([message])[0]

    # 2. Retrieve top-5 chunks from ChromaDB
    hits = query_chunks(pdf_id=pdf_id, query_embedding=query_embedding, n_results=5)

    # 3. Decide whether the retrieved chunks are relevant
    web_search_triggered = False
    web_results: list[dict] | None = None

    if not hits or all(h["distance"] > RELEVANCE_THRESHOLD for h in hits):
        web_search_triggered = True
        web_results = await _tavily_search(message)
        context = _format_web_context(web_results)
        system_prompt = (
            "You are a helpful research assistant. The PDF document did not contain "
            "relevant information for this question, so the context below comes from a "
            "live web search. Answer using only the provided web context. "
            "Cite sources where possible.\n\n"
            f"Web search results:\n{context}"
        )
    else:
        context = _format_chunk_context(hits)
        system_prompt = (
            "You are a helpful assistant that answers questions strictly based on the "
            "provided PDF document excerpts. Do not speculate beyond the given context. "
            "When relevant, mention the page number your answer is drawn from.\n\n"
            f"Document excerpts:\n{context}"
        )

    # 4. Build message list (convert history + new message)
    messages = [
        {"role": h["role"], "content": h["content"]}
        for h in history
        if h.get("role") in ("user", "assistant")
    ]
    messages.append({"role": "user", "content": message})

    # 5. Call Claude
    client = _get_anthropic()
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=messages,
    )

    return {
        "answer": response.content[0].text,
        "sources": [
            {
                "page_number": h["page_number"],
                "chunk_index": h["chunk_index"],
                "distance": round(h["distance"], 4),
            }
            for h in hits
        ],
        "web_search_triggered": web_search_triggered,
        "web_results": web_results,
    }


# ── helpers ──────────────────────────────────────────────────────────────────

def _format_chunk_context(hits: list[dict]) -> str:
    parts = []
    for i, h in enumerate(hits, 1):
        parts.append(f"[Excerpt {i} — Page {h['page_number']}]\n{h['text']}")
    return "\n\n".join(parts)


def _format_web_context(results: list[dict]) -> str:
    parts = []
    for i, r in enumerate(results, 1):
        title = r.get("title", "")
        url = r.get("url", "")
        content = r.get("content", "")
        parts.append(f"[Result {i}] {title}\n{url}\n{content}")
    return "\n\n".join(parts)
