from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.highlight import HighlightEntry, QAPair
from app.models.pdf import PDFDocument
from app.models.review import SessionEvent
from app.services.card_service import (
    VALID_CARD_TYPES,
    DuplicateStudyQuestion,
    ExtractionFailed,
    create_card,
)
from app.services.ontology_service import refresh_highlight_learning_metadata

router = APIRouter(tags=["highlights"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class QAPairResponse(BaseModel):
    id: int
    highlight_id: int
    card_type: str
    question: str
    original_question: Optional[str]
    study_question: Optional[str]
    answer: str
    source_chunk_ids: list
    selection_text: Optional[str]
    starred: bool
    rhetorical_facet: Optional[str]
    facet_confidence: Optional[float]
    topic_tags: list = []
    origin_chat_message_id: Optional[int]
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
    cluster_tag: Optional[str]
    note: str
    synthesis: Optional[str]
    deep_synthesis: Optional[str]
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
    deep_synthesis: Optional[str] = None
    starred: Optional[bool] = None
    flagged: Optional[bool] = None
    anchored: Optional[bool] = None
    reviewed: Optional[bool] = None
    concepts: Optional[list] = None
    highlight_texts: Optional[list] = None   # updated when new selections are merged into same chunk
    highlight_text: Optional[str] = None     # primary selection text; updatable for sentence autocomplete


class QAPairCreate(BaseModel):
    # card_type is required — callers (SelectionMenu, chat log, manual Q&A)
    # must declare intent so the server can canonicalize study_question.
    card_type: str
    question: str
    original_question: Optional[str] = None
    answer: str
    source_chunk_ids: list = []
    selection_text: Optional[str] = None
    origin_chat_message_id: Optional[int] = None


class QAPairPatch(BaseModel):
    starred: Optional[bool] = None
    selection_text: Optional[str] = None


class QAPairMergeRequest(BaseModel):
    """Append-merge: preserve the existing card but fold an additional answer
    into it so the user doesn't lose the second round of context."""
    appended_answer: str
    appended_from_qa_question: Optional[str] = None


class DedupChoiceRequest(BaseModel):
    """Research-export payload for which branch the user picked on a 409."""
    pdf_id: Optional[int] = None
    highlight_id: int
    choice: str   # "open_existing" | "merge" | "force_save" | "dismiss"
    existing_qa_id: Optional[int] = None
    similarity: Optional[float] = None
    attempted_study_question: Optional[str] = None
    card_type: Optional[str] = None


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
    """Load all highlight entries for a PDF (with nested Q&A pairs). Called on PDF open.

    Archived (soft-deleted) QA pairs are filtered out before serialization so the
    index / review UI never surface tombstoned rows — see deep-fix step 2.
    """
    _get_pdf_or_404(pdf_id, db)
    entries = (
        db.query(HighlightEntry)
        .filter(HighlightEntry.pdf_id == pdf_id)
        .order_by(HighlightEntry.created_at.desc())
        .all()
    )
    for e in entries:
        e.qa_pairs = [q for q in e.qa_pairs if q.archived_at is None]
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
    touched_structure = False
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(entry, field, value)
        if field in {"section_title", "section_path", "deep_section_path"}:
            touched_structure = True
    if touched_structure:
        db.flush()
        refresh_highlight_learning_metadata(db, entry.id)
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
def create_qa_pair(
    highlight_id: int,
    body: QAPairCreate,
    force: bool = Query(False, description="Skip dedup check; save even if a near-duplicate exists."),
    db: Session = Depends(get_db),
):
    """
    Add a Q&A pair to a highlight entry.
    Automatically initializes FSRS card state (new, due immediately).
    FSRS state is inline on qa_pairs — no separate memory_items table (Research B1).

    All creation flows route through ``card_service.create_card`` so that
    study_question canonicalization + dedup happen in exactly one place
    (deep-fix steps 1 + 2).

    Returns:
      201 with QAPairResponse on success.
      409 Conflict when a near-duplicate study_question already exists on
          this highlight; body = {existing_qa_id, existing_study_question,
          similarity}. Caller can retry with ?force=true to override.
      422 when card_type is invalid, or when Haiku rewrite failed for an
          action-type card (would have silently fallen back to a generic
          template — we reject rather than store low-signal cards).
    """
    _get_highlight_or_404(highlight_id, db)
    if body.card_type not in VALID_CARD_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid card_type: {body.card_type!r}. Must be one of {sorted(VALID_CARD_TYPES)}",
        )
    try:
        qa = create_card(
            db,
            highlight_id=highlight_id,
            card_type=body.card_type,
            question=body.question,
            answer=body.answer,
            original_question=body.original_question,
            source_chunk_ids=body.source_chunk_ids,
            selection_text=body.selection_text,
            origin_chat_message_id=body.origin_chat_message_id,
            force=force,
        )
    except DuplicateStudyQuestion as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_study_question",
                "existing_qa_id": exc.existing_qa_id,
                "existing_study_question": exc.existing_study_question,
                "similarity": round(exc.similarity, 4),
            },
        )
    except ExtractionFailed as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "study_question_extraction_failed",
                "card_type": exc.card_type,
                "message": exc.detail,
            },
        )
    return qa


@router.post("/api/qa/{qa_id}/merge-answer", response_model=QAPairResponse)
def merge_answer_into_qa(
    qa_id: int,
    body: QAPairMergeRequest,
    db: Session = Depends(get_db),
):
    """Append an additional answer onto an existing QA — the "Merge this
    answer into existing" branch of the dedup modal. Preserves the existing
    card's FSRS state and review_log history."""
    qa = _get_qa_or_404(qa_id, db)
    if qa.archived_at is not None:
        raise HTTPException(status_code=410, detail="Q&A pair has been archived")
    sep = "\n\n---\n_Merged from duplicate attempt"
    if body.appended_from_qa_question:
        sep += f" ({body.appended_from_qa_question!r})"
    sep += ":_\n\n"
    qa.answer = (qa.answer or "") + sep + (body.appended_answer or "")
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
    """Soft-delete a single Q&A pair (deep-fix step 2).

    We keep the row + its review_log history and just set archived_at so the
    research dataset stays complete while the index/review UI hides it.
    """
    qa = _get_qa_or_404(qa_id, db)
    if qa.archived_at is None:
        qa.archived_at = datetime.now(timezone.utc)
        db.commit()


@router.post("/api/session-events/dedup-choice", status_code=201)
def log_dedup_choice(body: DedupChoiceRequest, db: Session = Depends(get_db)):
    """Persist which branch of the 409 dedup modal the user selected.
    Payload lands in session_events.meta_json for research export."""
    now = datetime.now(timezone.utc)
    event = SessionEvent(
        session_type="dedup_choice",
        pdf_id=body.pdf_id,
        started_at=now,
        ended_at=now,
        meta_json={
            "highlight_id": body.highlight_id,
            "choice": body.choice,
            "existing_qa_id": body.existing_qa_id,
            "similarity": body.similarity,
            "attempted_study_question": body.attempted_study_question,
            "card_type": body.card_type,
        },
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return {"id": event.id}
