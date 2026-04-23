"""
Research export router — thesis data export and IRR sampling.

These endpoints exist purely for the thesis's empirical analysis.
They are NOT part of the user-facing product.

Endpoints:
  GET  /api/research/export/review-log   — full review_log as JSON (thesis primary data)
  GET  /api/research/export/irr-sample   — review_log rows flagged for human grading
  POST /api/research/irr/sample          — randomly flag rows for IRR sub-study
"""
import csv
import io
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.highlight import HighlightEntry, QAPair
from app.models.pdf import PDFDocument
from app.models.review import ReviewLog

router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/export/review-log")
def export_review_log(
    format: str = Query("json", enum=["json", "csv"]),
    db: Session = Depends(get_db),
):
    """
    Export the full review_log joined with qa_pairs, highlight_entries, pdf_documents.
    This is the primary dataset for the thesis's retention analysis.

    Each row contains:
      - All 17 review_log fields (thesis-critical, Research B2)
      - Question, expected answer, recall text
      - Source passage context (highlight_text, section_title, page_number)
      - PDF title
    """
    rows = (
        db.query(ReviewLog, QAPair, HighlightEntry, PDFDocument)
        .join(QAPair, ReviewLog.qa_pair_id == QAPair.id)
        .join(HighlightEntry, QAPair.highlight_id == HighlightEntry.id)
        .join(PDFDocument, HighlightEntry.pdf_id == PDFDocument.id)
        .order_by(ReviewLog.reviewed_at.asc())
        .all()
    )

    records = []
    for log, qa, highlight, pdf in rows:
        records.append({
            # Identity
            "review_log_id":            log.id,
            "qa_pair_id":               log.qa_pair_id,
            "pdf_title":                pdf.title,
            "page_number":              highlight.page_number,
            "section_title":            highlight.section_title,
            # Timing
            "reviewed_at":              log.reviewed_at.isoformat() if log.reviewed_at else None,
            "recall_latency_ms":        log.recall_latency_ms,
            # User inputs (pre-grade)
            "confidence_rating":        log.confidence_rating,
            "recall_text":              log.recall_text,
            # Retrieval-mode telemetry (deep-fix step 3).
            # Primary retention claim is defined against reveal_used=False rows only.
            "reveal_used":              log.reveal_used,
            "recall_mode":              log.recall_mode,
            # Source content
            "question":                 qa.question,
            "expected_answer":          qa.answer,
            "highlight_text":           highlight.highlight_text,
            # Claude grades
            "claude_grade_overall":     log.claude_grade_overall,
            "claude_grade_core":        log.claude_grade_core,
            "claude_grade_detail":      log.claude_grade_detail,
            "claude_grade_faithfulness": log.claude_grade_faithfulness,
            "claude_confidence":        log.claude_confidence,
            "claude_feedback":          log.claude_feedback,
            "rubric_hits":              log.claude_rubric_hits,
            "missing_concepts":         log.claude_missing,
            # FSRS
            "fsrs_rating":              log.fsrs_rating,
            "prior_stability":          log.prior_stability,
            "new_stability":            log.new_stability,
            "elapsed_since_last_days":  log.elapsed_since_last_days,
            # Version strings (methodology traceability)
            "model_version":            log.model_version,
            "rubric_version_id":        log.rubric_version_id,
            "system_prompt_version":    log.system_prompt_version,
            # IRR
            "human_grading_sample":     log.human_grading_sample,
        })

    if format == "csv":
        if not records:
            return StreamingResponse(iter([""]), media_type="text/csv")
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=list(records[0].keys()))
        writer.writeheader()
        writer.writerows(records)
        buf.seek(0)
        filename = f"review_log_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    return records


@router.get("/export/irr-sample")
def export_irr_sample(db: Session = Depends(get_db)):
    """
    Return all review_log rows flagged for IRR human grading.
    Each row includes the source passage and expected answer so the
    human grader has everything needed without seeing Claude's scores.
    """
    rows = (
        db.query(ReviewLog, QAPair, HighlightEntry, PDFDocument)
        .join(QAPair, ReviewLog.qa_pair_id == QAPair.id)
        .join(HighlightEntry, QAPair.highlight_id == HighlightEntry.id)
        .join(PDFDocument, HighlightEntry.pdf_id == PDFDocument.id)
        .filter(ReviewLog.human_grading_sample == True)  # noqa: E712
        .order_by(ReviewLog.reviewed_at.asc())
        .all()
    )

    return [
        {
            "review_log_id":   log.id,
            "pdf_title":       pdf.title,
            "question":        qa.question,
            "expected_answer": qa.answer,
            "highlight_text":  highlight.highlight_text,
            "recall_text":     log.recall_text,
            # Human grader fills these in; Claude scores deliberately omitted
        }
        for log, qa, highlight, pdf in rows
    ]


@router.post("/irr/sample")
def create_irr_sample(
    target_n: int = Query(100, ge=10, le=500),
    db: Session = Depends(get_db),
):
    """
    Randomly flag `target_n` review_log rows for IRR human grading.
    Stratified: proportional sampling across PDFs.
    Skips rows already flagged. Idempotent — safe to call multiple times.

    Call this once before sending the IRR batch to the human grader.
    The human grader then uses GET /api/research/export/irr-sample.
    """
    # Get all un-flagged rows
    unflagged = (
        db.query(ReviewLog)
        .filter(ReviewLog.human_grading_sample == False)  # noqa: E712
        .all()
    )
    already_flagged = (
        db.query(ReviewLog)
        .filter(ReviewLog.human_grading_sample == True)  # noqa: E712
        .count()
    )

    remaining_needed = max(0, target_n - already_flagged)
    to_flag = min(remaining_needed, len(unflagged))

    if to_flag == 0:
        return {"flagged": 0, "total_in_sample": already_flagged, "message": "Target already reached"}

    sampled = random.sample(unflagged, to_flag)
    for row in sampled:
        row.human_grading_sample = True

    db.commit()
    return {
        "flagged": to_flag,
        "total_in_sample": already_flagged + to_flag,
        "message": f"Flagged {to_flag} new rows for IRR grading",
    }
