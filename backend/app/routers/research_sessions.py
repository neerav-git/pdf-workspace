from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.pdf import PDFDocument
from app.models.research_session import ResearchSession, ResearchSessionPDF
from app.services.research_session_service import (
    DEFAULT_SESSIONS,
    add_pdf_membership,
    ensure_default_research_sessions,
    get_or_create_session,
    remove_pdf_membership,
    replace_pdf_memberships,
    suggest_pdf_session_placements,
    suggest_research_session_from_pdfs,
)
from app.services.comparative_analysis_service import build_comparative_analysis, refresh_ai_comparative_analysis

router = APIRouter(prefix="/api/research-sessions", tags=["research-sessions"])


class SessionPDFResponse(BaseModel):
    id: int
    title: str
    s3_key: str
    page_count: int
    chunk_count: int
    ontology_json: Optional[dict[str, Any]] = None
    research_session_id: Optional[int] = None

    model_config = {"from_attributes": True}


class ResearchSessionResponse(BaseModel):
    id: int
    title: str
    topic: str
    context: str
    ontology_json: Optional[dict[str, Any]] = None
    learning_takeaways_json: Optional[dict[str, Any]] = None
    created_at: Any
    updated_at: Optional[Any] = None
    pdf_count: int
    pdfs: list[SessionPDFResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ResearchSessionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    topic: str = Field("", max_length=300)
    context: str = ""


class ResearchSessionPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    topic: Optional[str] = Field(None, max_length=300)
    context: Optional[str] = None
    ontology_json: Optional[dict[str, Any]] = None
    learning_takeaways_json: Optional[dict[str, Any]] = None


class ResearchSessionSuggestionRequest(BaseModel):
    pdf_ids: list[int] = Field(default_factory=list)


class ResearchSessionSuggestionResponse(BaseModel):
    title: str
    topic: str
    context: str
    candidate_pdf_ids: list[int] = Field(default_factory=list)
    rationale: str


class PlacementSuggestion(BaseModel):
    session_id: int
    session_title: str
    confidence: int
    rationale: str


class PlacementSuggestionResponse(BaseModel):
    pdf_id: int
    pdf_title: str
    suggestions: list[PlacementSuggestion] = Field(default_factory=list)


def _session_to_response(session: ResearchSession) -> ResearchSessionResponse:
    pdfs_by_id = {}
    for membership in session.memberships or []:
        if membership.pdf:
            pdfs_by_id[membership.pdf.id] = membership.pdf
    pdfs = sorted(pdfs_by_id.values(), key=lambda p: (p.created_at is None, p.created_at), reverse=True)
    return ResearchSessionResponse(
        id=session.id,
        title=session.title,
        topic=session.topic or "",
        context=session.context or "",
        ontology_json=session.ontology_json,
        learning_takeaways_json=session.learning_takeaways_json,
        created_at=session.created_at,
        updated_at=session.updated_at,
        pdf_count=len(pdfs),
        pdfs=pdfs,
    )


def _get_session_or_404(session_id: int, db: Session) -> ResearchSession:
    session = db.get(ResearchSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Research session not found")
    return session


@router.get("", response_model=list[ResearchSessionResponse])
def list_research_sessions(db: Session = Depends(get_db)):
    """Return all research sessions with nested PDFs."""
    # Keeps old databases usable even if startup backfill was interrupted.
    ensure_default_research_sessions(db)
    sessions = db.query(ResearchSession).order_by(ResearchSession.created_at.asc()).all()
    return [_session_to_response(session) for session in sessions]


@router.post("", response_model=ResearchSessionResponse, status_code=201)
def create_research_session(body: ResearchSessionCreate, db: Session = Depends(get_db)):
    existing = db.query(ResearchSession).filter(ResearchSession.title == body.title.strip()).first()
    if existing:
        raise HTTPException(status_code=409, detail="A research session with this title already exists")
    session = ResearchSession(
        title=body.title.strip(),
        topic=(body.topic or "").strip(),
        context=(body.context or "").strip(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_to_response(session)


@router.post("/suggest", response_model=ResearchSessionSuggestionResponse)
def suggest_research_session(body: ResearchSessionSuggestionRequest, db: Session = Depends(get_db)):
    query = db.query(PDFDocument)
    if body.pdf_ids:
        query = query.filter(PDFDocument.id.in_(body.pdf_ids))
    pdfs = query.order_by(PDFDocument.created_at.desc()).all()
    return suggest_research_session_from_pdfs(pdfs)


@router.get("/suggest-placement/{pdf_id}", response_model=PlacementSuggestionResponse)
def suggest_pdf_placement(pdf_id: int, db: Session = Depends(get_db)):
    pdf = db.get(PDFDocument, pdf_id)
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    return suggest_pdf_session_placements(db, pdf=pdf)


@router.patch("/{session_id}", response_model=ResearchSessionResponse)
def patch_research_session(
    session_id: int,
    body: ResearchSessionPatch,
    db: Session = Depends(get_db),
):
    session = _get_session_or_404(session_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        if isinstance(value, str):
            value = value.strip()
        setattr(session, field, value)
    db.commit()
    db.refresh(session)
    return _session_to_response(session)


@router.get("/{session_id}/comparative-analysis")
def comparative_analysis(session_id: int, db: Session = Depends(get_db)):
    session = _get_session_or_404(session_id, db)
    return build_comparative_analysis(db, session)


@router.post("/{session_id}/comparative-analysis/refresh")
def refresh_comparative_analysis(session_id: int, db: Session = Depends(get_db)):
    session = _get_session_or_404(session_id, db)
    try:
        return refresh_ai_comparative_analysis(db, session)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=f"Could not generate AI comparative analysis: {exc}") from exc


@router.delete("/{session_id}", status_code=204)
def delete_research_session(
    session_id: int,
    move_to_unsorted: bool = Query(True, description="Move contained PDFs to Unsorted Research before deletion."),
    db: Session = Depends(get_db),
):
    session = _get_session_or_404(session_id, db)
    memberships = list(session.memberships or [])
    pdfs = [membership.pdf for membership in memberships if membership.pdf]
    if pdfs and not move_to_unsorted:
        raise HTTPException(status_code=409, detail="Session contains PDFs")

    if pdfs:
        unsorted = get_or_create_session(db, **DEFAULT_SESSIONS["unsorted"])
        for pdf in pdfs:
            other_membership = (
                db.query(ResearchSessionPDF)
                .filter(
                    ResearchSessionPDF.pdf_id == pdf.id,
                    ResearchSessionPDF.research_session_id != session.id,
                )
                .first()
            )
            if pdf.research_session_id == session.id:
                pdf.research_session_id = other_membership.research_session_id if other_membership else unsorted.id
                db.add(pdf)
            if not other_membership:
                add_pdf_membership(
                    db,
                    session_id=unsorted.id,
                    pdf_id=pdf.id,
                    role="primary",
                    assignment_source="delete_move",
                )

    db.delete(session)
    db.commit()


@router.post("/{session_id}/pdfs/{pdf_id}", response_model=ResearchSessionResponse)
def assign_pdf_to_session(
    session_id: int,
    pdf_id: int,
    replace_existing: bool = Query(True, description="Replace other memberships for current single-session UI compatibility."),
    db: Session = Depends(get_db),
):
    session = _get_session_or_404(session_id, db)
    pdf = db.get(PDFDocument, pdf_id)
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    if replace_existing:
        replace_pdf_memberships(db, pdf_id=pdf.id, session_id=session.id)
        pdf.research_session_id = session.id
    else:
        add_pdf_membership(db, session_id=session.id, pdf_id=pdf.id)
        if pdf.research_session_id is None:
            pdf.research_session_id = session.id
    db.add(pdf)
    db.commit()
    db.refresh(session)
    return _session_to_response(session)


@router.delete("/{session_id}/pdfs/{pdf_id}", response_model=ResearchSessionResponse)
def remove_pdf_from_session(session_id: int, pdf_id: int, db: Session = Depends(get_db)):
    session = _get_session_or_404(session_id, db)
    pdf = db.get(PDFDocument, pdf_id)
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    remove_pdf_membership(db, session_id=session.id, pdf_id=pdf.id)
    db.commit()
    db.refresh(session)
    return _session_to_response(session)


@router.post("/backfill-defaults")
def backfill_default_research_sessions(db: Session = Depends(get_db)):
    """Idempotent maintenance endpoint for tests and manual repair."""
    return {"sessions": ensure_default_research_sessions(db)}
