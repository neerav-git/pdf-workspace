"""Step 1: first-class card schema contract (deep-fix plan 2026-04-22)

Adds to qa_pairs:
  - card_type VARCHAR(16) NOT NULL DEFAULT 'manual'
  - study_question TEXT NULL
  - rhetorical_facet VARCHAR(16) NULL
  - facet_confidence FLOAT NULL
  - origin_chat_message_id INTEGER NULL

Backfill pass infers card_type from the stored question prefix
(matching the ACTION_MAP used in the frontend), and for quiz cards
extracts study_question from the answer's Question/Answer block.
For manual cards, study_question is set to the stored question with
any trailing ":\n\n\"...\"" passage quote stripped.
For action types (explain/simplify/terms/summarise), study_question
is left NULL — step 4's backfill endpoint will regenerate via Haiku.

Revision ID: step1_card_contract
Revises: phase11_drift
"""
from __future__ import annotations

import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "step1_card_contract"
down_revision: Union[str, None] = "phase11_drift"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Prefix → card_type, mirrors ACTION_MAP in frontend HighlightIndex.jsx.
_ACTION_PREFIXES = [
    ("Explain this passage",   "explain"),
    ("Explain this in simple", "simplify"),
    ("Identify and define",    "terms"),
    ("Create a quiz question", "quiz"),
    ("Summarise this passage", "summarise"),
]

# Fallback study_questions when a legacy row has no canonical rewrite on file.
# Mirrors ACTION_PROMPTS in ReviewSession.jsx — these are the same generic
# recall prompts the review UI already uses when no specific question exists.
_FALLBACK_STUDY_QUESTION = {
    "explain":   "What does this passage mean in your own words?",
    "simplify":  "How would you explain this in plain language, without jargon?",
    "terms":     "What are the key terms here and what do they mean?",
    "summarise": "Summarise this passage from memory in 2–3 sentences.",
    "quiz":      "What does this passage test you on?",
    "chat":      "What is the key point of this passage?",
}


def _infer_card_type(question: str | None, original_question: str | None) -> str:
    for source in (original_question, question):
        if not source:
            continue
        for prefix, card_type in _ACTION_PREFIXES:
            if source.startswith(prefix):
                return card_type
    return "manual"


def _extract_quiz_question(answer: str | None) -> str | None:
    if not answer:
        return None
    m = re.search(
        r"\*\*[Qq]uestion:\*\*\s*([\s\S]+?)(?:\n\n\*\*[Aa]nswer:|$)",
        answer,
    )
    if m:
        q = m.group(1).strip()
        if len(q) > 5:
            return q
    m = re.search(r"^[Qq]uestion:\s*(.+)$", answer, re.MULTILINE)
    if m:
        q = m.group(1).strip()
        if len(q) > 5:
            return q
    return None


def _clean_manual_question(question: str | None) -> str | None:
    if not question:
        return None
    idx = question.find(':\n\n"')
    cleaned = question[:idx] if idx > -1 else question
    return cleaned.strip() or None


def upgrade() -> None:
    # Idempotent DDL — safe to re-run against a DB that was patched manually.
    op.execute("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS card_type VARCHAR(16) NOT NULL DEFAULT 'manual'")
    op.execute("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS study_question TEXT")
    op.execute("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS rhetorical_facet VARCHAR(16)")
    op.execute("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS facet_confidence FLOAT")
    op.execute("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS origin_chat_message_id INTEGER")

    # ── Data backfill ────────────────────────────────────────────────────
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, question, original_question, answer FROM qa_pairs"
    )).fetchall()

    for row in rows:
        qa_id = row.id
        card_type = _infer_card_type(row.question, row.original_question)

        study_question: str | None
        if card_type == "quiz":
            study_question = _extract_quiz_question(row.answer)
        elif card_type == "manual":
            study_question = _clean_manual_question(row.question)
        else:
            # Action type: if the stored question differs from the raw
            # original_question, an earlier prepare_study_card_question run
            # rewrote it — that rewrite is the canonical study question.
            if (
                row.original_question
                and row.question
                and row.question.strip() != row.original_question.strip()
            ):
                study_question = row.question.strip() or None
            else:
                study_question = None

        # Fallback: any card still without a study_question gets the
        # per-type generic recall prompt so the review UI never displays
        # a raw ACTION prompt. Step 4's backfill endpoint will replace
        # these with Haiku-generated specifics.
        if not study_question:
            study_question = _FALLBACK_STUDY_QUESTION.get(card_type)

        conn.execute(
            sa.text(
                "UPDATE qa_pairs "
                "SET card_type = :card_type, study_question = :study_question "
                "WHERE id = :id"
            ),
            {"card_type": card_type, "study_question": study_question, "id": qa_id},
        )


def downgrade() -> None:
    op.execute("ALTER TABLE qa_pairs DROP COLUMN IF EXISTS origin_chat_message_id")
    op.execute("ALTER TABLE qa_pairs DROP COLUMN IF EXISTS facet_confidence")
    op.execute("ALTER TABLE qa_pairs DROP COLUMN IF EXISTS rhetorical_facet")
    op.execute("ALTER TABLE qa_pairs DROP COLUMN IF EXISTS study_question")
    op.execute("ALTER TABLE qa_pairs DROP COLUMN IF EXISTS card_type")
