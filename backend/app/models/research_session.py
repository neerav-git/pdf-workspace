from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.db.session import Base


class ResearchSession(Base):
    """
    User-facing research workspace.

    This is intentionally separate from SessionEvent, which is telemetry. A
    ResearchSession groups PDFs and carries the user's topic/context for later
    comparative analysis and learning-graph construction.
    """

    __tablename__ = "research_sessions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    topic = Column(String(300), nullable=False, default="")
    context = Column(Text, nullable=False, default="")

    # Reserved for the comparative-analysis layer. These stay nullable until
    # the session-level ontology/takeaway pipeline is implemented.
    ontology_json = Column(JSONB)
    learning_takeaways_json = Column(JSONB)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    pdfs = relationship("PDFDocument", back_populates="research_session")
    memberships = relationship(
        "ResearchSessionPDF",
        back_populates="session",
        cascade="all, delete-orphan",
    )


class ResearchSessionPDF(Base):
    """
    Many-to-many membership between sessions and PDFs.

    The legacy pdf_documents.research_session_id remains as a primary/default
    session pointer for compatibility, but comparative analysis should use this
    table so one PDF can participate in multiple research sessions later.
    """

    __tablename__ = "research_session_pdfs"
    __table_args__ = (
        UniqueConstraint("research_session_id", "pdf_id", name="uq_research_session_pdf"),
    )

    id = Column(Integer, primary_key=True, index=True)
    research_session_id = Column(Integer, ForeignKey("research_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    pdf_id = Column(Integer, ForeignKey("pdf_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(40), nullable=False, default="primary")
    assignment_source = Column(String(40), nullable=False, default="manual")
    confidence = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ResearchSession", back_populates="memberships")
    pdf = relationship("PDFDocument", back_populates="research_session_memberships")
