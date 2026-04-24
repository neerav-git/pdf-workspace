from __future__ import annotations

import re
from typing import Any

from app.models.highlight import HighlightEntry, QAPair
from app.services import chroma_service

_FALLBACK_STUDY_QUESTIONS = {
    "What does this passage mean in your own words?",
    "How would you explain this in plain language, without jargon?",
    "What are the key terms here and what do they mean?",
    "Summarise this passage from memory in 2–3 sentences.",
    "What does this passage test you on?",
    "What is the key point of this passage?",
}

_COMPARISON_RE = re.compile(r"\b(compare|comparison|contrast|different|difference|versus|vs\.?)\b", re.IGNORECASE)
_DEFINITION_RE = re.compile(r"\b(define|definition|what does .* mean|what is\b|what are\b|key terms?)\b", re.IGNORECASE)
_CRITIQUE_RE = re.compile(r"\b(limit|limitation|weakness|critique|criticis|assumption|bias|fail|risk)\b", re.IGNORECASE)
_METHOD_RE = re.compile(r"\b(method|approach|design|evaluate|evaluation|how does|how did|implementation|procedure)\b", re.IGNORECASE)
_RESULT_RE = re.compile(r"\b(result|finding|found|show|evidence|outcome|effect)\b", re.IGNORECASE)
_DEMONSTRATIVE_RE = re.compile(r"\b(this|that|these|those|it|they)\b", re.IGNORECASE)
_AMBIGUOUS_TARGET_RE = re.compile(
    r"\b(problem|paper|passage|approach|method|result|claim|system|term|idea|finding|section)\b",
    re.IGNORECASE,
)


def build_question_context(
    qa: QAPair,
    entry: HighlightEntry | None = None,
    *,
    chunk_cache: dict[str, str] | None = None,
    resolved_source_text: str | None = None,
) -> dict[str, Any]:
    chunk_cache = chunk_cache if chunk_cache is not None else {}
    question = _display_question(qa)
    source_locator = {
        "page": entry.page_number if entry else None,
        "section_title": entry.section_title if entry else None,
        "highlight_id": entry.id if entry else None,
        "chat_turn_id": qa.origin_chat_message_id,
        "pdf_id": entry.pdf_id if entry else None,
    }

    question_origin = _question_origin(qa, entry, question)
    question_intent = _question_intent(qa, question, question_origin)
    source_excerpt_full, context_status, used_reconstruction = _source_excerpt_full(
        qa,
        entry,
        chunk_cache=chunk_cache,
        resolved_source_text=resolved_source_text,
    )
    source_excerpt_short = _excerpt_short(source_excerpt_full)
    question_scope = _question_scope(entry, source_excerpt_full, question_origin)
    needs_disambiguation = _needs_disambiguation(question, qa, question_origin)
    context_required = (
        needs_disambiguation
        or question_scope in {"section", "document", "session"}
        or question_origin in {"chat", "concept", "comparison"}
    )
    if context_status == "weak":
        context_required = True
        needs_disambiguation = True

    context_summary = _context_summary(
        qa,
        entry,
        question=question,
        question_origin=question_origin,
        question_scope=question_scope,
        question_intent=question_intent,
        source_excerpt_short=source_excerpt_short,
        context_status=context_status,
    )
    review_prompt_mode = _review_prompt_mode(
        context_required=context_required,
        source_excerpt_full=source_excerpt_full,
        needs_disambiguation=needs_disambiguation,
    )

    if context_status == "grounded" and used_reconstruction:
        context_status = "reconstructed"

    context = {
        "question_origin": question_origin,
        "question_scope": question_scope,
        "question_intent": question_intent,
        "context_required": context_required,
        "context_summary": context_summary,
        "source_excerpt_short": source_excerpt_short,
        "source_excerpt_full": source_excerpt_full,
        "source_locator": source_locator,
        "context_status": context_status,
        "review_prompt_mode": review_prompt_mode,
        "needs_disambiguation": needs_disambiguation,
    }
    return _apply_context_overrides(context, qa)


def build_repair_context_override(
    qa: QAPair,
    entry: HighlightEntry | None = None,
    *,
    chunk_cache: dict[str, str] | None = None,
    resolved_source_text: str | None = None,
) -> dict[str, Any]:
    base = build_question_context(
        qa,
        entry,
        chunk_cache=chunk_cache,
        resolved_source_text=resolved_source_text,
    )
    question = _display_question(qa)
    answer_preview = _excerpt_short(_clean_text(qa.answer or ""), limit=220)
    location = _location_label(entry)
    source_excerpt_full = base.get("source_excerpt_full") or ""
    source_excerpt_short = base.get("source_excerpt_short") or ""

    if source_excerpt_full:
        summary = (
            f"Refers to {location} and asks: \"{question}\". "
            f"The linked source begins: \"{source_excerpt_short}\""
            if location
            else f"Asks: \"{question}\". The linked source begins: \"{source_excerpt_short}\""
        )
        status = "grounded"
        needs_disambiguation = False if source_excerpt_short else base.get("needs_disambiguation", False)
        prompt_mode = "question_plus_passage"
        scope = "passage"
    else:
        if answer_preview:
            summary = (
                f"Derived from a prior saved exchange about {location}. "
                f"The answer focused on: \"{answer_preview}\""
                if location
                else f"Derived from a prior saved exchange. The answer focused on: \"{answer_preview}\""
            )
        else:
            summary = (
                f"Derived from a prior saved exchange about {location}; preserve the original wording and repair the source link before heavy review."
                if location
                else "Derived from a prior saved exchange; preserve the original wording and repair the source link before heavy review."
            )
        status = "reconstructed" if location else "weak"
        needs_disambiguation = True
        prompt_mode = "question_plus_context"
        scope = base.get("question_scope", "document")

    override = {
        "context_summary": summary,
        "source_excerpt_short": source_excerpt_short,
        "source_excerpt_full": source_excerpt_full,
        "source_locator": base.get("source_locator", {}),
        "context_status": status,
        "review_prompt_mode": prompt_mode,
        "question_scope": scope,
        "context_required": True,
        "needs_disambiguation": needs_disambiguation,
    }
    return override


def _display_question(qa: QAPair) -> str:
    return (qa.study_question or qa.original_question or qa.question or "").strip()


def _question_origin(qa: QAPair, entry: HighlightEntry | None, question: str) -> str:
    lower = question.lower()
    if _COMPARISON_RE.search(lower):
        return "comparison"
    if qa.card_type == "chat" or qa.origin_chat_message_id is not None:
        return "chat"
    if qa.card_type == "terms":
        return "concept"
    if (not qa.selection_text) and (not qa.source_chunk_ids) and (not entry or not entry.highlight_text):
        return "manual"
    return "highlight"


def _question_scope(entry: HighlightEntry | None, source_excerpt_full: str, question_origin: str) -> str:
    if question_origin == "comparison":
        return "session"
    if source_excerpt_full:
        return "passage"
    if entry and (entry.section_title or entry.cluster_tag):
        return "section"
    if entry and entry.pdf_id:
        return "document"
    return "document"


def _question_intent(qa: QAPair, question: str, question_origin: str) -> str:
    lower = question.lower()
    if question_origin == "comparison" or _COMPARISON_RE.search(lower):
        return "comparison"
    if qa.card_type == "terms" or _DEFINITION_RE.search(lower):
        return "definition"
    if qa.rhetorical_facet == "method" or _METHOD_RE.search(lower):
        return "method"
    if qa.rhetorical_facet == "result" or _RESULT_RE.search(lower):
        return "result"
    if _CRITIQUE_RE.search(lower) or qa.rhetorical_facet == "novelty":
        return "critique"
    if qa.rhetorical_facet in {"background", "objective"}:
        return "background"
    if qa.card_type in {"summarise", "simplify", "explain", "quiz", "chat"}:
        return "takeaway"
    return "takeaway"


def _needs_disambiguation(question: str, qa: QAPair, question_origin: str) -> bool:
    clean = (question or "").strip()
    if not clean:
        return True
    if clean in _FALLBACK_STUDY_QUESTIONS:
        return True
    if question_origin in {"chat", "comparison"} and len(clean.split()) <= 10:
        return True
    return bool(_DEMONSTRATIVE_RE.search(clean) and _AMBIGUOUS_TARGET_RE.search(clean))


def _source_excerpt_full(
    qa: QAPair,
    entry: HighlightEntry | None,
    *,
    chunk_cache: dict[str, str],
    resolved_source_text: str | None,
) -> tuple[str, str, bool]:
    base_excerpt = _clean_text(
        qa.selection_text
        or (entry.highlight_text if entry else "")
        or _longest_excerpt(entry.highlight_texts if entry else [])
    )
    chunk_text = _clean_text(resolved_source_text) or _resolve_chunk_text(qa, entry, chunk_cache)

    if base_excerpt and chunk_text:
        expanded = _expand_to_sentence_context(base_excerpt, chunk_text)
        if expanded:
            return expanded, "grounded", expanded != base_excerpt
    if base_excerpt:
        return base_excerpt, "grounded", False
    if chunk_text:
        return chunk_text, "reconstructed", True
    return "", "weak", False


def _excerpt_short(text: str, limit: int = 180) -> str:
    clean = _clean_text(text)
    if len(clean) <= limit:
        return clean
    return clean[:limit].rstrip(" ,;:") + "..."


def _context_summary(
    qa: QAPair,
    entry: HighlightEntry | None,
    *,
    question: str,
    question_origin: str,
    question_scope: str,
    question_intent: str,
    source_excerpt_short: str,
    context_status: str,
) -> str:
    section = (entry.section_title or entry.cluster_tag) if entry else None
    page = entry.page_number if entry else None
    location_bits = []
    if section:
        location_bits.append(section)
    if page:
        location_bits.append(f"p.{page}")
    location = " · ".join(location_bits)

    if source_excerpt_short:
        if location:
            return f"Refers to {location} and the passage beginning: \"{source_excerpt_short}\""
        return f"Refers to the passage beginning: \"{source_excerpt_short}\""

    if question_origin == "chat":
        if qa.answer:
            answer_preview = _excerpt_short(qa.answer, limit=180)
            if location:
                return f"Derived from a chat exchange about {location}. The saved answer focused on: \"{answer_preview}\""
            return f"Derived from a chat exchange in this PDF. The saved answer focused on: \"{answer_preview}\""
        if location:
            return f"Derived from a chat exchange about {location} in this PDF."
        return "Derived from a chat exchange about this PDF."

    if question_scope == "section" and location:
        return f"Refers to material in {location}."
    if question_scope == "document":
        return f"Refers to a {question_intent} question about this document."
    if context_status == "weak":
        preview = _excerpt_short(question, limit=120)
        if preview:
            return f"Source context is weak; preserve the original question \"{preview}\", but review it with extra context."
        return f"Source context is weak; preserve the original question, but review it with extra context."
    return ""


def _review_prompt_mode(*, context_required: bool, source_excerpt_full: str, needs_disambiguation: bool) -> str:
    if context_required and source_excerpt_full:
        return "question_plus_passage"
    if context_required or needs_disambiguation:
        return "question_plus_context"
    return "question_only"


def _resolve_chunk_text(
    qa: QAPair,
    entry: HighlightEntry | None,
    chunk_cache: dict[str, str],
) -> str:
    chunk_ids = [cid for cid in (qa.source_chunk_ids or []) if cid]
    if not chunk_ids and entry and entry.chunk_id:
        chunk_ids = [entry.chunk_id]
    if not chunk_ids:
        return ""

    primary_id = chunk_ids[0]
    if primary_id in chunk_cache:
        return chunk_cache[primary_id]

    try:
        result = chroma_service._get_collection().get(ids=[primary_id], include=["documents"])
        documents = result.get("documents") or []
        text = _clean_text(documents[0] if documents else "")
    except Exception:
        text = ""

    chunk_cache[primary_id] = text
    return text


def _location_label(entry: HighlightEntry | None) -> str:
    if not entry:
        return ""
    bits: list[str] = []
    if entry.section_title:
        bits.append(entry.section_title)
    elif entry.cluster_tag:
        bits.append(entry.cluster_tag)
    if entry.page_number:
        bits.append(f"p.{entry.page_number}")
    return " · ".join(bits)


def _apply_context_overrides(context: dict[str, Any], qa: QAPair) -> dict[str, Any]:
    overrides = qa.context_override_json if isinstance(qa.context_override_json, dict) else {}
    if not overrides:
        return context

    merged = dict(context)
    for key, value in overrides.items():
        if key == "source_locator" and isinstance(value, dict):
            locator = dict(merged.get("source_locator") or {})
            locator.update({k: v for k, v in value.items() if v is not None})
            merged["source_locator"] = locator
        elif value is not None:
            merged[key] = value
    return merged


def _expand_to_sentence_context(selection_text: str, chunk_text: str, radius: int = 260) -> str:
    selection = _clean_text(selection_text)
    chunk = _clean_text(chunk_text)
    if not selection or not chunk:
        return selection
    if selection.endswith((".", "!", "?")) and len(selection) >= min(len(chunk), 220):
        return selection

    probe = selection[: min(len(selection), 72)]
    start_idx = chunk.find(probe)
    if start_idx == -1 and len(probe) > 28:
        start_idx = chunk.find(probe[:28])
    if start_idx == -1:
        return selection

    end_idx = min(len(chunk), start_idx + len(selection))
    left_window = chunk[max(0, start_idx - radius):start_idx]
    right_window = chunk[end_idx:min(len(chunk), end_idx + radius)]

    left_break = max(left_window.rfind("."), left_window.rfind("!"), left_window.rfind("?"))
    context_start = 0 if left_break == -1 else max(0, start_idx - len(left_window) + left_break + 1)
    while context_start < len(chunk) and chunk[context_start] == " ":
        context_start += 1

    right_match = re.search(r"[.!?](?:\s|$)", right_window)
    context_end = len(chunk) if not right_match else end_idx + right_match.end()

    excerpt = _clean_text(chunk[context_start:context_end])
    return excerpt or selection


def _longest_excerpt(values: list[str] | None) -> str:
    candidates = [_clean_text(value) for value in (values or []) if _clean_text(value)]
    if not candidates:
        return ""
    return max(candidates, key=len)


def _clean_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("-\n", "").replace("-\r\n", "")).strip()
