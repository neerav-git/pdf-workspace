"""
Test configuration for pdf-workspace backend.

Tests run against the live server on localhost:8000.
Start it first:  ./start.sh  (or just the backend)

Usage:
    cd backend
    conda activate pdf-workspace
    pip install pytest pytest-asyncio httpx
    pytest tests/ -v
"""

import io
import pytest
import httpx

BASE_URL = "http://localhost:8000"


@pytest.fixture(scope="session")
def client():
    """Synchronous httpx client wired to the running backend."""
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        yield c


def make_minimal_pdf() -> bytes:
    """
    Return bytes for a one-page PDF containing the text 'Hello World'.
    Uses PyMuPDF (already installed) so we don't need reportlab.
    """
    import fitz  # PyMuPDF
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4
    page.insert_text((72, 100), "Hello World — pdf-workspace test document")
    page.insert_text((72, 130), "This is a test page used by the automated test suite.")
    page.insert_text((72, 160), "Section: Introduction")
    page.insert_text((72, 200), "The quick brown fox jumps over the lazy dog.")
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture(scope="session")
def uploaded_pdf_id(client):
    """
    Upload a minimal test PDF once per test session; delete it afterward.
    Returns the integer PDF id for use in other tests.
    """
    pdf_bytes = make_minimal_pdf()
    resp = client.post(
        "/api/pdfs/upload",
        files={"file": ("test_document.pdf", pdf_bytes, "application/pdf")},
    )
    assert resp.status_code == 201, f"Upload failed: {resp.text}"
    pdf_id = resp.json()["id"]
    yield pdf_id
    # Teardown — delete after all tests finish
    client.delete(f"/api/pdfs/{pdf_id}")
