from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Index, Integer, SmallInteger, String, Text, func
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.db.session import Base


class HighlightEntry(Base):
    __tablename__ = "highlight_entries"

    id                = Column(Integer, primary_key=True, index=True)
    pdf_id            = Column(Integer, ForeignKey("pdf_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    page_number       = Column(Integer)
    highlight_text    = Column(Text, nullable=False)
    highlight_texts   = Column(JSONB, default=list)       # all distinct selections in chunk
    chunk_id          = Column(String)                    # stable ChromaDB anchor
    section_title     = Column(String)
    section_path      = Column(JSONB, default=list)       # [{title, level}] from TOC
    deep_section_path = Column(JSONB)                     # body-level, nullable
    concepts          = Column(JSONB, default=list)       # string[] from Haiku
    note              = Column(Text, default="")
    synthesis         = Column(Text)                      # null until generated on demand
    deep_synthesis    = Column(Text)                      # null until user clicks "Dive deeper"
    starred           = Column(Boolean, default=False)
    flagged           = Column(Boolean, default=False)
    anchored          = Column(Boolean, default=False)
    reviewed          = Column(Boolean, default=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    qa_pairs = relationship("QAPair", back_populates="highlight_entry", cascade="all, delete-orphan")


class QAPair(Base):
    __tablename__ = "qa_pairs"

    id               = Column(Integer, primary_key=True, index=True)
    highlight_id     = Column(Integer, ForeignKey("highlight_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    question         = Column(Text, nullable=False)
    original_question = Column(Text)
    answer           = Column(Text, nullable=False)
    source_chunk_ids = Column(JSONB, default=list)   # ChromaDB IDs; resolve at review time
    selection_text   = Column(Text)                  # the specific text selected when this QA was created
    starred          = Column(Boolean, default=False)

    # FSRS state inline (Research B1: no separate memory_items table)
    stability        = Column(Float, default=0.0)
    difficulty       = Column(Float, default=0.3)
    step             = Column(Integer, default=0)   # learning step within current state (fsrs v6)
    elapsed_days     = Column(Integer, default=0)
    scheduled_days   = Column(Integer, default=0)
    reps             = Column(Integer, default=0)
    lapses           = Column(Integer, default=0)
    state            = Column(String(12), default="new")   # new|learning|review|relearning
    due_at           = Column(DateTime(timezone=True), server_default=func.now())
    last_review      = Column(DateTime(timezone=True))
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    highlight_entry  = relationship("HighlightEntry", back_populates="qa_pairs")
    review_logs      = relationship("ReviewLog", back_populates="qa_pair")


# Partial index for due-card queries — only include non-suspended cards
Index("ix_qa_pairs_due_at_active", QAPair.due_at, postgresql_where=(QAPair.state != "suspended"))
