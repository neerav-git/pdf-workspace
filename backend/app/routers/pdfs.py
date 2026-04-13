import uuid
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.session import get_db
from app.models.pdf import PDFDocument
from app.services import s3_service, pdf_service, embedding_service, chroma_service

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


@router.delete("/{pdf_id}", status_code=204)
def delete_pdf(pdf_id: int, db: Session = Depends(get_db)):
    doc = db.get(PDFDocument, pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")
    chroma_service.delete_pdf_chunks(pdf_id)
    db.delete(doc)
    db.commit()
