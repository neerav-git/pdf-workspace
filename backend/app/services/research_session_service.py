from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.pdf import PDFDocument
from app.models.research_session import ResearchSession, ResearchSessionPDF


DEFAULT_SESSIONS = {
    "learning_design": {
        "title": "Learning Design Research",
        "topic": "Learning interface design",
        "context": (
            "Research on learning interfaces, skimming, guided comprehension, "
            "retrieval practice, readable scientific papers, and tools that help "
            "readers turn document exploration into durable understanding."
        ),
    },
    "medical_encyclopedia": {
        "title": "Medical Encyclopedia",
        "topic": "Medical reference",
        "context": (
            "Reference material for medical concepts, terminology, conditions, "
            "diagnosis, treatments, and clinical background. Keep this separate "
            "from learning-interface research sessions."
        ),
    },
    "unsorted": {
        "title": "Unsorted Research",
        "topic": "Unsorted PDFs",
        "context": (
            "PDFs that have not yet been assigned to a focused research session. "
            "Move these into a session once their research purpose is clear."
        ),
    },
}


def get_or_create_session(
    db: Session,
    *,
    title: str,
    topic: str,
    context: str,
) -> ResearchSession:
    session = db.query(ResearchSession).filter(ResearchSession.title == title).first()
    if session:
        changed = False
        if not session.topic and topic:
            session.topic = topic
            changed = True
        if not session.context and context:
            session.context = context
            changed = True
        if changed:
            db.add(session)
            db.flush()
        return session

    session = ResearchSession(title=title, topic=topic, context=context)
    db.add(session)
    db.flush()
    return session


def classify_pdf_for_default_session(title: str) -> str:
    lower = (title or "").lower()
    if "medical_book" in lower or "medical book" in lower:
        return "medical_encyclopedia"
    if "making medical research papers approachable" in lower:
        return "learning_design"
    if "knowledge-aware retrieval" in lower:
        return "learning_design"
    if "scim" in lower or "intelligent skimming" in lower:
        return "learning_design"
    return "unsorted"


def get_unsorted_session(db: Session) -> ResearchSession:
    return get_or_create_session(db, **DEFAULT_SESSIONS["unsorted"])


def add_pdf_membership(
    db: Session,
    *,
    session_id: int,
    pdf_id: int,
    role: str = "primary",
    assignment_source: str = "manual",
    confidence: int | None = None,
) -> ResearchSessionPDF:
    membership = (
        db.query(ResearchSessionPDF)
        .filter(
            ResearchSessionPDF.research_session_id == session_id,
            ResearchSessionPDF.pdf_id == pdf_id,
        )
        .first()
    )
    if membership:
        membership.role = role
        membership.assignment_source = assignment_source
        membership.confidence = confidence
        db.add(membership)
        return membership

    membership = ResearchSessionPDF(
        research_session_id=session_id,
        pdf_id=pdf_id,
        role=role,
        assignment_source=assignment_source,
        confidence=confidence,
    )
    db.add(membership)
    return membership


def remove_pdf_membership(
    db: Session,
    *,
    session_id: int,
    pdf_id: int,
) -> None:
    db.query(ResearchSessionPDF).filter(
        ResearchSessionPDF.research_session_id == session_id,
        ResearchSessionPDF.pdf_id == pdf_id,
    ).delete(synchronize_session=False)

    pdf = db.get(PDFDocument, pdf_id)
    if not pdf:
        return

    remaining = (
        db.query(ResearchSessionPDF)
        .filter(ResearchSessionPDF.pdf_id == pdf_id)
        .order_by(ResearchSessionPDF.created_at.asc(), ResearchSessionPDF.id.asc())
        .all()
    )
    if remaining:
        if pdf.research_session_id == session_id or pdf.research_session_id is None:
            pdf.research_session_id = remaining[0].research_session_id
            db.add(pdf)
        return

    unsorted = get_unsorted_session(db)
    pdf.research_session_id = unsorted.id
    db.add(pdf)
    add_pdf_membership(
        db,
        session_id=unsorted.id,
        pdf_id=pdf_id,
        role="primary",
        assignment_source="fallback_unsorted",
    )


def replace_pdf_memberships(
    db: Session,
    *,
    pdf_id: int,
    session_id: int,
    assignment_source: str = "manual",
) -> None:
    db.query(ResearchSessionPDF).filter(ResearchSessionPDF.pdf_id == pdf_id).delete(synchronize_session=False)
    add_pdf_membership(
        db,
        session_id=session_id,
        pdf_id=pdf_id,
        role="primary",
        assignment_source=assignment_source,
    )


def suggest_research_session_from_pdfs(pdfs: list[PDFDocument]) -> dict:
    """
    Deterministic advisory session suggestion.

    This intentionally avoids LLM calls in the first interactive version: the
    output must be predictable, editable, and safe to ignore before Save.
    """
    titles = [pdf.title for pdf in pdfs if pdf.title]
    lower_titles = " ".join(titles).lower()
    candidate_ids = [pdf.id for pdf in pdfs]

    if not pdfs:
        return {
            "title": "New Research Session",
            "topic": "Research topic",
            "context": "Describe what you are trying to learn, compare, or retain from this session.",
            "candidate_pdf_ids": [],
            "rationale": "No PDFs were selected, so this is a blank editable starting point.",
        }

    if any("medical_book" in t.lower() or "medical book" in t.lower() for t in titles):
        medical_ids = [
            pdf.id for pdf in pdfs
            if "medical_book" in (pdf.title or "").lower() or "medical book" in (pdf.title or "").lower()
        ]
        return {
            "title": "Medical Encyclopedia",
            "topic": "Medical reference",
            "context": DEFAULT_SESSIONS["medical_encyclopedia"]["context"],
            "candidate_pdf_ids": medical_ids,
            "rationale": "The selected titles look like medical reference material rather than interface-design research.",
        }

    learning_markers = (
        "learning", "retrieval", "retention", "skimming", "paper plain",
        "readability", "research papers approachable", "interface", "students",
    )
    if any(marker in lower_titles for marker in learning_markers):
        learning_ids = [
            pdf.id for pdf in pdfs
            if any(marker in (pdf.title or "").lower() for marker in learning_markers)
        ] or candidate_ids
        return {
            "title": "Learning Design Research",
            "topic": "Learning interface design",
            "context": DEFAULT_SESSIONS["learning_design"]["context"],
            "candidate_pdf_ids": learning_ids,
            "rationale": "The titles cluster around learning, readability, retrieval, skimming, or research-paper support.",
        }

    compact_titles = "; ".join(titles[:3])
    suffix = " and related PDFs" if len(titles) > 3 else ""
    return {
        "title": "Focused Research Session",
        "topic": "Research synthesis",
        "context": (
            f"Use this session to organize findings, concepts, review questions, "
            f"and future comparisons across: {compact_titles}{suffix}."
        ),
        "candidate_pdf_ids": candidate_ids,
        "rationale": "The selected PDFs do not match a known default cluster, so the suggestion stays generic and editable.",
    }


def suggest_pdf_session_placements(
    db: Session,
    *,
    pdf: PDFDocument,
    limit: int = 4,
) -> dict:
    ensure_default_research_sessions(db)
    sessions = db.query(ResearchSession).order_by(ResearchSession.created_at.asc()).all()
    title = pdf.title or ""
    title_tokens = set(_tokens(title))
    title_lower = title.lower()
    results = []

    for session in sessions:
        if session.title == DEFAULT_SESSIONS["unsorted"]["title"]:
            continue
        session_text = " ".join([session.title or "", session.topic or "", session.context or ""])
        session_lower = session_text.lower()
        session_tokens = set(_tokens(session_text))
        overlap = title_tokens.intersection(session_tokens)
        score = min(45, len(overlap) * 9)
        reasons = []

        if overlap:
            reasons.append(f"shares terms: {', '.join(sorted(overlap)[:4])}")

        if _looks_like_learning_design(title_lower) and _session_mentions(session_lower, ("learning", "interface", "skimming", "reading", "retrieval")):
            score += 55
            reasons.append("title matches learning/interface research signals")

        if _looks_like_medical_reference(title_lower) and _session_mentions(session_lower, ("medical", "medicine", "encyclopedia", "reference", "clinical")):
            score += 55
            reasons.append("title matches medical reference signals")

        if score <= 0:
            continue

        results.append({
            "session_id": session.id,
            "session_title": session.title,
            "confidence": min(98, max(20, score)),
            "rationale": "; ".join(reasons) or "weak title/session metadata match",
        })

    results.sort(key=lambda item: item["confidence"], reverse=True)

    unsorted = get_unsorted_session(db)
    results.append({
        "session_id": unsorted.id,
        "session_title": unsorted.title,
        "confidence": 100 if not results else 25,
        "rationale": (
            "Default safe inbox. Keep the PDF here until you explicitly place it."
            if results else
            "No confident session match was found, so Unsorted is safest."
        ),
    })
    return {
        "pdf_id": pdf.id,
        "pdf_title": pdf.title,
        "suggestions": results[:limit],
    }


def ensure_default_research_sessions(db: Session) -> dict[str, int]:
    """
    Idempotently create default sessions and maintain membership backfill.

    This is safe to run on every backend startup: existing PDF ids, highlights,
    Q&A rows, review logs, Chroma chunks, S3 keys, and selected-pdf behavior are
    untouched. Existing assigned PDFs keep their session. Unassigned PDFs go to
    Unsorted Research rather than being silently title-classified.
    """
    sessions: dict[str, ResearchSession] = {}
    for key, payload in DEFAULT_SESSIONS.items():
        sessions[key] = get_or_create_session(db, **payload)

    unassigned = db.query(PDFDocument).filter(PDFDocument.research_session_id.is_(None)).all()
    for pdf in unassigned:
        pdf.research_session_id = sessions["unsorted"].id
        db.add(pdf)

    db.flush()
    backfill_pdf_memberships(db)

    db.commit()
    return {key: session.id for key, session in sessions.items()}


def backfill_pdf_memberships(db: Session) -> None:
    """
    Mirror legacy primary session assignments into research_session_pdfs.

    This is additive: it never removes existing memberships, which keeps the
    model ready for multi-session PDFs while preserving today's organization.
    """
    docs = db.query(PDFDocument).filter(PDFDocument.research_session_id.isnot(None)).all()
    for doc in docs:
        add_pdf_membership(
            db,
            session_id=doc.research_session_id,
            pdf_id=doc.id,
            role="primary",
            assignment_source="backfill",
        )


def add_pdf_to_unsorted(db: Session, pdf: PDFDocument, assignment_source: str = "upload") -> PDFDocument:
    unsorted = get_unsorted_session(db)
    pdf.research_session_id = unsorted.id
    db.add(pdf)
    db.flush()
    add_pdf_membership(
        db,
        session_id=unsorted.id,
        pdf_id=pdf.id,
        role="primary",
        assignment_source=assignment_source,
    )
    return pdf


def _tokens(text: str) -> list[str]:
    stop = {
        "the", "and", "for", "with", "from", "this", "that", "pdf", "paper",
        "papers", "research", "session", "support", "vol", "volume",
    }
    return [tok for tok in re.findall(r"[a-z0-9]+", text.lower()) if len(tok) > 3 and tok not in stop]


def _session_mentions(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _looks_like_learning_design(title: str) -> bool:
    return any(term in title for term in (
        "learning", "retrieval", "retention", "skimming", "paper plain",
        "readability", "research papers approachable", "interface", "students",
        "scientific papers",
    ))


def _looks_like_medical_reference(title: str) -> bool:
    return any(term in title for term in (
        "medical", "medicine", "encyclopedia", "gale", "clinical", "disease",
        "diagnosis", "treatment",
    ))
