import json
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.session import get_db
from app.models.pdf import PDFDocument
from app.services import s3_service, pdf_service, embedding_service, chroma_service, toc_service

router = APIRouter(prefix="/api/pdfs", tags=["pdfs"])


# ── response schemas ──────────────────────────────────────────────────────────

class PDFResponse(BaseModel):
    id: int
    title: str
    s3_key: str
    page_count: int
    chunk_count: int

    model_config = {"from_attributes": True}


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=PDFResponse, status_code=201)
async def upload_pdf(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = await file.read()
    original_name = file.filename or "document.pdf"

    # 1. Extract text and page count
    pages = pdf_service.extract_pages(pdf_bytes)
    page_count = pdf_service.get_page_count(pdf_bytes)

    if not pages:
        raise HTTPException(status_code=422, detail="Could not extract text from PDF.")

    # 2. Chunk
    chunks = pdf_service.chunk_pages(pages)

    # 3. Embed
    embeddings = embedding_service.embed([c.text for c in chunks])

    # 4. Upload to S3
    s3_key = f"pdfs/{uuid.uuid4()}/{original_name}"
    s3_service.upload_file(pdf_bytes, s3_key)

    # 5. Persist metadata to Postgres
    doc = PDFDocument(
        title=original_name.removesuffix(".pdf"),
        s3_key=s3_key,
        page_count=page_count,
        chunk_count=len(chunks),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # 6. Store chunks in ChromaDB (after we have the DB id)
    chroma_service.upsert_chunks(doc.id, chunks, embeddings)

    return doc


@router.get("", response_model=list[PDFResponse])
def list_pdfs(db: Session = Depends(get_db)):
    return db.query(PDFDocument).order_by(PDFDocument.created_at.desc()).all()


@router.get("/{pdf_id}/url")
def get_pdf_url(pdf_id: int, db: Session = Depends(get_db)):
    doc = db.get(PDFDocument, pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")
    url = s3_service.get_presigned_url(doc.s3_key)
    return {"url": url}


@router.get("/{pdf_id}/file")
def stream_pdf(pdf_id: int, db: Session = Depends(get_db)):
    """Proxy the PDF from S3 — avoids CORS issues in the browser."""
    doc = db.get(PDFDocument, pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")
    pdf_bytes = s3_service.get_file_bytes(doc.s3_key)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{doc.title}.pdf"'},
    )


@router.get("/{pdf_id}/toc")
def get_toc(pdf_id: int, db: Session = Depends(get_db)):
    """Return the table of contents for a PDF (from outline or font-size heuristics)."""
    doc = db.get(PDFDocument, pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")
    pdf_bytes = s3_service.get_file_bytes(doc.s3_key)
    return toc_service.get_toc(pdf_bytes)


@router.get("/{pdf_id}/toc/debug")
def debug_toc(pdf_id: int, db: Session = Depends(get_db)):
    """
    Debug endpoint — paste the JSON response to Claude when the generated ToC looks wrong.
    Shows: font-size statistics, threshold, total candidates found, first/last 10 items.
    """
    import statistics
    import fitz

    doc_meta = db.get(PDFDocument, pdf_id)
    if not doc_meta:
        raise HTTPException(status_code=404, detail="PDF not found.")

    pdf_bytes = s3_service.get_file_bytes(doc_meta.s3_key)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # Check for native outline first
    outline = doc.get_toc(simple=True)
    if outline:
        doc.close()
        return {
            "source": "native_outline",
            "item_count": len(outline),
            "first_5": outline[:5],
            "last_5": outline[-5:],
        }

    # Font size pass
    all_sizes = []
    for i in range(len(doc)):
        for block in doc[i].get_text("dict", flags=0)["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    sz = span.get("size", 0)
                    if sz > 0:
                        all_sizes.append(sz)

    body_median = statistics.median(all_sizes) if all_sizes else 0
    h1_threshold = body_median * 1.6

    # Collect candidates (same logic as toc_service but no dedup)
    candidates = []
    for i in range(len(doc)):
        page_num = i + 1
        for block in doc[i].get_text("dict", flags=0)["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                line_text = "".join(s["text"] for s in line["spans"])
                max_sz = max((s.get("size", 0) for s in line["spans"]), default=0)
                if max_sz >= h1_threshold:
                    text = line_text.strip()
                    if text and len(text) <= 100:
                        candidates.append({"page": page_num, "text": text[:80], "size": round(max_sz, 1)})

    doc.close()

    unique_titles = len({c["text"] for c in candidates})
    return {
        "source": "font_heuristic",
        "total_pages": doc_meta.page_count,
        "font_size_stats": {
            "median": round(body_median, 2),
            "h1_threshold": round(h1_threshold, 2),
            "min": round(min(all_sizes), 2) if all_sizes else 0,
            "max": round(max(all_sizes), 2) if all_sizes else 0,
        },
        "candidates_found": len(candidates),
        "unique_titles": unique_titles,
        "first_10": candidates[:10],
        "last_10": candidates[-10:],
    }


class ResolveChunkRequest(BaseModel):
    highlight_text: str
    page_number: int


@router.post("/{pdf_id}/resolve-chunk")
async def resolve_chunk(pdf_id: int, req: ResolveChunkRequest, db: Session = Depends(get_db)):
    """
    Given a highlighted passage and its page number, return:
      - chunk_id:      the stable ChromaDB chunk identifier
      - chunk_index:   integer index within the PDF's chunk sequence
      - section_path:  deep heading path [{level, title}, …] root→leaf

    The section_path combines:
      • Per-chunk metadata when available (newly-ingested PDFs)
      • On-the-fly font analysis when metadata is absent (older PDFs)

    This endpoint is called at index-save time to anchor a highlight to its
    canonical position in the document's structural hierarchy.
    """
    doc_meta = db.get(PDFDocument, pdf_id)
    if not doc_meta:
        raise HTTPException(status_code=404, detail="PDF not found.")

    # 1. Embed the highlight text for nearest-chunk lookup
    embedding = embedding_service.embed([req.highlight_text])[0]

    # 2. Find best-matching chunk
    chunk_info = chroma_service.resolve_chunk_for_highlight(
        pdf_id=pdf_id,
        text_embedding=embedding,
        page_number=req.page_number,
    )

    if chunk_info is None:
        return {"chunk_id": None, "chunk_index": None, "section_path": []}

    # 3. Resolve section path
    section_path: list[dict] = []

    if chunk_info.get("section_path_json"):
        # Fast path: path was stored at ingest time
        try:
            section_path = json.loads(chunk_info["section_path_json"])
        except (json.JSONDecodeError, TypeError):
            pass

    if not section_path:
        # Slow path: compute from PDF bytes (works for any PDF regardless of
        # whether it was ingested before this feature was added)
        pdf_bytes = s3_service.get_file_bytes(doc_meta.s3_key)
        section_path = toc_service.get_page_heading_path(
            pdf_bytes=pdf_bytes,
            target_page=req.page_number,
            anchor_text=req.highlight_text,
        )

    # 4. Fetch the chunk text for sentence autocomplete on the frontend.
    # The frontend uses this to extend a partial selection to the nearest sentence boundary.
    chunk_text = None
    try:
        result = chroma_service._get_collection().get(
            ids=[chunk_info["chunk_id"]], include=["documents"]
        )
        docs = result.get("documents", [])
        if docs:
            chunk_text = docs[0]
    except Exception:
        pass  # non-fatal — autocomplete just won't run

    return {
        "chunk_id": chunk_info["chunk_id"],
        "chunk_index": chunk_info["chunk_index"],
        "section_path": section_path,
        "chunk_text": chunk_text,
    }


@router.get("/{pdf_id}/related-chunks")
def related_chunks(
    pdf_id: int,
    chunk_id: str,
    n: int = 3,
    db: Session = Depends(get_db),
):
    """
    Return up to *n* chunks from the same PDF most similar to *chunk_id*.
    Used by the frontend to surface related passages in the Highlight Index.
    """
    doc = db.get(PDFDocument, pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")
    return {"related": chroma_service.get_similar_chunks(pdf_id, chunk_id, n)}


@router.delete("/{pdf_id}", status_code=204)
def delete_pdf(pdf_id: int, db: Session = Depends(get_db)):
    doc = db.get(PDFDocument, pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")
    chroma_service.delete_pdf_chunks(pdf_id)
    db.delete(doc)
    db.commit()
