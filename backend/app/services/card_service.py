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

from app.models.highlight import QAPair
from app.services.chat_service import prepare_study_card_question


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


def derive_study_question(
    *,
    card_type: str,
    question: str,
    answer: str,
    selection_text: str | None = None,
    original_question: str | None = None,
) -> str:
    """
    Compute the canonical standalone study question. Always returns a non-empty
    string — falls back to the user's raw question if LLM rewriting fails.
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

    # Haiku fell back to the raw prompt (or nothing). Use the per-type
    # generic recall prompt so the review UI never surfaces an ACTION prefix.
    return _FALLBACK_STUDY_QUESTION.get(card_type) or _clean_manual_question(raw) or raw


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
) -> QAPair:
    """
    Persist a new study card. All QA creation flows funnel through this function
    so study_question canonicalization happens in exactly one place.
    """
    if card_type not in VALID_CARD_TYPES:
        raise ValueError(f"Invalid card_type: {card_type!r}")

    study_question = derive_study_question(
        card_type=card_type,
        question=question,
        answer=answer,
        selection_text=selection_text,
        original_question=original_question,
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
        origin_chat_message_id=origin_chat_message_id,
    )
    db.add(qa)
    db.commit()
    db.refresh(qa)
    return qa
