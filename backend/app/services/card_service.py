"""
Card service — single entry point for QA/study card creation.

Every write path (SelectionMenu action, chat Log-to-Index, manual Q&A, quiz)
routes through ``create_card``. The caller declares ``card_type`` explicitly;
the service canonicalizes ``study_question`` so consumers never re-parse
action-prefix strings.

Contract (deep-fix plan step 1):

  - manual: user typed their own question → study_question = question.
  - quiz:   Claude's answer has a ``**Question:** ... **Answer:** ...`` block
            → study_question = extracted question text.
  - explain | simplify | terms | summarise | chat:
            the stored ``question`` may be a raw action prompt
            → study_question = prepare_study_card_question(...).
            This fixes the 23% of Paper Plain QAs whose ``question`` field
            still contained the verbatim ACTION prompt.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.highlight import HighlightEntry
from app.models.highlight import QAPair
from app.services.chat_service import prepare_study_card_question
from app.services.embedding_service import embed
from app.services.ontology_service import (
    classify_rhetorical_facet,
    classify_topics_into_ontology,
    ensure_pdf_ontology,
    refresh_highlight_learning_metadata,
)


# Cosine threshold above which two study_questions on the same highlight
# are considered duplicates. 0.85 is conservative enough to preserve
# legitimate reformulations (e.g. "define term" vs "explain term"); the
# 4 identical "What is this book about?" QAs on Paper Plain hl=16 sit
# well above 0.95.
DEDUP_COSINE_THRESHOLD = 0.85


class DuplicateStudyQuestion(Exception):
    """Raised by create_card when a near-identical QA already exists on the
    same highlight. Carries the existing qa_id + similarity so the router can
    surface them in the 409 response body."""

    def __init__(self, existing_qa_id: int, existing_study_question: str, similarity: float):
        super().__init__(
            f"Duplicate study_question (qa_id={existing_qa_id}, "
            f"similarity={similarity:.3f})"
        )
        self.existing_qa_id = existing_qa_id
        self.existing_study_question = existing_study_question
        self.similarity = similarity


class ExtractionFailed(Exception):
    """Raised by create_card when an action-type card can't produce a
    non-fallback study_question — i.e. Haiku rewrite failed AND no
    structured quiz block was found. The router turns this into 422 so
    callers don't silently accept raw prompts."""

    def __init__(self, card_type: str, detail: str):
        super().__init__(detail)
        self.card_type = card_type
        self.detail = detail


# Card-type enum values used across the app. Keep this list aligned with the
# frontend SelectionMenu action ids and the `card_type` column's check space.
VALID_CARD_TYPES = frozenset(
    {"manual", "explain", "simplify", "terms", "summarise", "quiz", "chat"}
)

# card_types whose `question` column stores a raw prompt — the canonical study
# question must be derived from the answer or a Haiku rewrite.
_ACTION_TYPES = frozenset({"explain", "simplify", "terms", "summarise", "chat"})

# Generic per-type recall prompts. Used when prepare_study_card_question
# silently falls back to the raw action prompt on LLM error — these keep a
# card readable without leaking an action prefix into the review UI.
_FALLBACK_STUDY_QUESTION = {
    "explain":   "What does this passage mean in your own words?",
    "simplify":  "How would you explain this in plain language, without jargon?",
    "terms":     "What are the key terms here and what do they mean?",
    "summarise": "Summarise this passage from memory in 2–3 sentences.",
    "quiz":      "What does this passage test you on?",
    "chat":      "What is the key point of this passage?",
}

_ACTION_PREFIXES = (
    "Explain this passage",
    "Explain this in simple",
    "Identify and define",
    "Create a quiz question",
    "Summarise this passage",
)


def _is_raw_action_prompt(text: str | None) -> bool:
    return bool(text) and text.startswith(_ACTION_PREFIXES)


def _extract_quiz_question(answer: str | None) -> str | None:
    """Pull the question out of a ``**Question:** ... **Answer:** ...`` block."""
    if not answer:
        return None
    m = re.search(
        r"\*\*[Qq]uestion:\*\*\s*([\s\S]+?)(?:\n\n\*\*[Aa]nswer:|$)",
        answer,
    )
    if m:
        candidate = m.group(1).strip()
        if len(candidate) > 5:
            return candidate
    m = re.search(r"^[Qq]uestion:\s*(.+)$", answer, re.MULTILINE)
    if m:
        candidate = m.group(1).strip()
        if len(candidate) > 5:
            return candidate
    return None


def _clean_manual_question(question: str) -> str:
    idx = question.find(':\n\n"')
    cleaned = question[:idx] if idx > -1 else question
    return cleaned.strip()


def is_fallback_study_question(card_type: str, text: str | None) -> bool:
    """True when `text` equals the per-type generic recall template — the
    signal that Haiku/quiz extraction fell through to the safety net."""
    fallback = _FALLBACK_STUDY_QUESTION.get(card_type)
    return bool(fallback) and (text or "").strip() == fallback


def derive_study_question(
    *,
    card_type: str,
    question: str,
    answer: str,
    selection_text: str | None = None,
    original_question: str | None = None,
    strict: bool = False,
) -> str:
    """
    Compute the canonical standalone study question.

    Normal path: returns an extracted/rewritten question.

    When ``strict=True`` (new writes via the API), raises
    ``ExtractionFailed`` if an action-type card would have to fall back to
    the generic template — callers see a 422 instead of silently storing a
    low-signal card. ``strict=False`` preserves the fallback template so
    backfill/migration paths keep the UI readable.
    """
    if card_type == "quiz":
        extracted = _extract_quiz_question(answer)
        if extracted:
            return extracted
        # Fall through to Haiku rewrite — quiz answer didn't have a structured block.

    if card_type == "manual":
        cleaned = _clean_manual_question(question)
        return cleaned or question

    # action / chat / quiz-without-structured-block: rewrite via Haiku.
    raw = original_question or question
    rewritten = prepare_study_card_question(raw, answer, selection_text or "")
    if rewritten and rewritten.strip() and not _is_raw_action_prompt(rewritten):
        return rewritten.strip()

    # Haiku fell back to the raw prompt (or nothing).
    if strict and card_type in _ACTION_TYPES:
        raise ExtractionFailed(
            card_type,
            f"Could not derive a standalone study_question for card_type={card_type!r}. "
            "Haiku rewrite returned an empty or raw-prompt response.",
        )

    # Use the per-type generic recall prompt so the review UI never surfaces
    # an ACTION prefix. Legacy / non-strict callers only.
    return _FALLBACK_STUDY_QUESTION.get(card_type) or _clean_manual_question(raw) or raw


def _cosine(a: list[float], b: list[float]) -> float:
    # Both vectors are L2-normalised by SentenceTransformer(normalize_embeddings=True),
    # so dot product == cosine similarity.
    return sum(x * y for x, y in zip(a, b))


def find_duplicate(
    db: Session,
    *,
    highlight_id: int,
    study_question: str,
    threshold: float = DEDUP_COSINE_THRESHOLD,
) -> Optional[QAPair]:
    """Return the nearest existing non-archived QA on this highlight whose
    study_question is within ``threshold`` cosine of ``study_question``,
    else None. Attaches ``_similarity`` onto the returned row for the router
    to include in the 409 body.
    """
    q_clean = (study_question or "").strip()
    if not q_clean:
        return None

    existing = (
        db.query(QAPair)
        .filter(
            QAPair.highlight_id == highlight_id,
            QAPair.archived_at.is_(None),
        )
        .all()
    )
    if not existing:
        return None

    # Dedup against canonical study_question (fall back to question field for
    # any very-old row that predates the step-1 migration — defensive only).
    texts = [(q.study_question or q.question or "").strip() for q in existing]
    pairs = [(q, t) for q, t in zip(existing, texts) if t]
    if not pairs:
        return None

    vecs = embed([q_clean] + [t for _, t in pairs])
    target = vecs[0]
    best_qa: QAPair | None = None
    best_sim = -1.0
    for (qa, _), v in zip(pairs, vecs[1:]):
        sim = _cosine(target, v)
        if sim > best_sim:
            best_sim = sim
            best_qa = qa
    if best_qa is not None and best_sim >= threshold:
        best_qa._similarity = best_sim  # type: ignore[attr-defined]
        return best_qa
    return None


def create_card(
    db: Session,
    *,
    highlight_id: int,
    card_type: str,
    question: str,
    answer: str,
    original_question: str | None = None,
    source_chunk_ids: Optional[Iterable[str]] = None,
    selection_text: str | None = None,
    origin_chat_message_id: int | None = None,
    force: bool = False,
) -> QAPair:
    """
    Persist a new study card. All QA creation flows funnel through this function
    so study_question canonicalization + dedup happen in exactly one place.

    Raises:
        ExtractionFailed — action-type card with no derivable study_question.
        DuplicateStudyQuestion — a near-identical QA already exists on this
            highlight (suppress with ``force=True``).
    """
    if card_type not in VALID_CARD_TYPES:
        raise ValueError(f"Invalid card_type: {card_type!r}")

    study_question = derive_study_question(
        card_type=card_type,
        question=question,
        answer=answer,
        selection_text=selection_text,
        original_question=original_question,
        strict=True,
    )

    if not force:
        dup = find_duplicate(
            db,
            highlight_id=highlight_id,
            study_question=study_question,
        )
        if dup is not None:
            raise DuplicateStudyQuestion(
                existing_qa_id=dup.id,
                existing_study_question=dup.study_question or dup.question,
                similarity=getattr(dup, "_similarity", 1.0),
            )

    highlight = db.get(HighlightEntry, highlight_id)
    ontology_topics = ensure_pdf_ontology(db, highlight.pdf_id, force=False) if highlight else []
    rhetorical_facet, facet_confidence = classify_rhetorical_facet(
        study_question=study_question,
        answer=answer,
        selection_text=selection_text,
    )
    topic_tags = classify_topics_into_ontology(
        study_question=study_question,
        answer=answer,
        selection_text=selection_text,
        ontology_topics=ontology_topics,
    )

    qa = QAPair(
        highlight_id=highlight_id,
        card_type=card_type,
        question=question,
        original_question=original_question,
        study_question=study_question,
        answer=answer,
        source_chunk_ids=list(source_chunk_ids) if source_chunk_ids else [],
        selection_text=selection_text,
        rhetorical_facet=rhetorical_facet,
        facet_confidence=facet_confidence,
        topic_tags=topic_tags,
        origin_chat_message_id=origin_chat_message_id,
    )
    db.add(qa)
    db.flush()
    if highlight is not None:
        refresh_highlight_learning_metadata(db, highlight.id, ontology_topics=ontology_topics)
    db.commit()
    db.refresh(qa)
    return qa
