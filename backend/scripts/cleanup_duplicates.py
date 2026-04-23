"""
Cleanup script: collapse near-duplicate QA pairs within each highlight
(deep-fix plan step 2).

Strategy — per highlight_id with ≥2 non-archived QAs:
  1. Embed study_question (fall back to question) for each QA.
  2. Greedy-cluster by cosine ≥ DEDUP_COSINE_THRESHOLD (0.85).
  3. In each cluster of size > 1, pick a survivor:
       primary key = reps (desc), tiebreak = created_at (desc).
  4. Re-parent losing review_log rows to the survivor (qa_pair_id update).
  5. Soft-delete losers: archived_at = now().

Paper Plain (pdf_id=5) expected effect:
  - hl=16: qa ids [24,25,26,27] ("What is this book about?") → 1 survivor.
  - hl=10: qa ids [13,15] (quiz duplicates) → 1 survivor.
  - Due queue drops 13 → ~9.

Usage:
    python -m scripts.cleanup_duplicates --dry-run
    python -m scripts.cleanup_duplicates            # apply
    python -m scripts.cleanup_duplicates --pdf-id 5 # scope to one PDF
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.highlight import HighlightEntry, QAPair
from app.models.review import ReviewLog
from app.services.card_service import DEDUP_COSINE_THRESHOLD, _cosine
from app.services.embedding_service import embed


def _pick_survivor(cards: list[QAPair]) -> QAPair:
    """Highest-reps wins; on tie, the newest created_at."""
    return max(
        cards,
        key=lambda q: (
            q.reps or 0,
            q.created_at or datetime.min.replace(tzinfo=timezone.utc),
        ),
    )


def _cluster(cards: list[QAPair], threshold: float) -> list[list[QAPair]]:
    """Greedy single-link clustering on study_question embeddings."""
    texts = [(c.study_question or c.question or "").strip() for c in cards]
    indexed = [(i, t) for i, t in enumerate(texts) if t]
    if not indexed:
        return [[c] for c in cards]
    vecs = embed([t for _, t in indexed])
    idx_to_vec = {i: v for (i, _), v in zip(indexed, vecs)}

    clusters: list[list[int]] = []
    for i, _ in indexed:
        v = idx_to_vec[i]
        placed = False
        for cl in clusters:
            if any(_cosine(v, idx_to_vec[j]) >= threshold for j in cl):
                cl.append(i)
                placed = True
                break
        if not placed:
            clusters.append([i])

    # Blank-text rows (no study_question/question) each live in their own cluster —
    # they can't be compared, so they're left alone.
    blank_indices = {i for i, t in enumerate(texts) if not t}
    for i in blank_indices:
        clusters.append([i])

    return [[cards[i] for i in cl] for cl in clusters]


def cleanup_highlight(db: Session, highlight_id: int, dry_run: bool) -> dict:
    cards = (
        db.query(QAPair)
        .filter(QAPair.highlight_id == highlight_id, QAPair.archived_at.is_(None))
        .all()
    )
    if len(cards) < 2:
        return {"highlight_id": highlight_id, "collapsed": 0, "clusters": []}

    summary = {"highlight_id": highlight_id, "collapsed": 0, "clusters": []}
    now = datetime.now(timezone.utc)

    for cluster in _cluster(cards, DEDUP_COSINE_THRESHOLD):
        if len(cluster) < 2:
            continue
        survivor = _pick_survivor(cluster)
        losers = [c for c in cluster if c.id != survivor.id]
        summary["clusters"].append({
            "survivor_id": survivor.id,
            "survivor_reps": survivor.reps or 0,
            "survivor_q": (survivor.study_question or survivor.question)[:90],
            "loser_ids": [c.id for c in losers],
        })
        summary["collapsed"] += len(losers)

        if dry_run:
            continue

        loser_ids = [c.id for c in losers]
        db.query(ReviewLog).filter(ReviewLog.qa_pair_id.in_(loser_ids)).update(
            {ReviewLog.qa_pair_id: survivor.id}, synchronize_session=False,
        )
        db.query(QAPair).filter(QAPair.id.in_(loser_ids)).update(
            {QAPair.archived_at: now}, synchronize_session=False,
        )

    if not dry_run and summary["collapsed"]:
        db.commit()
    return summary


def iter_highlight_ids(db: Session, pdf_id: int | None) -> Iterable[int]:
    q = db.query(HighlightEntry.id)
    if pdf_id is not None:
        q = q.filter(HighlightEntry.pdf_id == pdf_id)
    return [row.id for row in q.all()]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Report only; no writes.")
    ap.add_argument("--pdf-id", type=int, default=None, help="Scope cleanup to one PDF.")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        highlight_ids = iter_highlight_ids(db, args.pdf_id)
        total_collapsed = 0
        per_hl: list[dict] = []
        for hid in highlight_ids:
            result = cleanup_highlight(db, hid, dry_run=args.dry_run)
            if result["collapsed"]:
                per_hl.append(result)
                total_collapsed += result["collapsed"]

        mode = "DRY RUN" if args.dry_run else "APPLIED"
        print(f"\n=== cleanup_duplicates [{mode}] ===")
        print(f"Highlights scanned: {len(highlight_ids)}")
        print(f"Highlights with dedup action: {len(per_hl)}")
        print(f"Total QA rows soft-deleted: {total_collapsed}\n")
        for r in per_hl:
            print(f"highlight_id={r['highlight_id']}:")
            for c in r["clusters"]:
                print(
                    f"  survivor qa={c['survivor_id']} reps={c['survivor_reps']} "
                    f"q={c['survivor_q']!r}"
                )
                print(f"    archived: {c['loser_ids']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
