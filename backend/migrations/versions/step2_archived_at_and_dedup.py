"""Step 2: soft-delete tombstone + dedup instrumentation (deep-fix plan 2026-04-22)

Adds:
  - qa_pairs.archived_at TIMESTAMPTZ NULL — soft-delete tombstone. Rows with
    archived_at IS NOT NULL are excluded from index/review reads but stay
    in the DB so review_log rows remain join-able for the study.
  - session_events.meta_json JSONB NULL — per-event payload. Used by the
    dedup-modal choice logger so research export can see which branch
    (open / merge / force) the user picked on each 409.

Re-creates ix_qa_pairs_due_at_active so the partial index excludes archived
cards from due-queue scans.

Revision ID: step2_archived_dedup
Revises: step1_card_contract
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "step2_archived_dedup"
down_revision: Union[str, None] = "step1_card_contract"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ")
    op.execute("ALTER TABLE session_events ADD COLUMN IF NOT EXISTS meta_json JSONB")

    # Re-create the due-queue partial index to also exclude archived rows.
    op.execute("DROP INDEX IF EXISTS ix_qa_pairs_due_at_active")
    op.execute(
        "CREATE INDEX ix_qa_pairs_due_at_active "
        "ON qa_pairs (due_at) "
        "WHERE state != 'suspended' AND archived_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_qa_pairs_due_at_active")
    op.execute(
        "CREATE INDEX ix_qa_pairs_due_at_active "
        "ON qa_pairs (due_at) "
        "WHERE state != 'suspended'"
    )
    op.execute("ALTER TABLE session_events DROP COLUMN IF EXISTS meta_json")
    op.execute("ALTER TABLE qa_pairs DROP COLUMN IF EXISTS archived_at")
