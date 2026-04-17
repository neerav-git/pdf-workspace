"""
Grading service — LLM-graded generative recall with FSRS scheduling.

This is the thesis's core contribution (Research Gap 1):
  Replacing user self-rated SRS signals with LLM-graded generative recall.

Cardinal rules enforced here:
  - Claude grades the INTERVENTION (tool use). Claude must NOT grade the outcome test.
  - FSRS rating comes from Claude's overall score, NOT the user's confidence.
  - temperature=0, pinned model string, rubric + prompt versions logged on every call.
  - RAG-grounded grading: source chunks passed to Claude (Research C6).

Research refs: A1-A3, B2, B4, C1-C6.
"""
import json
import logging
from datetime import datetime, timezone

from anthropic import Anthropic
from fsrs import Card, Rating, Scheduler, State

from app.core.config import settings
from app.services.chroma_service import _get_collection

logger = logging.getLogger(__name__)

# ── Pinned constants — FREEZE before main study data collection (Research C5) ──
GRADING_MODEL         = "claude-sonnet-4-20250514"
DEFAULT_RUBRIC_VERSION = "v1.0"
DEFAULT_PROMPT_VERSION = "grading_v1.0"

# FSRS scheduler — frozen default weights for pre-registered study period (Research A2)
# Do NOT enable per-user parameter optimization until after the study is complete.
_scheduler = Scheduler()

_anthropic: Anthropic | None = None


def _get_anthropic() -> Anthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic


# ── Grading prompt (Research C1-C3, C6) ───────────────────────────────────────
# IMPORTANT: This is NOT the response template. Do not conflate these.
# This prompt is grading-specific and uses the analytical 3-dimensional rubric.

GRADING_SYSTEM_PROMPT = """\
You are a rigorous academic grader evaluating a student's recall of a specific passage.

Your task: compare the student's typed recall against the SOURCE PASSAGE and the EXPECTED ANSWER,
using the three-dimensional analytical rubric below.

RUBRIC (score each dimension 1–5):

1. CORE_CLAIM (1–5)
   Does the recall capture the central claim or key idea of the source passage?
   5 = Precisely captures the main claim in the student's own words
   4 = Captures the main claim with minor omissions
   3 = Captures part of the main claim or paraphrases imprecisely
   2 = Tangentially related to the main claim but misses it
   1 = Off-topic or contradicts the main claim

2. SUPPORTING_DETAIL (1–5)
   Does the recall include accurate supporting mechanisms, evidence, or specifics?
   5 = Key supporting details are present and accurate
   4 = Most supporting details present with minor gaps
   3 = Some supporting details but significant gaps
   2 = Minimal supporting detail, mostly assertion
   1 = No supporting detail or details are fabricated

3. FAITHFULNESS (1–5) — confabulation detector
   Are all claims in the recall actually supported by the source passage?
   5 = Every claim is directly supported by the source
   4 = Nearly all claims supported; one minor extrapolation
   3 = Some claims unsupported but no outright errors
   2 = Noticeable claims that go beyond or contradict the source
   1 = Significant fabrication or hallucination of content

RESPONSE FORMAT (return ONLY valid JSON, no prose before or after):
{
  "core_claim_score": <int 1-5>,
  "core_claim_rationale": "<one sentence>",
  "supporting_detail_score": <int 1-5>,
  "supporting_detail_rationale": "<one sentence>",
  "faithfulness_score": <int 1-5>,
  "faithfulness_rationale": "<one sentence>",
  "rubric_hits": ["<key concept correctly recalled>", ...],
  "missing": ["<key concept not mentioned>", ...],
  "confidence": <int 1-5>,
  "feedback": "<2–3 sentences of plain-language feedback for the student>"
}

confidence: your own calibration signal — how confident are you in this grading (1=very uncertain, 5=certain)?
rubric_hits: list the specific concepts or facts the student got right (for analytics)
missing: list the important concepts the student did not mention (for analytics)
feedback: direct, constructive, encouraging — tell the student what they got right and what to strengthen
"""


GRADING_USER_TEMPLATE = """\
SOURCE PASSAGE:
{source_text}

QUESTION:
{question}

EXPECTED ANSWER:
{expected_answer}

STUDENT'S TYPED RECALL:
{recall_text}
"""


# ── FSRS helpers ──────────────────────────────────────────────────────────────

# DB state string → (fsrs.State, step)
# fsrs v6 has no 'new' state — an unreviewed card is State.Learning at step 0
_DB_STATE_TO_FSRS: dict[str, tuple[State, int | None]] = {
    "new":        (State.Learning, 0),
    "learning":   (State.Learning, 1),
    "review":     (State.Review,   None),
    "relearning": (State.Relearning, 0),
}

_FSRS_STATE_TO_DB: dict[State, str] = {
    State.Learning:   "learning",
    State.Review:     "review",
    State.Relearning: "relearning",
}

# Claude overall score → FSRS rating (Research A3)
# Store BOTH the raw score AND the derived rating in review_log so the mapping
# can be revised post-hoc without re-running grading.
_CLAUDE_TO_FSRS_RATING: dict[int, Rating] = {
    1: Rating.Again,
    2: Rating.Hard,
    3: Rating.Good,
    4: Rating.Easy,
    5: Rating.Easy,
}


def reconstruct_card(qa) -> Card:
    """
    Reconstruct an fsrs.Card from a QAPair ORM row.
    Called before every review to get the current card state.
    """
    db_state = qa.state or "new"
    fsrs_state, default_step = _DB_STATE_TO_FSRS.get(db_state, (State.Learning, 0))
    step = qa.step if qa.step is not None else (default_step or 0)

    return Card(
        state=fsrs_state,
        step=step if fsrs_state != State.Review else None,
        stability=qa.stability if qa.stability and qa.stability > 0 else None,
        difficulty=qa.difficulty if qa.difficulty and qa.difficulty > 0 else None,
        due=qa.due_at or datetime.now(timezone.utc),
        last_review=qa.last_review,
    )


def persist_card_to_qa(qa, card: Card) -> None:
    """
    Write all FSRS Card fields back to the QAPair ORM object.
    Caller must commit the session.
    """
    qa.state      = _FSRS_STATE_TO_DB.get(card.state, "learning")
    qa.step       = card.step if card.step is not None else 0
    qa.stability  = card.stability or 0.0
    qa.difficulty = card.difficulty or 0.3
    qa.due_at     = card.due
    qa.last_review = datetime.now(timezone.utc)
    qa.reps       = (qa.reps or 0) + 1


# ── ChromaDB source fetch ─────────────────────────────────────────────────────

def get_source_text(chunk_ids: list[str]) -> str:
    """
    Fetch source passages from ChromaDB by chunk IDs.
    Returns concatenated text for the grading prompt (Research C6).
    Falls back to empty string if chunks not found — grading will flag low faithfulness.
    """
    if not chunk_ids:
        return ""
    try:
        collection = _get_collection()
        result = collection.get(ids=chunk_ids, include=["documents"])
        passages = [doc for doc in result.get("documents", []) if doc]
        return "\n\n---\n\n".join(passages)
    except Exception as e:
        logger.warning("Could not fetch source chunks %s: %s", chunk_ids, e)
        return ""


# ── Claude grading ─────────────────────────────────────────────────────────────

def run_grading(
    source_text: str,
    question: str,
    expected_answer: str,
    recall_text: str,
) -> dict:
    """
    Call Claude with the analytical rubric and return parsed JSON grades.
    temperature=0, pinned model (Research C5).
    Returns the grade dict on success; returns a safe fallback on any error.
    """
    client = _get_anthropic()
    user_msg = GRADING_USER_TEMPLATE.format(
        source_text=source_text or "[Source passage not available]",
        question=question,
        expected_answer=expected_answer,
        recall_text=recall_text,
    )

    try:
        response = client.messages.create(
            model=GRADING_MODEL,
            max_tokens=1024,
            temperature=0,
            system=GRADING_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("Grading JSON parse failed: %s | raw: %s", e, raw[:200])
        return _fallback_grade()
    except Exception as e:
        logger.error("Grading Claude call failed: %s", e)
        return _fallback_grade()


def _fallback_grade() -> dict:
    """Safe fallback when grading fails — scores to 3 (neutral) with low confidence."""
    return {
        "core_claim_score": 3,
        "core_claim_rationale": "Grading unavailable",
        "supporting_detail_score": 3,
        "supporting_detail_rationale": "Grading unavailable",
        "faithfulness_score": 3,
        "faithfulness_rationale": "Grading unavailable",
        "rubric_hits": [],
        "missing": [],
        "confidence": 1,
        "feedback": "Could not grade this response automatically. Please self-assess.",
    }


def compute_overall_score(grades: dict) -> int:
    """Round the mean of three dimension scores to int (1–5)."""
    scores = [
        grades.get("core_claim_score", 3),
        grades.get("supporting_detail_score", 3),
        grades.get("faithfulness_score", 3),
    ]
    return round(sum(scores) / 3)


# ── Ensure default rubric version exists ─────────────────────────────────────

def ensure_default_rubric_version(db) -> None:
    """
    Seed the default rubric and prompt versions if they don't exist.
    Called once from app lifespan. (Research B4, C4)
    """
    from app.models.review import RubricVersion, PromptVersion

    if not db.get(RubricVersion, DEFAULT_RUBRIC_VERSION):
        db.add(RubricVersion(
            id=DEFAULT_RUBRIC_VERSION,
            system_prompt=GRADING_SYSTEM_PROMPT,
            rubric_json={
                "dimensions": ["core_claim", "supporting_detail", "faithfulness"],
                "scale": "1-5",
                "overall": "mean(dimensions)",
            },
        ))

    if not db.get(PromptVersion, DEFAULT_PROMPT_VERSION):
        db.add(PromptVersion(
            id=DEFAULT_PROMPT_VERSION,
            prompt_text=GRADING_SYSTEM_PROMPT,
        ))

    db.commit()
