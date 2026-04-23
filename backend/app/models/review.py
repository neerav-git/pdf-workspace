from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.db.session import Base


class RubricVersion(Base):
    __tablename__ = "rubric_versions"

    id           = Column(String(50), primary_key=True)   # e.g. "v1.0"
    rubric_json  = Column(JSONB)
    system_prompt = Column(Text)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    frozen_at    = Column(DateTime(timezone=True))        # set when locked for study

    review_logs  = relationship("ReviewLog", back_populates="rubric_version")


class PromptVersion(Base):
    __tablename__ = "prompt_versions"

    id           = Column(String(50), primary_key=True)   # e.g. "chat_v1.0"
    prompt_text  = Column(Text)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    frozen_at    = Column(DateTime(timezone=True))


class ReviewLog(Base):
    """
    Thesis-critical: every row is a data point for primary + secondary analyses.
    All 17 fields are required — do not omit to simplify. (Research B2)
    """
    __tablename__ = "review_log"

    id                        = Column(Integer, primary_key=True, index=True)
    qa_pair_id                = Column(Integer, ForeignKey("qa_pairs.id"), nullable=False, index=True)
    rubric_version_id         = Column(String(50), ForeignKey("rubric_versions.id"))
    reviewed_at               = Column(DateTime(timezone=True), server_default=func.now())

    # User inputs (collected before grade reveal — Research D2)
    confidence_rating         = Column(SmallInteger)    # 1-5 pre-grade self-rating
    recall_text               = Column(Text)
    recall_latency_ms         = Column(Integer)         # card-shown → submit

    # Claude grades (3-dimensional analytical rubric — Research C1)
    claude_grade_overall      = Column(SmallInteger)    # mean of 3 dimensions
    claude_grade_core         = Column(SmallInteger)
    claude_grade_detail       = Column(SmallInteger)
    claude_grade_faithfulness = Column(SmallInteger)
    claude_confidence         = Column(SmallInteger)    # Claude's self-reported 1-5 (Ferrer 2026)
    claude_rubric_hits        = Column(JSONB)
    claude_missing            = Column(JSONB)
    claude_feedback           = Column(Text)

    # FSRS transition (store both for post-hoc re-analysis if mapping changes — Research A3)
    fsrs_rating               = Column(SmallInteger)    # derived 1-4 that fed FSRS
    prior_stability           = Column(Float)
    new_stability             = Column(Float)
    elapsed_since_last_days   = Column(Float)

    # Version strings — essential for methodology reporting
    model_version             = Column(String(100))     # e.g. "claude-sonnet-4-20250514"
    system_prompt_version     = Column(String(50))

    # IRR sub-study flag
    human_grading_sample      = Column(Boolean, default=False)

    qa_pair      = relationship("QAPair", back_populates="review_logs")
    rubric_version = relationship("RubricVersion", back_populates="review_logs")
    human_grades = relationship("HumanGrade", back_populates="review_log_entry")


class SessionEvent(Base):
    """
    Engagement logging. Home for visual_chat and feynman sessions, and
    (deep-fix step 2) dedup-modal choice events.
    These must NOT go in review_log. (Research E2, K2, L2)
    """
    __tablename__ = "session_events"

    id              = Column(Integer, primary_key=True, index=True)
    session_type    = Column(String(20))   # review|quiz|read|chat|visual_chat|feynman|dedup_choice
    pdf_id          = Column(Integer, ForeignKey("pdf_documents.id"))
    started_at      = Column(DateTime(timezone=True))
    ended_at        = Column(DateTime(timezone=True))
    item_count      = Column(Integer)
    condition_label = Column(String(20))   # for study participants only
    meta_json       = Column(JSONB)        # free-form payload (e.g. dedup choice + similarity)


class HumanGrade(Base):
    """
    IRR sub-study storage. Human grader scores joined to review_log rows.
    Target ICC >= 0.75 (Koo & Li 2016). (Research E4)
    """
    __tablename__ = "human_grades"

    id                 = Column(Integer, primary_key=True, index=True)
    review_log_id      = Column(Integer, ForeignKey("review_log.id"), nullable=False)
    graded_at          = Column(DateTime(timezone=True), server_default=func.now())
    human_core         = Column(SmallInteger)
    human_detail       = Column(SmallInteger)
    human_faithfulness = Column(SmallInteger)
    grader_id          = Column(String(50))   # anonymized

    review_log_entry = relationship("ReviewLog", back_populates="human_grades")
