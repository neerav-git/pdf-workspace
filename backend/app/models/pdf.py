from sqlalchemy import Column, ForeignKey, Integer, String, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.db.session import Base


class PDFDocument(Base):
    __tablename__ = "pdf_documents"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    s3_key = Column(String, nullable=False)
    page_count = Column(Integer, nullable=False, default=0)
    chunk_count = Column(Integer, nullable=False, default=0)
    ontology_json = Column(JSONB)
    research_session_id = Column(Integer, ForeignKey("research_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    research_session = relationship("ResearchSession", back_populates="pdfs")
    research_session_memberships = relationship(
        "ResearchSessionPDF",
        back_populates="pdf",
        cascade="all, delete-orphan",
    )
