from __future__ import annotations

import json
import math
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from anthropic import Anthropic
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.highlight import HighlightEntry, QAPair
from app.models.pdf import PDFDocument
from app.services import chroma_service, s3_service, toc_service
from app.services.chat_service import extract_concepts, prepare_study_card_question
from app.services.embedding_service import embed

HAIKU_MODEL = "claude-haiku-4-5-20251001"
FACET_LABELS = (
    "objective",
    "novelty",
    "method",
    "result",
    "background",
    "uncategorized",
)
FACET_CONFIDENCE_FLOOR = 0.7
ONTOLOGY_MAX_TOPICS = 8
ONTOLOGY_MIN_TOPICS = 5
ONTOLOGY_REFRESH_INTERVAL = timedelta(hours=24)
_JUNK_CLUSTER_RE = re.compile(r"^(arXiv|T\d|Fig|Figure|Table|\d+\s)", re.IGNORECASE)
_ACTION_TYPES = frozenset({"explain", "simplify", "terms", "summarise", "chat"})
_ACTION_PREFIXES = (
    "Explain this passage",
    "Explain this in simple",
    "Identify and define",
    "Create a quiz question",
    "Summarise this passage",
)
_FALLBACK_STUDY_QUESTION = {
    "explain":   "What does this passage mean in your own words?",
    "simplify":  "How would you explain this in plain language, without jargon?",
    "terms":     "What are the key terms here and what do they mean?",
    "summarise": "Summarise this passage from memory in 2–3 sentences.",
    "quiz":      "What does this passage test you on?",
    "chat":      "What is the key point of this passage?",
}

_anthropic: Anthropic | None = None


def _get_anthropic() -> Anthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic


_FACET_SYSTEM = """\
You are a rhetorical facet classifier for study cards from research papers.

Choose exactly one label from:
- objective
- novelty
- method
- result
- background
- uncategorized

Definitions:
- objective: the card is mainly about the paper's goal, problem, motivation, or purpose.
- novelty: the card is mainly about what is new, distinctive, or different about the work.
- method: the card is mainly about approach, design, workflow, implementation, or evaluation procedure.
- result: the card is mainly about findings, outcomes, evidence, or implications of results.
- background: the card is mainly about prior context, framing, domain knowledge, or why the topic matters.
- uncategorized: none of the above fits clearly enough.

Output ONLY JSON:
{"label":"one_label","confidence":0.0}
"""


_ONTOLOGY_SYSTEM = """\
You generate a compact topic ontology for a single research paper.

Rules:
- Output ONLY a JSON array of topic labels.
- Return 5 to 8 items.
- Each topic must be a short noun phrase, 1 to 4 words.
- Prefer concepts that organize the paper's ideas for a learner, not metadata.
- Avoid generic labels like "introduction", "discussion", "paper", "study".
- Keep labels distinct and high-signal.
"""


_TOPIC_CLASSIFIER_SYSTEM = """\
You classify a study card into a paper-specific ontology.

Rules:
- Output ONLY a JSON array of labels from the ontology provided.
- Return at most 3 labels.
- If nothing fits cleanly, you may return ["other"].
- Do not invent new labels outside the ontology except "other".
"""


def _json_message_text(message: Any) -> str:
    try:
        return message.content[0].text.strip()
    except Exception:
        return ""


def _safe_json_object(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _safe_json_list(raw: str) -> list[Any]:
    try:
        value = json.loads(raw)
        return value if isinstance(value, list) else []
    except Exception:
        return []


def _clean_topic_label(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip()).strip(" -:;,.")
    return cleaned.lower()


def _is_raw_action_prompt(text: str | None) -> bool:
    return bool(text) and text.startswith(_ACTION_PREFIXES)


def _extract_quiz_question(answer: str | None) -> str | None:
    if not answer:
        return None
    match = re.search(r"\*\*[Qq]uestion:\*\*\s*([\s\S]+?)(?:\n\n\*\*[Aa]nswer:|$)", answer)
    if match:
        candidate = match.group(1).strip()
        if len(candidate) > 5:
            return candidate
    match = re.search(r"^[Qq]uestion:\s*(.+)$", answer, re.MULTILINE)
    if match:
        candidate = match.group(1).strip()
        if len(candidate) > 5:
            return candidate
    return None


def is_fallback_study_question(card_type: str, text: str | None) -> bool:
    fallback = _FALLBACK_STUDY_QUESTION.get(card_type)
    return bool(fallback) and (text or "").strip() == fallback


def _parse_ontology_topics(ontology_json: Any) -> list[str]:
    if isinstance(ontology_json, dict):
        topics = ontology_json.get("topics") or []
    elif isinstance(ontology_json, list):
        topics = ontology_json
    else:
        topics = []
    cleaned: list[str] = []
    seen: set[str] = set()
    for topic in topics:
        label = _clean_topic_label(str(topic))
        if not label or label in seen:
            continue
        seen.add(label)
        cleaned.append(label)
    return cleaned


def get_pdf_ontology_topics(doc: PDFDocument | None) -> list[str]:
    if doc is None:
        return []
    return _parse_ontology_topics(getattr(doc, "ontology_json", None))


def _ontology_generated_at(doc: PDFDocument | None) -> datetime | None:
    if doc is None or not isinstance(doc.ontology_json, dict):
        return None
    raw = doc.ontology_json.get("generated_at")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _chunk_ids_for_pdf(doc: PDFDocument, limit: int = 12) -> list[str]:
    max_chunks = min(limit, max(doc.chunk_count or 0, 0))
    return [f"pdf_{doc.id}_chunk_{idx}" for idx in range(max_chunks)]


def _ontology_context(doc: PDFDocument) -> str:
    toc_text = ""
    chunk_text = ""
    try:
        pdf_bytes = s3_service.get_file_bytes(doc.s3_key)
        toc = toc_service.get_toc(pdf_bytes)
        items = toc.get("items") or []
        toc_lines = [f"- {item.get('title', '').strip()}" for item in items[:20] if item.get("title")]
        toc_text = "\n".join(toc_lines)
    except Exception:
        toc_text = ""

    try:
        chunk_ids = _chunk_ids_for_pdf(doc)
        if chunk_ids:
            result = chroma_service._get_collection().get(ids=chunk_ids, include=["documents"])
            docs = result.get("documents") or []
            chunk_text = "\n\n".join((d or "")[:900] for d in docs[:12] if d)
    except Exception:
        chunk_text = ""

    return (
        f"Paper title:\n{doc.title}\n\n"
        f"Table of contents / headings:\n{toc_text or '(unavailable)'}\n\n"
        f"Opening chunks:\n{chunk_text or '(unavailable)'}"
    )


def _normalize_heading_topic(text: str) -> str:
    cleaned = re.sub(r"^\d+(\.\d+)*\s*", "", (text or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned)
    return _clean_topic_label(cleaned)


def _is_junk_topic_label(label: str) -> bool:
    if not label:
        return True
    if _JUNK_CLUSTER_RE.match(label):
        return True
    if label in {
        "abstract", "introduction", "discussion", "conclusion", "related work",
        "evaluation", "references", "other",
    }:
        return True
    if label.startswith("arxiv:"):
        return True
    return False


def _fallback_ontology_topics(db: Session, doc: PDFDocument) -> list[str]:
    concept_counts: Counter[str] = Counter()
    section_counts: Counter[str] = Counter()

    entries = db.query(HighlightEntry).filter(HighlightEntry.pdf_id == doc.id).all()
    for entry in entries:
        for concept in entry.concepts or []:
            label = _clean_topic_label(str(concept))
            if label and not _is_junk_topic_label(label):
                concept_counts[label] += 1
        for node in (entry.deep_section_path or []):
            label = _normalize_heading_topic(str((node or {}).get("title") or ""))
            if label and not _is_junk_topic_label(label):
                section_counts[label] += 1
        for qa in [q for q in entry.qa_pairs if q.archived_at is None][:2]:
            for concept in extract_concepts(entry.highlight_text or qa.selection_text or "", qa.answer or ""):
                label = _clean_topic_label(concept)
                if label and not _is_junk_topic_label(label):
                    concept_counts[label] += 1

    try:
        pdf_bytes = s3_service.get_file_bytes(doc.s3_key)
        toc = toc_service.get_toc(pdf_bytes)
        for item in (toc.get("items") or [])[:20]:
            label = _normalize_heading_topic(str(item.get("title") or ""))
            if label and not _is_junk_topic_label(label) and len(label.split()) >= 2:
                section_counts[label] += 1
    except Exception:
        pass

    topics: list[str] = []
    seen: set[str] = set()

    for label, _count in concept_counts.most_common(ONTOLOGY_MAX_TOPICS):
        if label in seen or _is_junk_topic_label(label):
            continue
        seen.add(label)
        topics.append(label)
        if len(topics) >= ONTOLOGY_MAX_TOPICS:
            return topics

    for label, _count in section_counts.most_common(ONTOLOGY_MAX_TOPICS):
        if label in seen or len(label.split()) < 2 or _is_junk_topic_label(label):
            continue
        seen.add(label)
        topics.append(label)
        if len(topics) >= ONTOLOGY_MAX_TOPICS:
            break

    return topics[:ONTOLOGY_MAX_TOPICS]


def ensure_pdf_ontology(
    db: Session,
    pdf_id: int,
    *,
    force: bool = False,
) -> list[str]:
    doc = db.get(PDFDocument, pdf_id)
    if not doc:
        return []

    existing_topics = get_pdf_ontology_topics(doc)
    generated_at = _ontology_generated_at(doc)
    now = datetime.now(timezone.utc)
    if (
        existing_topics
        and not force
        and generated_at is not None
        and (now - generated_at) < ONTOLOGY_REFRESH_INTERVAL
    ):
        return existing_topics

    try:
        client = _get_anthropic()
        msg = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=160,
            system=_ONTOLOGY_SYSTEM,
            messages=[{"role": "user", "content": _ontology_context(doc)}],
        )
        raw_topics = _safe_json_list(_json_message_text(msg))
        topics = []
        seen: set[str] = set()
        for topic in raw_topics:
            label = _clean_topic_label(str(topic))
            if not label or label in seen:
                continue
            if label in {"paper", "research paper", "study", "introduction", "discussion"}:
                continue
            seen.add(label)
            topics.append(label)
            if len(topics) >= ONTOLOGY_MAX_TOPICS:
                break
        if len(topics) < ONTOLOGY_MIN_TOPICS:
            topics = _fallback_ontology_topics(db, doc) or existing_topics
        if topics:
            doc.ontology_json = {
                "topics": topics,
                "generated_at": now.isoformat(),
                "model": HAIKU_MODEL,
            }
            db.add(doc)
            db.commit()
            db.refresh(doc)
        return topics
    except Exception:
        return existing_topics


def classify_rhetorical_facet(
    *,
    study_question: str,
    answer: str,
    selection_text: str | None = None,
) -> tuple[str, float]:
    combined = " ".join([study_question or "", answer or "", selection_text or ""]).lower()

    def heuristic() -> tuple[str, float]:
        scores = {
            "objective": sum(token in combined for token in [
                "goal", "aim", "purpose", "problem", "challenge", "barrier", "motivation",
            ]),
            "novelty": sum(token in combined for token in [
                "novel", "new", "distinct", "different", "innovation", "unique",
            ]),
            "method": sum(token in combined for token in [
                "how", "approach", "design", "method", "evaluate", "evaluation",
                "implementation", "participant", "study", "feature", "system",
            ]),
            "result": sum(token in combined for token in [
                "result", "finding", "findings", "outcome", "evidence", "impact",
                "improved", "improvement", "effect", "significant",
            ]),
            "background": sum(token in combined for token in [
                "context", "overview", "background", "literature", "why", "healthcare",
                "jargon", "dense", "comprehension",
            ]),
        }
        label, score = max(scores.items(), key=lambda item: item[1])
        if score <= 0:
            return "uncategorized", 0.0
        confidence = 0.72 if score >= 2 else 0.61
        if confidence < FACET_CONFIDENCE_FLOOR:
            return "uncategorized", confidence
        return label, confidence

    prompt = (
        f"Study question:\n{study_question[:300]}\n\n"
        f"Answer:\n{answer[:2200]}\n\n"
        f"Source passage:\n{(selection_text or '')[:1000]}"
    )
    try:
        client = _get_anthropic()
        msg = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=80,
            system=_FACET_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        data = _safe_json_object(_json_message_text(msg))
        label = str(data.get("label") or "").strip().lower()
        confidence = float(data.get("confidence") or 0.0)
        if label not in FACET_LABELS:
            label = "uncategorized"
        if not math.isfinite(confidence):
            confidence = 0.0
        confidence = max(0.0, min(confidence, 1.0))
        if confidence < FACET_CONFIDENCE_FLOOR:
            return heuristic()
        return label, confidence
    except Exception:
        return heuristic()


def classify_topics_into_ontology(
    *,
    study_question: str,
    answer: str,
    selection_text: str | None,
    ontology_topics: list[str],
) -> list[str]:
    if not ontology_topics:
        return []
    prompt = (
        f"Ontology labels:\n{json.dumps(ontology_topics)}\n\n"
        f"Study question:\n{study_question[:300]}\n\n"
        f"Answer:\n{answer[:1800]}\n\n"
        f"Source passage:\n{(selection_text or '')[:900]}"
    )
    try:
        client = _get_anthropic()
        msg = client.messages.create(
            model=HAIKU_MODEL,
            max_tokens=100,
            system=_TOPIC_CLASSIFIER_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        labels = _safe_json_list(_json_message_text(msg))
        normalized = []
        seen: set[str] = set()
        ontology_set = set(ontology_topics)
        for label in labels:
            cleaned = _clean_topic_label(str(label))
            if not cleaned or cleaned in seen:
                continue
            if cleaned != "other" and cleaned not in ontology_set:
                continue
            seen.add(cleaned)
            normalized.append(cleaned)
            if len(normalized) >= 3:
                break
        if normalized:
            return normalized
    except Exception:
        pass

    ranked = _rank_topics(
        " ".join([study_question or "", answer or "", selection_text or ""]).strip(),
        ontology_topics,
    )
    fallback = [label for label, score in ranked[:3] if score >= 0.24]
    return fallback or (["other"] if ontology_topics else [])


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _rank_topics(text: str, ontology_topics: list[str]) -> list[tuple[str, float]]:
    if not text.strip() or not ontology_topics:
        return []
    try:
        vecs = embed([text] + ontology_topics)
        target = vecs[0]
        ranked: list[tuple[str, float]] = []
        for label, vec in zip(ontology_topics, vecs[1:]):
            score = _cosine(target, vec)
            ranked.append((label, score))
        return sorted(ranked, key=lambda item: item[1], reverse=True)
    except Exception:
        return []


def _best_matching_topic(text: str, ontology_topics: list[str]) -> str | None:
    ranked = _rank_topics(text, ontology_topics)
    return ranked[0][0] if ranked else None


def derive_cluster_tag(
    entry: HighlightEntry,
    ontology_topics: list[str],
    qa_pairs: list[QAPair] | None = None,
) -> str | None:
    deep_path = entry.deep_section_path or []
    if isinstance(deep_path, list) and deep_path:
        title = str((deep_path[0] or {}).get("title") or "").strip()
        if title and not _JUNK_CLUSTER_RE.match(title):
            return title

    basis_parts = [entry.highlight_text or ""]
    for qa in (qa_pairs or entry.qa_pairs):
        if qa.study_question:
            basis_parts.append(qa.study_question)
        for topic in qa.topic_tags or []:
            basis_parts.append(topic)
    nearest = _best_matching_topic(" ".join(basis_parts), ontology_topics)
    if nearest:
        return nearest
    return "Other"


def refresh_highlight_learning_metadata(
    db: Session,
    highlight_id: int,
    *,
    ontology_topics: list[str] | None = None,
) -> None:
    entry = db.get(HighlightEntry, highlight_id)
    if not entry:
        return
    if ontology_topics is None:
        doc = db.get(PDFDocument, entry.pdf_id)
        ontology_topics = get_pdf_ontology_topics(doc)

    active_qas = (
        db.query(QAPair)
        .filter(QAPair.highlight_id == highlight_id, QAPair.archived_at.is_(None))
        .all()
    )
    topic_order: list[str] = []
    seen: set[str] = set()
    for qa in active_qas:
        for label in qa.topic_tags or []:
            cleaned = _clean_topic_label(str(label))
            if not cleaned or cleaned == "other" or cleaned in seen:
                continue
            seen.add(cleaned)
            topic_order.append(cleaned)

    entry.concepts = topic_order[:6]
    entry.cluster_tag = derive_cluster_tag(entry, ontology_topics or [], qa_pairs=active_qas)
    db.add(entry)


def maybe_rewrite_fallback_study_question(qa: QAPair, highlight_text: str = "") -> str | None:
    if not is_fallback_study_question(qa.card_type or "manual", qa.study_question):
        return None
    if qa.card_type == "quiz":
        extracted = _extract_quiz_question(qa.answer)
        if extracted:
            return extracted
    raw = qa.original_question or qa.question or qa.study_question or ""
    rewritten = prepare_study_card_question(raw, qa.answer or "", qa.selection_text or highlight_text)
    rewritten = re.sub(r"\s+", " ", (rewritten or "").strip())
    if not rewritten or _is_raw_action_prompt(rewritten):
        return None
    if qa.card_type in _ACTION_TYPES and rewritten == raw:
        return None
    if not rewritten.endswith("?"):
        rewritten = rewritten.rstrip(".!") + "?"
    return rewritten


def recompute_pdf_learning_metadata(db: Session, pdf_id: int) -> dict[str, Any]:
    ontology_topics = ensure_pdf_ontology(db, pdf_id, force=True)
    entries = (
        db.query(HighlightEntry)
        .filter(HighlightEntry.pdf_id == pdf_id)
        .order_by(HighlightEntry.created_at.asc())
        .all()
    )

    qa_count = 0
    rewritten_questions = 0
    for entry in entries:
        active_qas = [qa for qa in entry.qa_pairs if qa.archived_at is None]
        for qa in active_qas:
            if qa.study_question:
                current_question = qa.study_question
            else:
                current_question = qa.original_question or qa.question or "Study card"
            rewritten = maybe_rewrite_fallback_study_question(qa, entry.highlight_text or "")
            if rewritten:
                qa.study_question = rewritten
                current_question = rewritten
                rewritten_questions += 1
            facet, confidence = classify_rhetorical_facet(
                study_question=current_question,
                answer=qa.answer or "",
                selection_text=qa.selection_text or entry.highlight_text,
            )
            qa.rhetorical_facet = facet
            qa.facet_confidence = confidence
            qa.topic_tags = classify_topics_into_ontology(
                study_question=current_question,
                answer=qa.answer or "",
                selection_text=qa.selection_text or entry.highlight_text,
                ontology_topics=ontology_topics,
            )
            qa_count += 1
            db.add(qa)
        refresh_highlight_learning_metadata(db, entry.id, ontology_topics=ontology_topics)

    db.commit()
    return {
        "pdf_id": pdf_id,
        "ontology_topics": ontology_topics,
        "entry_count": len(entries),
        "qa_count": qa_count,
        "rewritten_study_questions": rewritten_questions,
    }
