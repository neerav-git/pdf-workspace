from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from anthropic import Anthropic
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.highlight import HighlightEntry, QAPair
from app.models.pdf import PDFDocument
from app.models.research_session import ResearchSession
from app.services import chroma_service


AI_COMPARISON_VERSION = "comparative_ai_v2"
AI_COMPARISON_MODEL = "claude-sonnet-4-20250514"

_anthropic: Anthropic | None = None


BASELINE_DIMENSIONS = [
    {
        "key": "core_problem",
        "label": "Core Problem",
        "description": "What problem, need, or barrier the paper/book is helping the reader understand.",
        "facets": {"objective", "background", "novelty"},
        "keywords": ("problem", "barrier", "challenge", "issue", "motivation", "objective", "need"),
    },
    {
        "key": "assumptions",
        "label": "Assumptions / Framing",
        "description": "The assumptions, framing choices, or theoretical stance behind the work.",
        "facets": {"objective", "background", "novelty"},
        "keywords": ("assumption", "assume", "framing", "hypothesis", "claim", "premise", "why"),
    },
    {
        "key": "method",
        "label": "Method / Approach",
        "description": "How the work approaches the problem: design, method, system, dataset, or evaluation.",
        "facets": {"method"},
        "keywords": ("method", "approach", "system", "design", "implementation", "evaluate", "study", "experiment"),
    },
    {
        "key": "results",
        "label": "Findings / Results",
        "description": "What the work found, demonstrated, improved, or concluded.",
        "facets": {"result"},
        "keywords": ("result", "finding", "found", "show", "yield", "improve", "effect", "conclusion"),
    },
    {
        "key": "limitations",
        "label": "Limitations / Future Scope",
        "description": "What remains unresolved, weakly covered, limited, or suitable for future work.",
        "facets": set(),
        "keywords": ("limitation", "future", "scope", "unresolved", "weakness", "cannot", "unclear", "gap"),
    },
    {
        "key": "learning_takeaways",
        "label": "Learning Takeaways",
        "description": "What the reader has actively indexed, reviewed, or turned into study questions.",
        "facets": set(),
        "keywords": ("learn", "understand", "takeaway", "reader", "review", "question", "remember"),
    },
]


def build_comparative_analysis(db: Session, session: ResearchSession) -> dict[str, Any]:
    pdfs = _session_pdfs(session)
    pdf_ids = [pdf.id for pdf in pdfs]
    entries_by_pdf = _entries_by_pdf(db, pdf_ids)
    ai_comparison = _finalize_ai_comparison(_cached_ai_comparison(session, pdf_ids), session=session)

    papers = [_paper_summary(pdf, entries_by_pdf.get(pdf.id, [])) for pdf in pdfs]
    baseline = [_baseline_row(dim, pdfs, entries_by_pdf) for dim in BASELINE_DIMENSIONS]
    topic_dimensions = _topic_dimensions(pdfs, entries_by_pdf)
    gap_panel = _gap_panel(session, papers, baseline, topic_dimensions)

    return {
        "session": {
            "id": session.id,
            "title": session.title,
            "topic": session.topic or "",
            "context": session.context or "",
            "pdf_count": len(pdfs),
        },
        "papers": papers,
        "baseline_dimensions": baseline,
        "topic_dimensions": topic_dimensions,
        "gap_panel": gap_panel,
        "ai_comparison": ai_comparison or _empty_ai_comparison_status(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_policy": (
            "Deterministic draft built from session membership, PDF ontology, saved index entries, "
            "Q&A cards, review state, and page-linked evidence. It does not invent paper claims."
        ),
    }


def refresh_ai_comparative_analysis(db: Session, session: ResearchSession) -> dict[str, Any]:
    """
    Generate and cache the proper comparative-analysis layer.

    The AI layer treats PDF content as the primary source, then uses index/Q&A/review
    material as anchors that reveal what the reader has already noticed. The output is
    cached on the session JSON field so opening Compare does not repeatedly call the LLM.
    """
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured.")

    pdfs = _session_pdfs(session)
    if not pdfs:
        raise ValueError("Research session has no PDFs to compare.")

    entries_by_pdf = _entries_by_pdf(db, [pdf.id for pdf in pdfs])
    paper_analyses = []
    for pdf in pdfs:
        paper_analyses.append(_generate_paper_analysis(pdf, entries_by_pdf.get(pdf.id, []), session))

    session_matrix = _generate_session_matrix(session, paper_analyses)
    cache = {
        "version": AI_COMPARISON_VERSION,
        "status": "generated",
        "model": AI_COMPARISON_MODEL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pdf_ids": [pdf.id for pdf in pdfs],
        "paper_analyses": paper_analyses,
        "session_axes": session_matrix.get("session_axes", []),
        "matrix": session_matrix.get("matrix", []),
        "cross_paper_insights": session_matrix.get("cross_paper_insights", []),
        "research_gaps": session_matrix.get("research_gaps", []),
        "reader_guidance": session_matrix.get("reader_guidance", []),
        "method_note": (
            "Generated from sampled PDF chunks plus saved reader index/Q&A anchors. "
            "Claims should remain traceable to source pages or indexed evidence."
        ),
    }

    payload = dict(session.learning_takeaways_json or {})
    payload["comparative_analysis"] = cache
    session.learning_takeaways_json = payload
    db.add(session)
    db.commit()
    db.refresh(session)
    return build_comparative_analysis(db, session)


def _session_pdfs(session: ResearchSession) -> list[PDFDocument]:
    by_id: dict[int, PDFDocument] = {}
    for membership in session.memberships or []:
        if membership.pdf:
            by_id[membership.pdf.id] = membership.pdf
    return sorted(by_id.values(), key=lambda pdf: (pdf.created_at is None, pdf.created_at), reverse=True)


def _get_anthropic() -> Anthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic


def _cached_ai_comparison(session: ResearchSession, pdf_ids: list[int]) -> dict[str, Any] | None:
    raw = (session.learning_takeaways_json or {}).get("comparative_analysis")
    if not isinstance(raw, dict):
        return None
    if raw.get("version") != AI_COMPARISON_VERSION:
        return None
    if sorted(raw.get("pdf_ids") or []) != sorted(pdf_ids):
        return {
            **raw,
            "status": "stale",
            "stale_reason": "Session PDF membership changed since this AI comparison was generated.",
        }
    return raw


def _empty_ai_comparison_status() -> dict[str, Any]:
    return {
        "version": AI_COMPARISON_VERSION,
        "status": "not_generated",
        "paper_analyses": [],
        "session_axes": [],
        "matrix": [],
        "cross_paper_insights": [],
        "research_gaps": [],
        "reader_guidance": [],
        "method_note": "Click refresh/generate to create the PDF-first AI comparative analysis.",
    }


def _finalize_ai_comparison(raw: dict[str, Any] | None, session: ResearchSession | None = None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return raw
    paper_analyses = raw.get("paper_analyses")
    if not isinstance(paper_analyses, list) or not paper_analyses:
        return raw
    normalized = _normalize_session_matrix(
        {
            "session_axes": raw.get("session_axes"),
            "matrix": raw.get("matrix"),
            "cross_paper_insights": raw.get("cross_paper_insights"),
            "research_gaps": raw.get("research_gaps"),
        },
        paper_analyses,
        session=session,
    )
    return {**raw, **normalized}


def _generate_paper_analysis(pdf: PDFDocument, entries: list[HighlightEntry], session: ResearchSession) -> dict[str, Any]:
    client = _get_anthropic()
    prompt = _paper_analysis_prompt(pdf, entries, session)
    msg = client.messages.create(
        model=AI_COMPARISON_MODEL,
        max_tokens=2400,
        temperature=0,
        system=_PAPER_ANALYSIS_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _safe_json_object(msg.content[0].text)
    return _normalize_paper_analysis(pdf, data)


def _generate_session_matrix(session: ResearchSession, paper_analyses: list[dict[str, Any]]) -> dict[str, Any]:
    client = _get_anthropic()
    prompt = _session_matrix_prompt(session, paper_analyses)
    msg = client.messages.create(
        model=AI_COMPARISON_MODEL,
        max_tokens=3600,
        temperature=0,
        system=_SESSION_MATRIX_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _safe_json_object(msg.content[0].text)
    return _normalize_session_matrix(data, paper_analyses, session=session)


def _entries_by_pdf(db: Session, pdf_ids: list[int]) -> dict[int, list[HighlightEntry]]:
    if not pdf_ids:
        return {}
    entries = (
        db.query(HighlightEntry)
        .filter(HighlightEntry.pdf_id.in_(pdf_ids))
        .order_by(HighlightEntry.created_at.desc())
        .all()
    )
    grouped: dict[int, list[HighlightEntry]] = defaultdict(list)
    for entry in entries:
        grouped[entry.pdf_id].append(entry)
    return grouped


_PAPER_ANALYSIS_SYSTEM = """\
You are a careful literature-review analyst.

Task: analyze ONE PDF for later comparison against other PDFs in the same research session.

Rules:
- Use the provided PDF excerpts as the primary evidence.
- Use reader index/Q&A anchors only as secondary signals of what the reader has already noticed.
- Do not invent claims that are not supported by the excerpts or anchors.
- Prefer concise, high-information summaries that expose crucial distinctions.
- Include page references when the provided source snippets contain page numbers.
- Output ONLY valid JSON. No markdown, commentary, or prose outside JSON.

Required JSON shape:
{
  "paper_type": "research paper | review | book chapter | reference work | other",
  "central_thesis": "...",
  "core_problem": {"summary": "...", "evidence": [{"page": 1, "note": "..."}]},
  "research_question_or_goal": {"summary": "...", "evidence": []},
  "assumptions_and_framing": {"summary": "...", "evidence": []},
  "methodology_or_design": {"summary": "...", "evidence": []},
  "findings_or_results": {"summary": "...", "evidence": []},
  "limitations_or_future_scope": {"summary": "...", "evidence": []},
  "distinctive_contribution": {"summary": "...", "evidence": []},
  "reader_learning_takeaways": ["...", "..."],
  "comparison_hooks": ["axis or distinction this paper should be compared on", "..."],
  "confidence": "high | medium | low"
}
"""


_SESSION_MATRIX_SYSTEM = """\
You are building a comparative literature-review table for a reader's research session.

Task: compare the provided paper analyses.

Rules:
- The columns are papers. The rows are comparison dimensions.
- Use the paper analyses as the main source; do not invent missing claims.
- Include fixed scholarly dimensions plus session-specific dimensions that reveal crucial differences.
- You MUST produce at least 3 session-specific dimensions beyond the fixed scholarly dimensions.
- Session-specific dimensions should be tailored to these papers, such as target reader, intervention layer, intelligence strategy, control structure, evaluation style, retention target, or other distinctions actually grounded in the analyses.
- A useful row must help a reader distinguish the papers, not merely summarize them separately.
- Each cell should state what is distinctive about that paper on that axis.
- Each cell's "crucial_difference" must be a direct contrast against the other papers, not a generic placeholder.
- Keep cells concise but substantive enough to support at-a-glance comparison.
- If a paper lacks evidence for a dimension, say so explicitly.
- You MUST return 3-5 cross_paper_insights and 2-4 research_gaps.
- Output ONLY valid JSON. No markdown, commentary, or prose outside JSON.

Required JSON shape:
{
  "session_axes": [
    {"key": "short_snake_case", "label": "Readable label", "description": "Why this axis matters"}
  ],
  "matrix": [
    {
      "key": "short_snake_case",
      "label": "Readable label",
      "description": "What this row compares",
      "cells": [
        {
          "pdf_id": 1,
          "summary": "Substantive cell text",
          "crucial_difference": "The contrast that matters",
          "evidence_refs": [{"page": 1, "note": "short evidence note"}],
          "confidence": "high | medium | low"
        }
      ]
    }
  ],
  "cross_paper_insights": [
    {"title": "...", "summary": "...", "papers": [1, 2]}
  ],
  "research_gaps": [
    {"gap": "...", "why_it_matters": "...", "suggested_next_question": "..."}
  ]
}
"""


FIXED_AI_AXES = [
    {
        "key": "core_problem",
        "label": "Core Problem",
        "description": "What problem or learning barrier the work is trying to address.",
    },
    {
        "key": "assumptions_and_framing",
        "label": "Assumptions / Framing",
        "description": "What the work assumes about readers, learning, evidence, or the domain.",
    },
    {
        "key": "methodology_or_design",
        "label": "Methodology / Design",
        "description": "How the work studies, builds, evaluates, or organizes its intervention.",
    },
    {
        "key": "findings_or_results",
        "label": "Findings / Results",
        "description": "What the work found, demonstrated, or claims as its main result.",
    },
    {
        "key": "distinctive_contribution",
        "label": "Distinctive Contribution",
        "description": "What this source adds that the others do not clearly add.",
    },
    {
        "key": "limitations_or_future_scope",
        "label": "Limitations / Future Scope",
        "description": "What remains weak, unresolved, or useful to investigate next.",
    },
]

DERIVED_AI_AXES = [
    {
        "key": "target_reader",
        "label": "Target Reader / Learner",
        "description": "Who the system is primarily built for and what level of prior knowledge it assumes.",
        "keywords": ("reader", "learner", "student", "consumer", "patient", "researcher", "novice", "expert"),
    },
    {
        "key": "support_stage",
        "label": "Where Support Enters",
        "description": "At what stage of the learning pipeline the intervention helps: skimming, reading, or retention.",
        "keywords": ("skimming", "reading", "retention", "recall", "flashcard", "during reading", "post-reading"),
    },
    {
        "key": "intelligence_strategy",
        "label": "Intelligence Strategy",
        "description": "What kind of AI/NLP or modeling strategy drives the intervention.",
        "keywords": ("highlight", "summary", "question", "nlp", "retrieval", "bert", "semantic", "generation"),
    },
    {
        "key": "reader_control",
        "label": "Reader Control Model",
        "description": "How much control the reader has versus how much the system automates the learning support.",
        "keywords": ("control", "configurable", "guidance", "adaptive", "personalized", "automated", "scheduler"),
    },
    {
        "key": "evaluation_strategy",
        "label": "Evaluation Strategy",
        "description": "What kind of evidence is used to validate the approach.",
        "keywords": ("evaluation", "study", "deployment", "user study", "offline", "online", "metrics"),
    },
]


def _paper_analysis_prompt(pdf: PDFDocument, entries: list[HighlightEntry], session: ResearchSession) -> str:
    return f"""\
Research session:
- Title: {session.title}
- Topic: {session.topic or "not specified"}
- Context/goals: {session.context or "not specified"}

PDF:
- id: {pdf.id}
- title: {pdf.title}
- pages: {pdf.page_count}

PDF source excerpts:
{_pdf_source_bundle(pdf)}

Reader index / Q&A anchors:
{_reader_anchor_bundle(entries)}
"""


def _session_matrix_prompt(session: ResearchSession, paper_analyses: list[dict[str, Any]]) -> str:
    fixed_axes = "\n".join(f"- {axis['label']}: {axis['description']}" for axis in FIXED_AI_AXES)
    return f"""\
Research session:
- Title: {session.title}
- Topic: {session.topic or "not specified"}
- Context/goals: {session.context or "not specified"}

Fixed dimensions that must appear in the matrix:
{fixed_axes}

Paper analyses:
{json.dumps(paper_analyses, ensure_ascii=False, indent=2)}
"""


def _pdf_source_bundle(pdf: PDFDocument, max_chunks: int = 24) -> str:
    """
    Build a broad, deterministic source sample from the indexed PDF chunks.

    This intentionally does not depend on the reader's index. It samples the opening,
    body, and ending chunks so paper analysis can infer thesis, method, results,
    and limitations from the PDF itself.
    """
    if not pdf.chunk_count:
        return "(No indexed PDF chunks available.)"
    ids = _sample_chunk_ids(pdf, max_chunks=max_chunks)
    if not ids:
        return "(No indexed PDF chunks available.)"
    try:
        got = chroma_service._get_collection().get(ids=ids, include=["documents", "metadatas"])
    except Exception:
        return "(Could not load indexed PDF chunks.)"

    rows = []
    for cid, doc, meta in zip(got.get("ids") or [], got.get("documents") or [], got.get("metadatas") or []):
        if not doc:
            continue
        rows.append(
            f"[{cid} · page {meta.get('page_number', '?')} · chunk {meta.get('chunk_index', '?')}]\n"
            f"{_truncate(doc, 1100)}"
        )
    return "\n\n".join(rows) if rows else "(No indexed PDF chunks available.)"


def _sample_chunk_ids(pdf: PDFDocument, max_chunks: int) -> list[str]:
    count = max(pdf.chunk_count or 0, 0)
    if count <= 0:
        return []
    if count <= max_chunks:
        indexes = list(range(count))
    else:
        opening = list(range(min(6, count)))
        ending = list(range(max(0, count - 6), count))
        remaining_slots = max_chunks - len(set(opening + ending))
        step = max((count - 12) // max(remaining_slots, 1), 1)
        middle = list(range(6, max(6, count - 6), step))[:remaining_slots]
        indexes = sorted(set(opening + middle + ending))[:max_chunks]
    return [f"pdf_{pdf.id}_chunk_{idx}" for idx in indexes]


def _reader_anchor_bundle(entries: list[HighlightEntry], max_entries: int = 14) -> str:
    if not entries:
        return "(No saved reader index/Q&A anchors yet.)"
    rows = []
    for entry in entries[:max_entries]:
        qas = [qa for qa in entry.qa_pairs if qa.archived_at is None][:3]
        qa_text = "\n".join(
            f"Q: {qa.study_question or qa.question}\nA: {_truncate(qa.answer, 420)}"
            for qa in qas
        )
        rows.append(
            f"[page {entry.page_number or '?'} · {entry.section_title or 'unlabeled section'}]\n"
            f"Highlight: {_truncate(entry.highlight_text, 360)}\n"
            f"Concepts: {', '.join(entry.concepts or []) or 'none'}\n"
            f"{qa_text or 'No Q&A pairs.'}"
        )
    return "\n\n".join(rows)


def _safe_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _normalize_paper_analysis(pdf: PDFDocument, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "pdf_id": pdf.id,
        "title": pdf.title,
        "paper_type": _string(data.get("paper_type"), "other"),
        "central_thesis": _string(data.get("central_thesis")),
        "core_problem": _section_object(data.get("core_problem")),
        "research_question_or_goal": _section_object(data.get("research_question_or_goal")),
        "assumptions_and_framing": _section_object(data.get("assumptions_and_framing")),
        "methodology_or_design": _section_object(data.get("methodology_or_design")),
        "findings_or_results": _section_object(data.get("findings_or_results")),
        "limitations_or_future_scope": _section_object(data.get("limitations_or_future_scope")),
        "distinctive_contribution": _section_object(data.get("distinctive_contribution")),
        "reader_learning_takeaways": _string_list(data.get("reader_learning_takeaways"), limit=6),
        "comparison_hooks": _string_list(data.get("comparison_hooks"), limit=8),
        "confidence": _confidence(data.get("confidence")),
    }


def _normalize_session_matrix(
    data: dict[str, Any],
    paper_analyses: list[dict[str, Any]],
    session: ResearchSession | None = None,
) -> dict[str, Any]:
    paper_ids = [paper["pdf_id"] for paper in paper_analyses]
    paper_by_id = {paper["pdf_id"]: paper for paper in paper_analyses}
    axes = _normalize_axes(data.get("session_axes"))
    rows = data.get("matrix") if isinstance(data.get("matrix"), list) else []
    matrix = [_normalize_matrix_row(row, paper_ids, paper_by_id) for row in rows if isinstance(row, dict)]
    matrix = [row for row in matrix if row]

    existing = {row["key"] for row in matrix}
    for axis in FIXED_AI_AXES:
        if axis["key"] not in existing:
            matrix.insert(len([a for a in FIXED_AI_AXES if a["key"] in existing]), _fallback_matrix_row(axis, paper_ids, paper_by_id))
            existing.add(axis["key"])

    derived_axes = _derive_session_axes(paper_analyses)
    axes = _merge_axes(axes, derived_axes)
    for axis in axes:
        if axis["key"] not in existing:
            matrix.append(_derived_axis_row(axis, paper_analyses))
            existing.add(axis["key"])

    matrix = [_enrich_row_contrasts(row, paper_by_id) for row in matrix]
    insights = _normalize_insights(data.get("cross_paper_insights"), paper_ids)
    if len(insights) < 3:
        insights = _fallback_cross_paper_insights(paper_analyses)
    gaps = _normalize_gaps(data.get("research_gaps"))
    if len(gaps) < 2:
        gaps = _merge_gap_lists(gaps, _fallback_research_gaps(session, paper_analyses, matrix))

    return {
        "session_axes": axes[:5],
        "matrix": matrix[:12],
        "cross_paper_insights": insights[:5],
        "research_gaps": gaps[:5],
        "reader_guidance": _reader_guidance(paper_analyses),
    }


def _normalize_axes(value: Any) -> list[dict[str, str]]:
    axes = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        label = _string(item.get("label"))
        if not label:
            continue
        axes.append({
            "key": _key(item.get("key") or label),
            "label": label,
            "description": _string(item.get("description")),
        })
    return axes[:8]


def _normalize_matrix_row(row: dict[str, Any], paper_ids: list[int], paper_by_id: dict[int, dict[str, Any]]) -> dict[str, Any] | None:
    label = _string(row.get("label"))
    key = _key(row.get("key") or label)
    if not label or not key:
        return None
    raw_cells = row.get("cells") if isinstance(row.get("cells"), list) else []
    cells_by_pdf = {}
    for cell in raw_cells:
        if not isinstance(cell, dict):
            continue
        try:
            pdf_id = int(cell.get("pdf_id"))
        except (TypeError, ValueError):
            continue
        if pdf_id in paper_ids:
            cells_by_pdf[pdf_id] = _normalize_matrix_cell(pdf_id, cell)
    cells = [
        cells_by_pdf.get(pdf_id) or _fallback_cell(pdf_id, key, paper_by_id.get(pdf_id, {}))
        for pdf_id in paper_ids
    ]
    return {
        "key": key,
        "label": label,
        "description": _string(row.get("description")),
        "cells": cells,
    }


def _fallback_matrix_row(axis: dict[str, str], paper_ids: list[int], paper_by_id: dict[int, dict[str, Any]]) -> dict[str, Any]:
    return {
        "key": axis["key"],
        "label": axis["label"],
        "description": axis["description"],
        "cells": [_fallback_cell(pdf_id, axis["key"], paper_by_id.get(pdf_id, {})) for pdf_id in paper_ids],
    }


def _fallback_cell(pdf_id: int, axis_key: str, paper: dict[str, Any]) -> dict[str, Any]:
    section = paper.get(axis_key) if isinstance(paper.get(axis_key), dict) else {}
    summary = _string(section.get("summary")) or "No AI-supported analysis available for this dimension."
    return {
        "pdf_id": pdf_id,
        "summary": summary,
        "crucial_difference": "",
        "evidence_refs": section.get("evidence") if isinstance(section.get("evidence"), list) else [],
        "confidence": _confidence(paper.get("confidence")),
    }


def _normalize_matrix_cell(pdf_id: int, cell: dict[str, Any]) -> dict[str, Any]:
    return {
        "pdf_id": pdf_id,
        "summary": _string(cell.get("summary"), "No supported claim provided."),
        "crucial_difference": _string(cell.get("crucial_difference")),
        "evidence_refs": _evidence_refs(cell.get("evidence_refs")),
        "confidence": _confidence(cell.get("confidence")),
    }


def _normalize_insights(value: Any, paper_ids: list[int]) -> list[dict[str, Any]]:
    insights = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        title = _string(item.get("title"))
        summary = _string(item.get("summary"))
        if not title or not summary:
            continue
        papers = []
        for pdf_id in item.get("papers") or []:
            try:
                if int(pdf_id) in paper_ids:
                    papers.append(int(pdf_id))
            except (TypeError, ValueError):
                continue
        insights.append({"title": title, "summary": summary, "papers": papers})
    return insights[:6]


def _normalize_gaps(value: Any) -> list[dict[str, str]]:
    gaps = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        gap = _string(item.get("gap"))
        if not gap:
            continue
        gaps.append({
            "gap": gap,
            "why_it_matters": _string(item.get("why_it_matters")),
            "suggested_next_question": _string(item.get("suggested_next_question")),
        })
    return gaps[:8]


def _merge_gap_lists(primary: list[dict[str, str]], secondary: list[dict[str, str]]) -> list[dict[str, str]]:
    merged = []
    seen = set()
    for gap in [*primary, *secondary]:
        key = (_string(gap.get("gap")), _string(gap.get("suggested_next_question")))
        if key in seen or not key[0]:
            continue
        seen.add(key)
        merged.append(gap)
    return merged


def _merge_axes(existing: list[dict[str, str]], derived: list[dict[str, str]]) -> list[dict[str, str]]:
    merged = []
    seen = set()
    for axis in [*existing, *derived]:
        key = axis["key"]
        if key in seen:
            continue
        seen.add(key)
        merged.append(axis)
    return merged


def _derive_session_axes(paper_analyses: list[dict[str, Any]]) -> list[dict[str, str]]:
    scored = []
    for axis in DERIVED_AI_AXES:
        values = [_classify_axis(axis["key"], paper) for paper in paper_analyses]
        diversity = len({value for value in values if value})
        text_hits = sum(1 for paper in paper_analyses if any(keyword in _paper_text(paper) for keyword in axis["keywords"]))
        score = diversity * 10 + text_hits
        if diversity >= 2 or text_hits >= 2:
            scored.append((score, axis))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [axis for _, axis in scored[:4]]


def _derived_axis_row(axis: dict[str, str], paper_analyses: list[dict[str, Any]]) -> dict[str, Any]:
    values = {paper["pdf_id"]: _classify_axis(axis["key"], paper) for paper in paper_analyses}
    titles = {paper["pdf_id"]: paper["title"] for paper in paper_analyses}
    return {
        "key": axis["key"],
        "label": axis["label"],
        "description": axis["description"],
        "cells": [
            {
                "pdf_id": paper["pdf_id"],
                "summary": _axis_summary(axis["key"], paper),
                "crucial_difference": _contrast_phrase(values[paper["pdf_id"]], paper["pdf_id"], values, titles),
                "evidence_refs": _axis_evidence(axis["key"], paper),
                "confidence": _confidence(paper.get("confidence")),
            }
            for paper in paper_analyses
        ],
    }


def _enrich_row_contrasts(row: dict[str, Any], paper_by_id: dict[int, dict[str, Any]]) -> dict[str, Any]:
    titles = {pdf_id: paper["title"] for pdf_id, paper in paper_by_id.items()}
    values = {}
    if row["key"] in {axis["key"] for axis in DERIVED_AI_AXES}:
        values = {pdf_id: _classify_axis(row["key"], paper) for pdf_id, paper in paper_by_id.items()}
    else:
        values = {pdf_id: _fixed_axis_difference_value(row["key"], paper) for pdf_id, paper in paper_by_id.items()}

    enriched_cells = []
    for cell in row["cells"]:
        crucial = _string(cell.get("crucial_difference"))
        if not crucial or crucial.lower().startswith("not yet distinguished"):
            crucial = _contrast_phrase(values.get(cell["pdf_id"], ""), cell["pdf_id"], values, titles)
        enriched_cells.append({**cell, "crucial_difference": crucial})
    return {**row, "cells": enriched_cells}


def _fixed_axis_difference_value(axis_key: str, paper: dict[str, Any]) -> str:
    if axis_key in {"core_problem", "assumptions_and_framing"}:
        return _classify_axis("target_reader", paper)
    if axis_key in {"methodology_or_design", "distinctive_contribution"}:
        return _classify_axis("intelligence_strategy", paper)
    if axis_key == "findings_or_results":
        return _classify_axis("evaluation_strategy", paper)
    if axis_key == "limitations_or_future_scope":
        return _first_claim(paper.get("limitations_or_future_scope", {}).get("summary", ""))
    return _first_claim(paper.get(axis_key, {}).get("summary", ""))


def _fallback_cross_paper_insights(paper_analyses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(paper_analyses) < 2:
        return []
    insights = []
    titles = {paper["pdf_id"]: paper["title"] for paper in paper_analyses}

    support_values = {paper["pdf_id"]: _classify_axis("support_stage", paper) for paper in paper_analyses}
    if len(set(support_values.values())) > 1:
        insights.append({
            "title": "The papers intervene at different stages of learning",
            "summary": _insight_summary(support_values, titles),
            "papers": list(titles.keys()),
        })

    strategy_values = {paper["pdf_id"]: _classify_axis("intelligence_strategy", paper) for paper in paper_analyses}
    if len(set(strategy_values.values())) > 1:
        insights.append({
            "title": "They operationalize intelligence in different ways",
            "summary": _insight_summary(strategy_values, titles),
            "papers": list(titles.keys()),
        })

    eval_values = {paper["pdf_id"]: _classify_axis("evaluation_strategy", paper) for paper in paper_analyses}
    if len(set(eval_values.values())) > 1:
        insights.append({
            "title": "Their evidence standards are not the same",
            "summary": _insight_summary(eval_values, titles),
            "papers": list(titles.keys()),
        })

    control_values = {paper["pdf_id"]: _classify_axis("reader_control", paper) for paper in paper_analyses}
    if len(set(control_values.values())) > 1:
        insights.append({
            "title": "They distribute agency differently between system and reader",
            "summary": _insight_summary(control_values, titles),
            "papers": list(titles.keys()),
        })

    return insights[:5]


def _fallback_research_gaps(
    session: ResearchSession | None,
    paper_analyses: list[dict[str, Any]],
    matrix: list[dict[str, Any]],
) -> list[dict[str, str]]:
    if len(paper_analyses) < 2:
        return []

    gaps: list[dict[str, str]] = []
    stage_values = {paper["title"]: _classify_axis("support_stage", paper) for paper in paper_analyses}
    if len(set(stage_values.values())) > 1:
        gaps.append({
            "gap": "The session does not yet connect the full learning pipeline across these papers.",
            "why_it_matters": (
                "The sources emphasize different stages such as skimming, in-reading comprehension, and post-reading retention, "
                "so the reader still lacks a unified account of how these supports should work together."
            ),
            "suggested_next_question": "How would these papers combine into a single end-to-end learning workflow for one reader?",
        })

    control_values = {paper["title"]: _classify_axis("reader_control", paper) for paper in paper_analyses}
    if len(set(control_values.values())) > 1:
        gaps.append({
            "gap": "The tradeoff between automation and reader control remains unresolved across the session.",
            "why_it_matters": (
                "One paper may optimize guidance or automation while another preserves more user control, "
                "and that design choice changes trust, cognitive load, and transfer."
            ),
            "suggested_next_question": "When should a learning interface automate support, and when should it keep the reader in control?",
        })

    eval_values = {paper["title"]: _classify_axis("evaluation_strategy", paper) for paper in paper_analyses}
    if len(set(eval_values.values())) > 1:
        gaps.append({
            "gap": "The papers are not evaluated on a common standard.",
            "why_it_matters": (
                "Without aligned evaluation criteria, it is difficult to judge whether one approach improves comprehension, navigation, or retention more effectively than another."
            ),
            "suggested_next_question": "What common evaluation benchmark would let these approaches be compared fairly?",
        })

    context_gap = _session_context_gap(session, paper_analyses)
    if context_gap:
        gaps.append(context_gap)

    weak_rows = [row["label"] for row in matrix if _row_has_sparse_evidence(row)]
    if weak_rows:
        gaps.append({
            "gap": f"Some important comparison rows still rely on thin evidence: {', '.join(weak_rows[:3])}.",
            "why_it_matters": (
                "A comparison table is only trustworthy when each row is supported by enough page-linked evidence to distinguish the papers cleanly."
            ),
            "suggested_next_question": "Which of these weak rows should be strengthened first by asking targeted questions and logging the answers?",
        })

    return gaps[:5]


def _session_context_gap(session: ResearchSession | None, paper_analyses: list[dict[str, Any]]) -> dict[str, str] | None:
    if session is None:
        return None
    context_terms = _important_terms(" ".join([session.title or "", session.topic or "", session.context or ""]))
    if not context_terms:
        return None
    paper_text = " ".join(_paper_text(paper) for paper in paper_analyses)
    missing = [term for term in context_terms if term not in paper_text][:3]
    if not missing:
        return None
    return {
        "gap": f"The current paper set does not clearly cover part of the session goal: {', '.join(missing)}.",
        "why_it_matters": (
            "If the comparison is supposed to support the session goal, uncovered goal terms indicate that the session may still be missing evidence, indexing, or a relevant paper."
        ),
        "suggested_next_question": f"Which paper in this session, if any, addresses {missing[0]}, and if none do, what source should be added?",
    }


def _row_has_sparse_evidence(row: dict[str, Any]) -> bool:
    weak = 0
    for cell in row.get("cells", []):
        refs = cell.get("evidence_refs") if isinstance(cell.get("evidence_refs"), list) else []
        summary = _string(cell.get("summary")).lower()
        if not refs or "no ai-supported analysis" in summary or "no supported claim" in summary:
            weak += 1
    return weak >= max(1, len(row.get("cells", [])) - 1)


def _reader_guidance(paper_analyses: list[dict[str, Any]]) -> list[dict[str, str | int]]:
    guidance = []
    titles = {paper["pdf_id"]: paper["title"] for paper in paper_analyses}
    strategy_values = {paper["pdf_id"]: _classify_axis("intelligence_strategy", paper) for paper in paper_analyses}
    for paper in paper_analyses:
        pdf_id = paper["pdf_id"]
        guidance.append({
            "pdf_id": pdf_id,
            "best_for": _best_for_summary(paper),
            "distinctive_angle": _contrast_phrase(strategy_values.get(pdf_id, ""), pdf_id, strategy_values, titles),
            "use_with": _pairing_advice(paper, paper_analyses),
            "watch_for": _watch_for_summary(paper),
        })
    return guidance[:8]


def _best_for_summary(paper: dict[str, Any]) -> str:
    target = _classify_axis("target_reader", paper)
    stage = _classify_axis("support_stage", paper)
    problem = _first_claim(paper.get("core_problem", {}).get("summary", ""), word_limit=18)
    if problem:
        return f"Best when the reader needs support for {problem.lower()} and the session calls for {stage.lower()} for {target.lower()}."
    return f"Best when the session calls for {stage.lower()} for {target.lower()}."


def _watch_for_summary(paper: dict[str, Any]) -> str:
    limitation = _first_claim(paper.get("limitations_or_future_scope", {}).get("summary", ""), word_limit=18)
    if limitation:
        return limitation
    return "Evidence boundaries are not explicit yet; inspect the paper’s method and result sections before over-generalizing."


def _pairing_advice(paper: dict[str, Any], paper_analyses: list[dict[str, Any]]) -> str:
    this_stage = _classify_axis("support_stage", paper)
    this_strategy = _classify_axis("intelligence_strategy", paper)
    for other in paper_analyses:
        if other["pdf_id"] == paper["pdf_id"]:
            continue
        other_stage = _classify_axis("support_stage", other)
        other_strategy = _classify_axis("intelligence_strategy", other)
        if this_stage != other_stage or this_strategy != other_strategy:
            return (
                f"Pair with {other['title']} to contrast {this_stage.lower()} against {other_stage.lower()} "
                f"and {this_strategy.lower()} against {other_strategy.lower()}."
            )
    return "Pair with the other papers to verify whether this source’s contribution is genuinely distinct or just differently phrased."


def _important_terms(text: str, limit: int = 8) -> list[str]:
    stopwords = {
        "the", "and", "for", "with", "that", "this", "from", "into", "have", "will", "your", "their", "them",
        "goal", "goals", "research", "session", "paper", "papers", "study", "studies", "reader", "readers",
        "context", "topic", "using", "used", "use", "about", "through", "across", "more", "than", "what",
        "when", "where", "which", "into", "help", "helps", "turn", "work", "works",
    }
    counts = Counter()
    for token in re.findall(r"[a-z][a-z0-9_-]{3,}", _string(text).lower()):
        if token in stopwords:
            continue
        counts[token] += 1
    return [term for term, _ in counts.most_common(limit)]


def _insight_summary(values: dict[int, str], titles: dict[int, str]) -> str:
    parts = [f"{titles[pdf_id]} emphasizes {value.lower()}" for pdf_id, value in values.items()]
    return "; ".join(parts) + "."


def _classify_axis(axis_key: str, paper: dict[str, Any]) -> str:
    text = _paper_text(paper)
    if axis_key == "target_reader":
        if any(token in text for token in ("healthcare consumer", "patient", "medical reader", "non-expert")):
            return "Healthcare consumers and novice medical readers"
        if any(token in text for token in ("researcher", "skimming", "scientific papers", "paper skimmers")):
            return "Researchers skimming scientific papers"
        if any(token in text for token in ("student", "flashcard", "retrieval practice", "learner")):
            return "Students doing retrieval practice"
        return "General readers working through complex documents"

    if axis_key == "support_stage":
        if any(token in text for token in ("flashcard", "retention", "scheduler", "recall", "study history")):
            return "After reading, by scheduling retention and recall"
        if any(token in text for token in ("skimming", "highlighting", "skim papers")):
            return "At the skimming stage, by guiding attention before deep reading"
        if any(token in text for token in ("term definitions", "section summaries", "key question", "healthcare consumer")):
            return "During reading, by scaffolding comprehension inside the document"
        return "During document interaction"

    if axis_key == "intelligence_strategy":
        if any(token in text for token in ("bert", "retrieval", "dkt", "semantic", "scheduler")):
            return "Semantic retrieval plus learner-state modeling"
        if any(token in text for token in ("term definitions", "section summaries", "key question", "plain language", "nlp")):
            return "Multi-level NLP explanation and navigation support"
        if any(token in text for token in ("highlight", "rhetorical", "facet", "faceted")):
            return "Faceted rhetorical highlighting and salience guidance"
        return "Document-grounded AI assistance"

    if axis_key == "reader_control":
        if any(token in text for token in ("configurable", "density", "global and local", "user control")):
            return "High direct reader control over support"
        if any(token in text for token in ("key question", "guides readers", "support at multiple levels", "scaffolding")):
            return "Guided navigation with bounded reader choice"
        if any(token in text for token in ("scheduler", "predict", "content-aware scheduling", "automatic")):
            return "Automation-led support with limited direct control"
        return "Mixed system guidance and reader choice"

    if axis_key == "evaluation_strategy":
        if any(token in text for token in ("offline metrics", "online evaluation", "auc", "study logs")):
            return "Offline prediction metrics plus online learning evaluation"
        if any(token in text for token in ("deployment study", "diary", "usability study")):
            return "Lab usability plus deployment evidence"
        if any(token in text for token in ("within-subjects", "reading difficulty", "comprehension", "mixed models")):
            return "Controlled comparative reading study"
        return "Exploratory empirical evaluation"

    return ""


def _axis_summary(axis_key: str, paper: dict[str, Any]) -> str:
    value = _classify_axis(axis_key, paper)
    if axis_key == "target_reader":
        return f"This work is primarily oriented toward {value.lower()}."
    if axis_key == "support_stage":
        return f"The intervention enters {value.lower()}."
    if axis_key == "intelligence_strategy":
        return f"It relies on {value.lower()} as the core intelligence layer."
    if axis_key == "reader_control":
        return f"It adopts {value.lower()}."
    if axis_key == "evaluation_strategy":
        return f"It is validated through {value.lower()}."
    return value


def _axis_evidence(axis_key: str, paper: dict[str, Any]) -> list[dict[str, Any]]:
    if axis_key in {"target_reader", "support_stage"}:
        refs = paper.get("core_problem", {}).get("evidence", []) + paper.get("research_question_or_goal", {}).get("evidence", [])
        return refs[:3]
    if axis_key in {"intelligence_strategy", "reader_control"}:
        refs = paper.get("methodology_or_design", {}).get("evidence", []) + paper.get("distinctive_contribution", {}).get("evidence", [])
        return refs[:3]
    if axis_key == "evaluation_strategy":
        refs = paper.get("findings_or_results", {}).get("evidence", []) + paper.get("methodology_or_design", {}).get("evidence", [])
        return refs[:3]
    return []


def _contrast_phrase(value: str, pdf_id: int, values: dict[int, str], titles: dict[int, str]) -> str:
    value = _string(value)
    if not value:
        return ""
    same = [titles[other_id] for other_id, other_value in values.items() if other_id != pdf_id and other_value == value]
    different = [titles[other_id] for other_id, other_value in values.items() if other_id != pdf_id and other_value != value]
    if not same and different:
        return f"Only this paper emphasizes {value.lower()}."
    if same and different:
        return f"It shares {value.lower()} with {', '.join(same)} rather than {', '.join(different)}."
    if same and not different:
        return f"All papers converge on {value.lower()}."
    return ""


def _paper_text(paper: dict[str, Any]) -> str:
    parts = [
        paper.get("title", ""),
        paper.get("central_thesis", ""),
        paper.get("core_problem", {}).get("summary", ""),
        paper.get("research_question_or_goal", {}).get("summary", ""),
        paper.get("assumptions_and_framing", {}).get("summary", ""),
        paper.get("methodology_or_design", {}).get("summary", ""),
        paper.get("findings_or_results", {}).get("summary", ""),
        paper.get("limitations_or_future_scope", {}).get("summary", ""),
        paper.get("distinctive_contribution", {}).get("summary", ""),
        " ".join(paper.get("comparison_hooks") or []),
    ]
    return " ".join(parts).lower()


def _first_claim(text: str, word_limit: int = 16) -> str:
    clean = _string(text)
    if not clean:
        return ""
    sentence = re.split(r"(?<=[.!?])\s+", clean, maxsplit=1)[0]
    words = sentence.split()
    return " ".join(words[:word_limit]).rstrip(" ,;:")


def _section_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"summary": _string(value), "evidence": []}
    return {
        "summary": _string(value.get("summary")),
        "evidence": _evidence_refs(value.get("evidence")),
    }


def _evidence_refs(value: Any) -> list[dict[str, Any]]:
    refs = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, dict):
            continue
        page = item.get("page")
        try:
            page = int(page) if page is not None else None
        except (TypeError, ValueError):
            page = None
        note = _string(item.get("note"))
        if note:
            refs.append({"page": page, "note": note})
    return refs[:4]


def _string(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return re.sub(r"\s+", " ", str(value)).strip() or default


def _string_list(value: Any, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_string(item) for item in value if _string(item)][:limit]


def _confidence(value: Any) -> str:
    text = _string(value, "medium").lower()
    return text if text in {"high", "medium", "low"} else "medium"


def _key(value: Any) -> str:
    text = _string(value).lower()
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text[:60]


def _paper_summary(pdf: PDFDocument, entries: list[HighlightEntry]) -> dict[str, Any]:
    qas = _qas(entries)
    due_count = sum(1 for qa in qas if _is_due(qa.due_at))
    concepts = Counter(_paper_concepts(pdf, entries))
    facets = Counter((qa.rhetorical_facet or "uncategorized") for qa in qas)
    return {
        "pdf_id": pdf.id,
        "title": pdf.title,
        "page_count": pdf.page_count,
        "chunk_count": pdf.chunk_count,
        "topics": _ontology_topics(pdf),
        "top_concepts": [{"label": label, "count": count} for label, count in concepts.most_common(8)],
        "facet_counts": dict(facets),
        "index_entry_count": len(entries),
        "qa_count": len(qas),
        "due_count": due_count,
        "reviewed_count": sum(1 for qa in qas if qa.reps and qa.reps > 0),
        "starred_count": sum(1 for qa in qas if qa.starred),
    }


def _baseline_row(dim: dict[str, Any], pdfs: list[PDFDocument], entries_by_pdf: dict[int, list[HighlightEntry]]) -> dict[str, Any]:
    cells = []
    for pdf in pdfs:
        evidence = _matching_evidence(entries_by_pdf.get(pdf.id, []), dim["keywords"], dim["facets"])
        cells.append({
            "pdf_id": pdf.id,
            "pdf_title": pdf.title,
            "coverage": _coverage_label(len(evidence)),
            "evidence_count": len(evidence),
            "summary": _evidence_summary(evidence),
            "sources": evidence[:3],
        })
    return {
        "key": dim["key"],
        "label": dim["label"],
        "description": dim["description"],
        "cells": cells,
    }


def _topic_dimensions(pdfs: list[PDFDocument], entries_by_pdf: dict[int, list[HighlightEntry]]) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    per_pdf: dict[int, Counter[str]] = {}
    for pdf in pdfs:
        concepts = Counter(_paper_concepts(pdf, entries_by_pdf.get(pdf.id, [])))
        per_pdf[pdf.id] = concepts
        counts.update(concepts)

    dimensions = []
    for label, total in counts.most_common(10):
        cells = []
        for pdf in pdfs:
            count = per_pdf.get(pdf.id, Counter()).get(label, 0)
            cells.append({
                "pdf_id": pdf.id,
                "pdf_title": pdf.title,
                "count": count,
                "coverage": _coverage_label(count),
            })
        dimensions.append({
            "label": label,
            "total_count": total,
            "cells": cells,
        })
    return dimensions


def _gap_panel(
    session: ResearchSession,
    papers: list[dict[str, Any]],
    baseline: list[dict[str, Any]],
    topic_dimensions: list[dict[str, Any]],
) -> dict[str, Any]:
    missing = []
    for row in baseline:
        uncovered = [cell["pdf_title"] for cell in row["cells"] if cell["coverage"] == "none"]
        if uncovered:
            missing.append({
                "dimension": row["label"],
                "message": f"No indexed evidence yet for {len(uncovered)} paper(s): {', '.join(uncovered[:3])}.",
            })

    sparse_topics = [
        dim["label"] for dim in topic_dimensions
        if sum(1 for cell in dim["cells"] if cell["count"] > 0) <= 1 and len(papers) > 1
    ][:6]

    return {
        "session_goal": session.context or session.topic or session.title,
        "coverage_warnings": missing[:8],
        "session_specific_gaps": [
            {
                "topic": topic,
                "message": "Only one paper currently has indexed evidence for this topic; compare coverage after more indexing or review.",
            }
            for topic in sparse_topics
        ],
        "recommended_next_actions": _recommended_next_actions(papers, missing, sparse_topics),
    }


def _recommended_next_actions(
    papers: list[dict[str, Any]],
    missing: list[dict[str, Any]],
    sparse_topics: list[str],
) -> list[str]:
    actions = []
    if any(paper["index_entry_count"] == 0 for paper in papers):
        actions.append("Index at least one core problem, method, and finding passage for papers with no entries.")
    if missing:
        actions.append("Ask targeted questions about missing dimensions, then log useful answers to the index.")
    if sparse_topics:
        actions.append("Use the topic gaps as prompts for cross-paper questions before relying on the comparison table.")
    if not actions:
        actions.append("Coverage is sufficient for a first-pass comparison; review weak cards to strengthen retention data.")
    return actions


def _matching_evidence(
    entries: list[HighlightEntry],
    keywords: tuple[str, ...],
    facets: set[str],
) -> list[dict[str, Any]]:
    matches = []
    for entry in entries:
        for qa in entry.qa_pairs:
            if qa.archived_at is not None:
                continue
            haystack = " ".join([
                qa.study_question or "",
                qa.question or "",
                entry.highlight_text or "",
                entry.section_title or "",
                " ".join(entry.concepts or []),
                " ".join(qa.topic_tags or []),
            ]).lower()
            if (qa.rhetorical_facet in facets) or any(keyword in haystack for keyword in keywords):
                matches.append({
                    "page_number": entry.page_number,
                    "highlight_id": entry.id,
                    "qa_id": qa.id,
                    "question": qa.study_question or qa.question,
                    "answer_preview": _truncate(qa.answer, 220),
                    "facet": qa.rhetorical_facet or "uncategorized",
                    "concepts": (qa.topic_tags or entry.concepts or [])[:5],
                })
    return matches


def _evidence_summary(evidence: list[dict[str, Any]]) -> str:
    if not evidence:
        return "No saved index or review evidence yet."
    first = evidence[0]
    page = f"p.{first['page_number']} " if first.get("page_number") else ""
    return f"{page}{first['question']}"


def _coverage_label(count: int) -> str:
    if count <= 0:
        return "none"
    if count == 1:
        return "thin"
    if count <= 3:
        return "moderate"
    return "strong"


def _qas(entries: list[HighlightEntry]) -> list[QAPair]:
    return [qa for entry in entries for qa in entry.qa_pairs if qa.archived_at is None]


def _paper_concepts(pdf: PDFDocument, entries: list[HighlightEntry]) -> list[str]:
    concepts = []
    concepts.extend(_ontology_topics(pdf))
    for entry in entries:
        concepts.extend([str(c).strip().lower() for c in (entry.concepts or []) if str(c).strip()])
        for qa in entry.qa_pairs:
            if qa.archived_at is not None:
                continue
            concepts.extend([str(c).strip().lower() for c in (qa.topic_tags or []) if str(c).strip()])
    return concepts


def _ontology_topics(pdf: PDFDocument) -> list[str]:
    raw = pdf.ontology_json or {}
    if isinstance(raw, dict):
        topics = raw.get("topics") or []
        return [str(topic).strip().lower() for topic in topics if str(topic).strip()]
    return []


def _truncate(text: str | None, limit: int) -> str:
    clean = " ".join((text or "").split())
    return clean if len(clean) <= limit else f"{clean[:limit].rstrip()}..."


def _is_due(value: datetime | None) -> bool:
    if not value:
        return False
    now = datetime.now(timezone.utc)
    if value.tzinfo is None:
        now = now.replace(tzinfo=None)
    return value <= now
