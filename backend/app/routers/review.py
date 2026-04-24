"""
Review router — POST /api/review/submit + due-card queries.

This endpoint is the thesis's core empirical contribution:
  User types recall → Claude grades (3D rubric) → FSRS updates scheduling.

Cardinal rules:
  - confidence_rating + recall_text arrive in ONE call, BEFORE grade is computed.
    Never expose the grade before confidence is submitted. (Research D2)
  - FSRS rating comes from Claude's score, not user confidence. (Research A3)
  - model_version, rubric_version_id, system_prompt_version logged on every row. (Research B2, C5)
"""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.highlight import QAPair
from app.models.review import ReviewLog
from app.services.grading_service import (
    DEFAULT_PROMPT_VERSION,
    DEFAULT_RUBRIC_VERSION,
    GRADING_MODEL,
    _CLAUDE_TO_FSRS_RATING,
    _scheduler,
    compute_overall_score,
    get_source_text,
    persist_card_to_qa,
    reconstruct_card,
    run_grading,
)
from app.services.question_context_service import build_question_context

router = APIRouter(tags=["review"])


# ── Request / Response schemas ────────────────────────────────────────────────

# Recall mode telemetry.
#   free_recall  — user answered from memory, passage hidden (primary-claim cohort).
#   cloze        — user revealed passage with ~30% of words masked.
#   assisted     — user chose to reveal the full passage on a specific-prompt card.
#   required     — passage was shown by default because the card's study_question is
#                  a generic fallback template (e.g. "How would you explain this in
#                  plain language?"). The card is literally unanswerable without the
#                  passage, so this is NOT user-initiated assistance. Research export
#                  should analyze these separately from both free_recall and assisted.
VALID_RECALL_MODES = {"free_recall", "cloze", "assisted", "required"}


class SubmitReviewRequest(BaseModel):
    qa_pair_id: int
    recall_text: str
    confidence_rating: int           # 1–5, user's pre-grade self-rating (NOT the FSRS input)
    recall_latency_ms: Optional[int] = None
    # Deep-fix step 3 retrieval-mode telemetry.
    # reveal_used: user revealed the source passage in Phase 1.
    # recall_mode: free_recall | cloze | assisted (see SCIM/Paper Plain rationale).
    reveal_used: bool = False
    recall_mode: Optional[str] = None


class DimensionScore(BaseModel):
    score: int
    rationale: str


class SubmitReviewResponse(BaseModel):
    # Grades
    overall_score: int
    core_claim: DimensionScore
    supporting_detail: DimensionScore
    faithfulness: DimensionScore
    claude_confidence: int
    feedback: str
    rubric_hits: list
    missing: list
    # FSRS result
    fsrs_rating: int
    new_stability: float
    new_state: str
    due_at: Any
    # For display
    expected_answer: str
    review_log_id: int


class DueCardResponse(BaseModel):
    id: int
    highlight_id: int
    card_type: str
    question: str
    original_question: Optional[str] = None
    # Canonical standalone study question — review UI prefers this over
    # `question` so it never shows a raw action prompt.
    study_question: Optional[str] = None
    rhetorical_facet: Optional[str] = None
    answer: str
    source_chunk_ids: list
    state: str
    stability: float
    reps: int
    due_at: Any
    # Highlight context for review UI (amber source passage box)
    highlight_text: str
    # Full source passage text from ChromaDB — more complete than highlight_text
    # which is the user's raw selection and may contain PDF extraction artifacts.
    source_passage: Optional[str] = None
    page_number: Optional[int]
    section_title: Optional[str]
    cluster_tag: Optional[str]
    pdf_id: int
    question_context: Optional[dict[str, Any]] = None

    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/review/submit", response_model=SubmitReviewResponse)
def submit_review(body: SubmitReviewRequest, db: Session = Depends(get_db)):
    """
    Single-call review submission.

    Receives recall_text + confidence_rating in ONE request — confidence is
    collected before grading runs, which is the methodological requirement.
    (Research D2: if the user sees grading feedback before rating confidence,
     the calibration measurement is contaminated.)

    Flow:
      1. Validate qa_pair_id
      2. Fetch source chunks from ChromaDB (RAG-grounded grading, Research C6)
      3. Call Claude with 3-dim analytical rubric (temperature=0, pinned model)
      4. Map Claude's overall score → FSRS rating (Research A3)
      5. Reconstruct Card from DB, call scheduler.review_card()
      6. Persist updated FSRS state to qa_pairs
      7. Write review_log row (all 17 fields — thesis-critical, Research B2)
      8. Return grade + feedback
    """
    qa = db.get(QAPair, body.qa_pair_id)
    if not qa:
        raise HTTPException(status_code=404, detail="Q&A pair not found")
    if qa.archived_at is not None:
        raise HTTPException(status_code=410, detail="Q&A pair has been archived")

    if body.recall_mode is not None and body.recall_mode not in VALID_RECALL_MODES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid recall_mode: {body.recall_mode!r}. Must be one of {sorted(VALID_RECALL_MODES)}.",
        )

    highlight = qa.highlight_entry
    if not highlight:
        raise HTTPException(status_code=404, detail="Associated highlight not found")

    # ── Step 1: fetch source passages (RAG-grounded grading) ────────────────
    chunk_ids = qa.source_chunk_ids or []
    source_text = get_source_text(chunk_ids)

    # ── Step 2: Claude grading ───────────────────────────────────────────────
    prior_stability = qa.stability or 0.0

    grades = run_grading(
        source_text=source_text,
        question=qa.question,
        expected_answer=qa.answer,
        recall_text=body.recall_text,
    )

    overall_score = compute_overall_score(grades)

    # ── Step 3: FSRS update (Claude score → rating, NOT user confidence) ────
    fsrs_rating_enum = _CLAUDE_TO_FSRS_RATING.get(overall_score, _CLAUDE_TO_FSRS_RATING[3])
    fsrs_rating_int  = fsrs_rating_enum.value

    card = reconstruct_card(qa)
    card_after, _log = _scheduler.review_card(card, fsrs_rating_enum)

    persist_card_to_qa(qa, card_after)

    # ── Step 4: write review_log (thesis-critical — all fields required) ────
    review_entry = ReviewLog(
        qa_pair_id                = body.qa_pair_id,
        rubric_version_id         = DEFAULT_RUBRIC_VERSION,
        reviewed_at               = datetime.now(timezone.utc),
        # User inputs (pre-grade — collected before grade reveal)
        confidence_rating         = body.confidence_rating,
        recall_text               = body.recall_text,
        recall_latency_ms         = body.recall_latency_ms,
        reveal_used               = body.reveal_used,
        recall_mode               = body.recall_mode,
        # Claude grades
        claude_grade_overall      = overall_score,
        claude_grade_core         = grades.get("core_claim_score"),
        claude_grade_detail       = grades.get("supporting_detail_score"),
        claude_grade_faithfulness = grades.get("faithfulness_score"),
        claude_confidence         = grades.get("confidence"),
        claude_rubric_hits        = grades.get("rubric_hits", []),
        claude_missing            = grades.get("missing", []),
        claude_feedback           = grades.get("feedback", ""),
        # FSRS transition — store both raw score AND derived rating (Research A3)
        fsrs_rating               = fsrs_rating_int,
        prior_stability           = prior_stability,
        new_stability             = card_after.stability or 0.0,
        elapsed_since_last_days   = (qa.elapsed_days or 0),
        # Version strings (essential for methodology reporting — freeze before study)
        model_version             = GRADING_MODEL,
        system_prompt_version     = DEFAULT_PROMPT_VERSION,
        human_grading_sample      = False,   # will be set by IRR sampling logic later
    )
    db.add(review_entry)
    db.commit()
    db.refresh(review_entry)

    return SubmitReviewResponse(
        overall_score       = overall_score,
        core_claim          = DimensionScore(
            score=grades.get("core_claim_score", 3),
            rationale=grades.get("core_claim_rationale", ""),
        ),
        supporting_detail   = DimensionScore(
            score=grades.get("supporting_detail_score", 3),
            rationale=grades.get("supporting_detail_rationale", ""),
        ),
        faithfulness        = DimensionScore(
            score=grades.get("faithfulness_score", 3),
            rationale=grades.get("faithfulness_rationale", ""),
        ),
        claude_confidence   = grades.get("confidence", 3),
        feedback            = grades.get("feedback", ""),
        rubric_hits         = grades.get("rubric_hits", []),
        missing             = grades.get("missing", []),
        fsrs_rating         = fsrs_rating_int,
        new_stability       = card_after.stability or 0.0,
        new_state           = qa.state,
        due_at              = card_after.due,
        expected_answer     = qa.answer,
        review_log_id       = review_entry.id,
    )


@router.get("/api/review/due", response_model=list[DueCardResponse])
def get_due_cards(limit: int = 20, db: Session = Depends(get_db)):
    """
    Global due-card queue — all cards due now across all PDFs, ordered by most overdue.
    Used by the main review session (/review route).
    Archived cards are excluded (deep-fix step 2).
    """
    now = datetime.now(timezone.utc)
    raw_cards = (
        db.query(QAPair)
        .filter(
            QAPair.due_at <= now,
            QAPair.state != "suspended",
            QAPair.archived_at.is_(None),
        )
        .order_by(QAPair.due_at.asc())
        .limit(max(limit * 3, limit))
        .all()
    )
    cards = _diversify_due_cards(raw_cards, limit)
    return [_qa_to_due_response(qa) for qa in cards]


@router.get("/api/pdfs/{pdf_id}/review/due", response_model=list[DueCardResponse])
def get_due_cards_for_pdf(pdf_id: int, limit: int = 20, db: Session = Depends(get_db)):
    """
    PDF-scoped due cards — for Quiz Me on a specific document.
    Same grading engine as the main review session; just a different card selection.
    (Research D4: Quiz Me and Review Session share the same grading engine.)
    Archived cards are excluded (deep-fix step 2).
    """
    now = datetime.now(timezone.utc)
    raw_cards = (
        db.query(QAPair)
        .join(QAPair.highlight_entry)
        .filter(
            QAPair.highlight_entry.has(pdf_id=pdf_id),
            QAPair.due_at <= now,
            QAPair.state != "suspended",
            QAPair.archived_at.is_(None),
        )
        .order_by(QAPair.due_at.asc())
        .limit(max(limit * 3, limit))
        .all()
    )
    cards = _diversify_due_cards(raw_cards, limit)
    return [_qa_to_due_response(qa) for qa in cards]


@router.get("/api/qa/{qa_id}/review-data", response_model=DueCardResponse)
def get_qa_review_data(qa_id: int, db: Session = Depends(get_db)):
    """Return a single Q&A card in DueCardResponse format for on-demand review."""
    qa = db.get(QAPair, qa_id)
    if not qa:
        raise HTTPException(status_code=404, detail="Q&A pair not found")
    if qa.archived_at is not None:
        raise HTTPException(status_code=410, detail="Q&A pair has been archived")
    return _qa_to_due_response(qa)


@router.get("/api/review/stats")
def get_review_stats(db: Session = Depends(get_db)):
    """Quick card counts for the review session header. Archived cards excluded."""
    now = datetime.now(timezone.utc)
    active = db.query(QAPair).filter(
        QAPair.state != "suspended",
        QAPair.archived_at.is_(None),
    )
    total  = active.count()
    due    = active.filter(QAPair.due_at <= now).count()
    new    = db.query(QAPair).filter(
        QAPair.state == "new",
        QAPair.archived_at.is_(None),
    ).count()
    return {"total": total, "due_now": due, "new": new}


# ── Helper ───────────────────────────────────────────────────────────────────

def _qa_to_due_response(qa: QAPair) -> DueCardResponse:
    h = qa.highlight_entry
    # Fetch full source passage from ChromaDB for display in review session.
    # This is more complete than highlight_text, which is the user's raw PDF selection
    # and may have line-break artifacts or cut-off text.
    source_passage = None
    if qa.source_chunk_ids:
        source_passage = get_source_text(qa.source_chunk_ids) or None
    question_context = build_question_context(
        qa,
        h,
        resolved_source_text=source_passage,
    )
    return DueCardResponse(
        id               = qa.id,
        highlight_id     = qa.highlight_id,
        card_type        = qa.card_type or "manual",
        question         = qa.question,
        original_question = qa.original_question,
        study_question   = qa.study_question,
        rhetorical_facet = qa.rhetorical_facet,
        answer           = qa.answer,
        source_chunk_ids = qa.source_chunk_ids or [],
        state            = qa.state,
        stability        = qa.stability or 0.0,
        reps             = qa.reps or 0,
        due_at           = qa.due_at,
        # Prefer QA-specific selection text (set when the QA was created from a specific
        # selection) over the parent entry's primary highlight_text.  This ensures the
        # review source passage shows what the user was actually looking at when they
        # asked the question, not just the first selection that created the index entry.
        highlight_text   = qa.selection_text or (h.highlight_text if h else ""),
        source_passage   = source_passage,
        page_number      = h.page_number if h else None,
        section_title    = h.section_title if h else None,
        cluster_tag      = h.cluster_tag if h else None,
        pdf_id           = h.pdf_id if h else 0,
        question_context = question_context,
    )


def _section_key(qa: QAPair) -> str:
    h = qa.highlight_entry
    if not h:
        return "__none__"
    return (h.cluster_tag or h.section_title or f"page:{h.page_number or 0}").strip().lower()


def _diversify_due_cards(cards: list[QAPair], limit: int) -> list[QAPair]:
    if len(cards) <= 2:
        return cards[:limit]

    remaining = list(cards)
    ordered: list[QAPair] = []
    previous_section: str | None = None
    lookahead = min(len(remaining), max(5, limit))
    same_section_penalty_seconds = 180

    while remaining and len(ordered) < limit:
        best_idx = 0
        best_score: float | None = None
        for idx, qa in enumerate(remaining[:lookahead]):
            due_at = qa.due_at or datetime.now(timezone.utc)
            score = due_at.timestamp()
            if previous_section and _section_key(qa) == previous_section:
                score += same_section_penalty_seconds
            if best_score is None or score < best_score:
                best_score = score
                best_idx = idx
        chosen = remaining.pop(best_idx)
        ordered.append(chosen)
        previous_section = _section_key(chosen)
    return ordered
