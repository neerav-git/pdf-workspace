"""
PDF CRUD + TOC endpoint tests.

Relies on the `uploaded_pdf_id` session fixture in conftest.py which:
  1. Uploads a minimal test PDF before the session starts
  2. Deletes it after all tests finish
"""

import pytest


# ── List ──────────────────────────────────────────────────────────────────────

def test_list_pdfs_returns_list(client):
    """GET /api/pdfs must return a JSON array."""
    resp = client.get("/api/pdfs")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_list_pdfs_schema(client, uploaded_pdf_id):
    """Every item in the list must have the expected fields."""
    resp = client.get("/api/pdfs")
    items = resp.json()
    assert len(items) > 0, "Expected at least one PDF (the test upload)"
    for item in items:
        for field in ("id", "title", "s3_key", "page_count", "chunk_count"):
            assert field in item, f"Missing field '{field}' in PDF list item"


# ── Upload ────────────────────────────────────────────────────────────────────

def test_upload_returns_201(uploaded_pdf_id):
    """Upload fixture must have created a record (id is an int > 0)."""
    assert isinstance(uploaded_pdf_id, int)
    assert uploaded_pdf_id > 0


def test_upload_wrong_content_type(client):
    """Uploading a non-PDF must return 400."""
    resp = client.post(
        "/api/pdfs/upload",
        files={"file": ("not_a_pdf.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400


def test_uploaded_pdf_appears_in_list(client, uploaded_pdf_id):
    """The test PDF must appear in the list after upload."""
    resp = client.get("/api/pdfs")
    ids = [item["id"] for item in resp.json()]
    assert uploaded_pdf_id in ids, f"PDF id {uploaded_pdf_id} not found in list"


# ── URL / stream ──────────────────────────────────────────────────────────────

def test_get_pdf_url(client, uploaded_pdf_id):
    """GET /api/pdfs/{id}/url must return a presigned URL string."""
    resp = client.get(f"/api/pdfs/{uploaded_pdf_id}/url")
    assert resp.status_code == 200
    body = resp.json()
    assert "url" in body
    assert body["url"].startswith("https://"), f"Expected https URL, got: {body['url']}"


def test_get_pdf_url_not_found(client):
    """Non-existent PDF id must return 404."""
    resp = client.get("/api/pdfs/999999/url")
    assert resp.status_code == 404


def test_stream_pdf(client, uploaded_pdf_id):
    """GET /api/pdfs/{id}/file must return PDF bytes (content-type: application/pdf)."""
    resp = client.get(f"/api/pdfs/{uploaded_pdf_id}/file")
    assert resp.status_code == 200
    assert "application/pdf" in resp.headers.get("content-type", "")
    assert len(resp.content) > 100, "PDF stream looks too short"


# ── TOC ───────────────────────────────────────────────────────────────────────

def test_toc_returns_valid_shape(client, uploaded_pdf_id):
    """GET /api/pdfs/{id}/toc must return {items, generated, mode}."""
    resp = client.get(f"/api/pdfs/{uploaded_pdf_id}/toc")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body, "TOC response missing 'items'"
    assert "generated" in body, "TOC response missing 'generated'"
    assert "mode" in body, "TOC response missing 'mode'"
    assert isinstance(body["items"], list)


def test_toc_debug_returns_stats(client, uploaded_pdf_id):
    """GET /api/pdfs/{id}/toc/debug must return font size stats."""
    resp = client.get(f"/api/pdfs/{uploaded_pdf_id}/toc/debug")
    assert resp.status_code == 200
    body = resp.json()
    assert "source" in body


def test_toc_not_found(client):
    """TOC for non-existent PDF must return 404."""
    resp = client.get("/api/pdfs/999999/toc")
    assert resp.status_code == 404


# ── Delete (run last) ─────────────────────────────────────────────────────────

def test_delete_nonexistent(client):
    """Deleting a non-existent PDF must return 404."""
    resp = client.delete("/api/pdfs/999999")
    assert resp.status_code == 404
