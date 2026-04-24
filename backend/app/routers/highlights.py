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
    derive_study_question,
)
from app.services.ontology_service import refresh_highlight_learning_metadata
from app.services.ontology_service import classify_rhetorical_facet, classify_topics_into_ontology, ensure_pdf_ontology
from app.services.question_context_service import build_question_context, build_repair_context_override

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
    question_context: Optional[dict[str, Any]] = None
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
    question: Optional[str] = None
    original_question: Optional[str] = None
    study_question: Optional[str] = None
    answer: Optional[str] = None
    source_chunk_ids: Optional[list] = None
    context_override_json: Optional[dict[str, Any]] = None


class QAPairMergeRequest(BaseModel):
    """Append-merge: preserve the existing card but fold an additional answer
    into it so the user doesn't lose the second round of context."""
    appended_answer: str
    appended_from_qa_question: Optional[str] = None


class AttachSourceRequest(BaseModel):
    selection_text: Optional[str] = None
    source_chunk_ids: Optional[list[str]] = None


class ReframeStudyQuestionRequest(BaseModel):
    study_question: Optional[str] = None


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


def _serialize_qa_pair(qa: QAPair, entry: HighlightEntry, chunk_cache: dict[str, str]) -> dict[str, Any]:
    return {
        "id": qa.id,
        "highlight_id": qa.highlight_id,
        "card_type": qa.card_type,
        "question": qa.question,
        "original_question": qa.original_question,
        "study_question": qa.study_question,
        "answer": qa.answer,
        "source_chunk_ids": qa.source_chunk_ids or [],
        "selection_text": qa.selection_text,
        "starred": qa.starred,
        "rhetorical_facet": qa.rhetorical_facet,
        "facet_confidence": qa.facet_confidence,
        "topic_tags": qa.topic_tags or [],
        "origin_chat_message_id": qa.origin_chat_message_id,
        "question_context": build_question_context(qa, entry, chunk_cache=chunk_cache),
        "stability": qa.stability,
        "difficulty": qa.difficulty,
        "reps": qa.reps,
        "lapses": qa.lapses,
        "state": qa.state,
        "due_at": qa.due_at,
        "last_review": qa.last_review,
        "created_at": qa.created_at,
    }


def _serialize_highlight(entry: HighlightEntry, chunk_cache: dict[str, str]) -> dict[str, Any]:
    active_qas = [qa for qa in entry.qa_pairs if qa.archived_at is None]
    return {
        "id": entry.id,
        "pdf_id": entry.pdf_id,
        "page_number": entry.page_number,
        "highlight_text": entry.highlight_text,
        "highlight_texts": entry.highlight_texts or [entry.highlight_text],
        "chunk_id": entry.chunk_id,
        "section_title": entry.section_title,
        "section_path": entry.section_path or [],
        "deep_section_path": entry.deep_section_path or None,
        "concepts": entry.concepts or [],
        "cluster_tag": entry.cluster_tag,
        "note": entry.note or "",
        "synthesis": entry.synthesis,
        "deep_synthesis": entry.deep_synthesis,
        "starred": entry.starred,
        "flagged": entry.flagged,
        "anchored": entry.anchored,
        "reviewed": entry.reviewed,
        "created_at": entry.created_at,
        "qa_pairs": [_serialize_qa_pair(qa, entry, chunk_cache) for qa in active_qas],
    }


def _entry_ontology_topics(db: Session, entry: HighlightEntry | None) -> list[str]:
    if not entry:
        return []
    return ensure_pdf_ontology(db, entry.pdf_id, force=False)


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
    chunk_cache: dict[str, str] = {}
    return [_serialize_highlight(entry, chunk_cache) for entry in entries]


@router.post("/api/pdfs/{pdf_id}/highlights", response_model=HighlightResponse, status_code=201)
def create_highlight(pdf_id: int, body: HighlightCreate, db: Session = Depends(get_db)):
    """Save a new highlight entry. Returns the row with its DB-assigned integer id."""
    _get_pdf_or_404(pdf_id, db)
    entry = HighlightEntry(pdf_id=pdf_id, **body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _serialize_highlight(entry, {})


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
    return _serialize_highlight(entry, {})


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
    db.refresh(qa)
    return _serialize_qa_pair(qa, qa.highlight_entry, {})


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
    return _serialize_qa_pair(qa, qa.highlight_entry, {})


@router.patch("/api/qa/{qa_id}", response_model=QAPairResponse)
def patch_qa_pair(qa_id: int, body: QAPairPatch, db: Session = Depends(get_db)):
    """Patch mutable QA fields without destroying provenance."""
    qa = _get_qa_or_404(qa_id, db)
    entry = qa.highlight_entry
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(qa, field, value)
    if any(field in body.model_dump(exclude_none=True) for field in {"study_question", "selection_text", "source_chunk_ids", "answer"}):
        current_question = qa.study_question or qa.original_question or qa.question or "Study card"
        ontology_topics = _entry_ontology_topics(db, entry)
        qa.rhetorical_facet, qa.facet_confidence = classify_rhetorical_facet(
            study_question=current_question,
            answer=qa.answer or "",
            selection_text=qa.selection_text or (entry.highlight_text if entry else ""),
        )
        qa.topic_tags = classify_topics_into_ontology(
            study_question=current_question,
            answer=qa.answer or "",
            selection_text=qa.selection_text or (entry.highlight_text if entry else ""),
            ontology_topics=ontology_topics,
        )
        if entry:
            refresh_highlight_learning_metadata(db, entry.id, ontology_topics=ontology_topics)
    db.commit()
    db.refresh(qa)
    return _serialize_qa_pair(qa, qa.highlight_entry, {})


@router.post("/api/qa/{qa_id}/repair-context", response_model=QAPairResponse)
def repair_qa_context(qa_id: int, db: Session = Depends(get_db)):
    qa = _get_qa_or_404(qa_id, db)
    if qa.archived_at is not None:
        raise HTTPException(status_code=410, detail="Q&A pair has been archived")
    entry = qa.highlight_entry
    override = build_repair_context_override(qa, entry)
    existing = qa.context_override_json if isinstance(qa.context_override_json, dict) else {}
    qa.context_override_json = {**existing, **override}
    db.commit()
    db.refresh(qa)
    return _serialize_qa_pair(qa, entry, {})


@router.post("/api/qa/{qa_id}/attach-source", response_model=QAPairResponse)
def attach_source_to_qa(
    qa_id: int,
    body: Optional[AttachSourceRequest] = None,
    db: Session = Depends(get_db),
):
    qa = _get_qa_or_404(qa_id, db)
    if qa.archived_at is not None:
        raise HTTPException(status_code=410, detail="Q&A pair has been archived")
    entry = qa.highlight_entry
    if not entry:
        raise HTTPException(status_code=404, detail="Associated highlight not found")

    request_body = body or AttachSourceRequest()
    selection_text = (request_body.selection_text or qa.selection_text or entry.highlight_text or "").strip()
    chunk_ids = [cid for cid in (request_body.source_chunk_ids or qa.source_chunk_ids or []) if cid]
    if not chunk_ids and entry.chunk_id:
        chunk_ids = [entry.chunk_id]

    if not selection_text and not chunk_ids:
        raise HTTPException(status_code=422, detail="No source passage could be attached from this highlight")

    if selection_text:
        qa.selection_text = selection_text
    qa.source_chunk_ids = chunk_ids
    override = build_repair_context_override(qa, entry)
    existing = qa.context_override_json if isinstance(qa.context_override_json, dict) else {}
    qa.context_override_json = {**existing, **override}
    db.commit()
    db.refresh(qa)
    return _serialize_qa_pair(qa, entry, {})


@router.post("/api/qa/{qa_id}/reframe-study-question", response_model=QAPairResponse)
def reframe_study_question(
    qa_id: int,
    body: Optional[ReframeStudyQuestionRequest] = None,
    db: Session = Depends(get_db),
):
    qa = _get_qa_or_404(qa_id, db)
    if qa.archived_at is not None:
        raise HTTPException(status_code=410, detail="Q&A pair has been archived")
    entry = qa.highlight_entry
    raw_original = (qa.original_question or qa.question or qa.study_question or "").strip()
    request_body = body or ReframeStudyQuestionRequest()
    new_study = (request_body.study_question or "").strip()
    if not new_study:
        new_study = derive_study_question(
            card_type=qa.card_type or "manual",
            question=qa.question or raw_original,
            answer=qa.answer or "",
            selection_text=qa.selection_text or (entry.highlight_text if entry else ""),
            original_question=raw_original or None,
            strict=False,
        )
    if not new_study:
        raise HTTPException(status_code=422, detail="Could not derive a stronger standalone study question")

    if not qa.original_question:
        qa.original_question = raw_original or None
    qa.study_question = new_study
    ontology_topics = _entry_ontology_topics(db, entry)
    qa.rhetorical_facet, qa.facet_confidence = classify_rhetorical_facet(
        study_question=new_study,
        answer=qa.answer or "",
        selection_text=qa.selection_text or (entry.highlight_text if entry else ""),
    )
    qa.topic_tags = classify_topics_into_ontology(
        study_question=new_study,
        answer=qa.answer or "",
        selection_text=qa.selection_text or (entry.highlight_text if entry else ""),
        ontology_topics=ontology_topics,
    )
    if entry:
        refresh_highlight_learning_metadata(db, entry.id, ontology_topics=ontology_topics)
    db.commit()
    db.refresh(qa)
    return _serialize_qa_pair(qa, entry, {})


@router.post("/api/qa/{qa_id}/convert-to-note", response_model=HighlightResponse)
def convert_qa_to_note(qa_id: int, db: Session = Depends(get_db)):
    qa = _get_qa_or_404(qa_id, db)
    if qa.archived_at is not None:
        raise HTTPException(status_code=410, detail="Q&A pair has already been archived")
    entry = qa.highlight_entry
    if not entry:
        raise HTTPException(status_code=404, detail="Associated highlight not found")

    question_text = qa.original_question or qa.study_question or qa.question or "Saved study card"
    note_block = f"Study note\nQ: {question_text}\nA: {qa.answer or ''}".strip()
    existing_note = (entry.note or "").strip()
    entry.note = f"{existing_note}\n\n{note_block}".strip() if existing_note else note_block
    qa.archived_at = datetime.now(timezone.utc)
    refresh_highlight_learning_metadata(db, entry.id)
    db.commit()
    db.refresh(entry)
    return _serialize_highlight(entry, {})


@router.post("/api/pdfs/{pdf_id}/legacy-context-backfill")
def backfill_legacy_context(pdf_id: int, db: Session = Depends(get_db)):
    _get_pdf_or_404(pdf_id, db)
    entries = (
        db.query(HighlightEntry)
        .filter(HighlightEntry.pdf_id == pdf_id)
        .order_by(HighlightEntry.created_at.asc())
        .all()
    )
    touched_qas = 0
    weak_qas = 0
    for entry in entries:
        active_qas = [qa for qa in entry.qa_pairs if qa.archived_at is None]
        for qa in active_qas:
            current = build_question_context(qa, entry)
            if (
                current.get("context_status") == "weak"
                or current.get("question_origin") == "chat"
                or current.get("needs_disambiguation")
                or not (qa.context_override_json if isinstance(qa.context_override_json, dict) else {})
            ):
                override = build_repair_context_override(qa, entry)
                existing = qa.context_override_json if isinstance(qa.context_override_json, dict) else {}
                merged = {**existing, **override}
                if merged != existing:
                    qa.context_override_json = merged
                    touched_qas += 1
                if current.get("context_status") == "weak" or current.get("needs_disambiguation"):
                    weak_qas += 1
                db.add(qa)
    db.commit()
    return {
        "pdf_id": pdf_id,
        "entries_scanned": len(entries),
        "qas_updated": touched_qas,
        "weak_or_ambiguous_qas_seen": weak_qas,
    }


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
