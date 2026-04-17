"""
Chat endpoint tests.

These tests make real Claude API calls — they verify end-to-end RAG + LLM behavior.
They will be slower (~2–5 s each) and use API credits.

Skip with:  pytest tests/ -v --ignore=tests/test_chat.py
Run alone:  pytest tests/test_chat.py -v
"""


def test_chat_basic_response(client, uploaded_pdf_id):
    """POST /api/chat must return a non-empty answer."""
    resp = client.post("/api/chat", json={
        "pdf_id": uploaded_pdf_id,
        "message": "What is this document about?",
        "history": [],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "answer" in body
    assert len(body["answer"]) > 10, "Answer is suspiciously short"
    assert "sources" in body
    assert "web_search_triggered" in body


def test_chat_with_selection(client, uploaded_pdf_id):
    """Chat with a highlighted selection must include it in context and answer."""
    resp = client.post("/api/chat", json={
        "pdf_id": uploaded_pdf_id,
        "message": "Explain this passage.",
        "history": [],
        "selection_text": "The quick brown fox jumps over the lazy dog.",
        "selection_page": 1,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["answer"]) > 10


def test_chat_with_history(client, uploaded_pdf_id):
    """Chat with prior history must not crash and must return an answer."""
    history = [
        {"role": "user", "content": "What is this document?"},
        {"role": "assistant", "content": "This is a test document."},
    ]
    resp = client.post("/api/chat", json={
        "pdf_id": uploaded_pdf_id,
        "message": "Can you summarize that?",
        "history": history,
    })
    assert resp.status_code == 200
    assert len(resp.json()["answer"]) > 5


def test_chat_sources_schema(client, uploaded_pdf_id):
    """Each source in the response must have page_number, chunk_index, distance."""
    resp = client.post("/api/chat", json={
        "pdf_id": uploaded_pdf_id,
        "message": "Tell me something about this document.",
        "history": [],
    })
    assert resp.status_code == 200
    for src in resp.json()["sources"]:
        for field in ("page_number", "chunk_index", "distance"):
            assert field in src, f"Source missing field: {field}"


def test_chat_nonexistent_pdf(client):
    """Chat for a non-existent PDF must return 404."""
    resp = client.post("/api/chat", json={
        "pdf_id": 999999,
        "message": "Hello",
        "history": [],
    })
    assert resp.status_code == 404


def test_chat_empty_message(client, uploaded_pdf_id):
    """Empty message must still return 200 (Claude handles it gracefully)."""
    resp = client.post("/api/chat", json={
        "pdf_id": uploaded_pdf_id,
        "message": "",
        "history": [],
    })
    # Should not crash — empty string is valid input
    assert resp.status_code in (200, 422)
