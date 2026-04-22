"""Phase 11: add qa_pairs.original_question and highlight_entries.deep_synthesis

Revision ID: phase11_drift
Revises: 95079a60dcfe
Create Date: 2026-04-21

Idempotent: uses ADD COLUMN IF NOT EXISTS so it is safe to run against a DB
that already has the columns (e.g. a dev box where the lifespan hook added
them before Alembic was in place).
"""
from typing import Sequence, Union

from alembic import op


revision: str = "phase11_drift"
down_revision: Union[str, None] = "95079a60dcfe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS original_question TEXT")
    op.execute("ALTER TABLE highlight_entries ADD COLUMN IF NOT EXISTS deep_synthesis TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE highlight_entries DROP COLUMN IF EXISTS deep_synthesis")
    op.execute("ALTER TABLE qa_pairs DROP COLUMN IF EXISTS original_question")
