"""Step 3: recall-first review telemetry (deep-fix plan 2026-04-22)

Adds to review_log the two methodological flags needed so the primary-claim
regression can restrict to unassisted, memory-only responses:

  - reveal_used BOOLEAN NOT NULL DEFAULT FALSE
      True when the user revealed the source passage in Phase 1. The primary
      retention claim is defined against reveal_used = FALSE rows only.

  - recall_mode VARCHAR(12) NULL
      One of {'free_recall', 'cloze', 'assisted'} describing the exposure
      state at submit time.

Backfill: all existing review_log rows pre-date the hide-source UX and were
captured with the source passage always visible, so set reveal_used = TRUE
and recall_mode = 'assisted' so they don't silently pollute a "free recall"
cohort. New rows land with the server-assigned default of FALSE.

Revision ID: step3_reveal_used
Revises: step2_archived_dedup
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "step3_reveal_used"
down_revision: Union[str, None] = "step2_archived_dedup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE review_log "
        "ADD COLUMN IF NOT EXISTS reveal_used BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute("ALTER TABLE review_log ADD COLUMN IF NOT EXISTS recall_mode VARCHAR(12)")

    # Backfill: legacy rows were captured with the source panel always visible.
    # Mark them as assisted so they don't contaminate the free-recall cohort.
    op.execute(
        "UPDATE review_log "
        "SET reveal_used = TRUE, recall_mode = 'assisted' "
        "WHERE recall_mode IS NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE review_log DROP COLUMN IF EXISTS recall_mode")
    op.execute("ALTER TABLE review_log DROP COLUMN IF EXISTS reveal_used")
