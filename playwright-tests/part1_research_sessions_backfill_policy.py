import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db.session import SessionLocal  # noqa: E402
from app.models.pdf import PDFDocument  # noqa: E402
from app.models.research_session import ResearchSession, ResearchSessionPDF  # noqa: E402
from app.services.research_session_service import ensure_default_research_sessions  # noqa: E402


def main():
    db = SessionLocal()
    doc = None
    title = f"scim-intelligent-skimming-policy-test-{uuid.uuid4()}"
    try:
        doc = PDFDocument(
            title=title,
            s3_key=f"policy-test/{uuid.uuid4()}.pdf",
            page_count=1,
            chunk_count=1,
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        ensure_default_research_sessions(db)
        db.refresh(doc)

        unsorted = db.query(ResearchSession).filter(ResearchSession.title == "Unsorted Research").first()
        if not unsorted:
            raise AssertionError("Unsorted Research session should exist")
        if doc.research_session_id != unsorted.id:
            raise AssertionError("Unassigned PDFs should backfill to Unsorted, not title-classified sessions")

        memberships = db.query(ResearchSessionPDF).filter(ResearchSessionPDF.pdf_id == doc.id).all()
        session_ids = sorted(m.research_session_id for m in memberships)
        if session_ids != [unsorted.id]:
            raise AssertionError(f"Expected exactly one Unsorted membership, got {session_ids}")

        print({
            "policy": "unassigned PDFs go to Unsorted",
            "pdf_id": doc.id,
            "session_id": doc.research_session_id,
        })
    finally:
        if doc is not None and doc.id is not None:
            db.query(ResearchSessionPDF).filter(ResearchSessionPDF.pdf_id == doc.id).delete(synchronize_session=False)
            existing = db.get(PDFDocument, doc.id)
            if existing:
                db.delete(existing)
            db.commit()
        db.close()


if __name__ == "__main__":
    main()
