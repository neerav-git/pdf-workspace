from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.highlight import HighlightEntry, QAPair
from app.models.pdf import PDFDocument

router = APIRouter(tags=["highlights"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class QAPairResponse(BaseModel):
    id: int
    highlight_id: int
    question: str
    answer: str
    source_chunk_ids: list
    selection_text: Optional[str]
    starred: bool
    stability: float
    difficulty: float
    reps: int
    lapses: int
    state: str
    due_at: Any
    last_review: Optional[Any]
    created_at: Any

    model_config = {"from_attributes": True}


class HighlightResponse(BaseModel):
    id: int
    pdf_id: int
    page_number: Optional[int]
    highlight_text: str
    highlight_texts: list
    chunk_id: Optional[str]
    section_title: Optional[str]
    section_path: list
    deep_section_path: Optional[list]
    concepts: list
    note: str
    synthesis: Optional[str]
    starred: bool
    flagged: bool
    anchored: bool
    reviewed: bool
    created_at: Any
    qa_pairs: list[QAPairResponse] = []

    model_config = {"from_attributes": True}


class HighlightCreate(BaseModel):
    page_number: Optional[int] = None
    highlight_text: str
    highlight_texts: list = []
    chunk_id: Optional[str] = None
    section_title: Optional[str] = None
    section_path: list = []
    deep_section_path: Optional[list] = None
    concepts: list = []
    note: str = ""


class HighlightPatch(BaseModel):
    note: Optional[str] = None
    synthesis: Optional[str] = None
    starred: Optional[bool] = None
    flagged: Optional[bool] = None
    anchored: Optional[bool] = None
    reviewed: Optional[bool] = None
    concepts: Optional[list] = None
    highlight_texts: Optional[list] = None   # updated when new selections are merged into same chunk
    highlight_text: Optional[str] = None     # primary selection text; updatable for sentence autocomplete


class QAPairCreate(BaseModel):
    question: str
    answer: str
    source_chunk_ids: list = []
    selection_text: Optional[str] = None


class QAPairPatch(BaseModel):
    starred: Optional[bool] = None
    selection_text: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_pdf_or_404(pdf_id: int, db: Session) -> PDFDocument:
    pdf = db.get(PDFDocument, pdf_id)
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    return pdf


def _get_highlight_or_404(highlight_id: int, db: Session) -> HighlightEntry:
    entry = db.get(HighlightEntry, highlight_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return entry


def _get_qa_or_404(qa_id: int, db: Session) -> QAPair:
    qa = db.get(QAPair, qa_id)
    if not qa:
        raise HTTPException(status_code=404, detail="Q&A pair not found")
    return qa


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/api/pdfs/{pdf_id}/highlights", response_model=list[HighlightResponse])
def list_highlights(pdf_id: int, db: Session = Depends(get_db)):
    """Load all highlight entries for a PDF (with nested Q&A pairs). Called on PDF open."""
    _get_pdf_or_404(pdf_id, db)
    entries = (
        db.query(HighlightEntry)
        .filter(HighlightEntry.pdf_id == pdf_id)
        .order_by(HighlightEntry.created_at.desc())
        .all()
    )
    return entries


@router.post("/api/pdfs/{pdf_id}/highlights", response_model=HighlightResponse, status_code=201)
def create_highlight(pdf_id: int, body: HighlightCreate, db: Session = Depends(get_db)):
    """Save a new highlight entry. Returns the row with its DB-assigned integer id."""
    _get_pdf_or_404(pdf_id, db)
    entry = HighlightEntry(pdf_id=pdf_id, **body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/api/highlights/{highlight_id}", response_model=HighlightResponse)
def patch_highlight(highlight_id: int, body: HighlightPatch, db: Session = Depends(get_db)):
    """Update mutable fields: note, synthesis, starred, flagged, anchored, reviewed, concepts."""
    entry = _get_highlight_or_404(highlight_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/api/highlights/{highlight_id}", status_code=204)
def delete_highlight(highlight_id: int, db: Session = Depends(get_db)):
    """Delete highlight entry and cascade-delete all its Q&A pairs."""
    entry = _get_highlight_or_404(highlight_id, db)
    db.delete(entry)
    db.commit()


@router.post("/api/highlights/{highlight_id}/qa", response_model=QAPairResponse, status_code=201)
def create_qa_pair(highlight_id: int, body: QAPairCreate, db: Session = Depends(get_db)):
    """
    Add a Q&A pair to a highlight entry.
    Automatically initializes FSRS card state (new, due immediately).
    FSRS state is inline on qa_pairs — no separate memory_items table (Research B1).
    """
    _get_highlight_or_404(highlight_id, db)
    qa = QAPair(highlight_id=highlight_id, **body.model_dump())
    db.add(qa)
    db.commit()
    db.refresh(qa)
    return qa


@router.patch("/api/qa/{qa_id}", response_model=QAPairResponse)
def patch_qa_pair(qa_id: int, body: QAPairPatch, db: Session = Depends(get_db)):
    """Toggle starred on a Q&A pair."""
    qa = _get_qa_or_404(qa_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(qa, field, value)
    db.commit()
    db.refresh(qa)
    return qa


@router.delete("/api/qa/{qa_id}", status_code=204)
def delete_qa_pair(qa_id: int, db: Session = Depends(get_db)):
    """Delete a single Q&A pair."""
    qa = _get_qa_or_404(qa_id, db)
    db.delete(qa)
    db.commit()
