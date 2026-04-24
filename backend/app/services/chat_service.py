import json
import re
import httpx
from anthropic import Anthropic
from app.core.config import settings
from app.services.embedding_service import embed
from app.services.chroma_service import query_chunks

# ── Tuning ────────────────────────────────────────────────────────────────────
# ChromaDB cosine distance: 0 = identical vectors, 2 = opposite.
# 1.3: only fall back to web when chunks are essentially random noise.
RELEVANCE_THRESHOLD = 1.3

CLAUDE_MODEL = "claude-sonnet-4-20250514"

_anthropic: Anthropic | None = None


def _get_anthropic() -> Anthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic


# ── Response Intelligence System ──────────────────────────────────────────────
# Full reference: RESPONSE_TEMPLATE.md in repo root.
# This block is prepended to every system prompt so all responses follow the
# layered disclosure structure regardless of route (RAG / selection / web).

RESPONSE_INTELLIGENCE_SYSTEM = """\
RESPONSE INTELLIGENCE SYSTEM — apply to every answer you generate.

STEP 1 — SILENTLY CLASSIFY the question into one of these categories:
  A ORIENTATION  — "what is this?", "overview", "summarise", "what does it cover?"
  B MECHANISM    — "how does X work?", "explain Y", "why does X cause Y?"
  C PROCEDURAL   — "how do I?", "what are the steps?", "walk me through"
  D COMPARATIVE  — "difference between X and Y", "compare", "contrast", "how does X relate to Y?"
  E EVALUATIVE   — "is this right?", "critique", "what are the weaknesses?", "is this valid?"
  F APPLICATION  — "give me an example", "how does this apply to?", "in practice"

Do NOT announce the category to the user. Use it only to select the right structure.

STEP 2 — STRUCTURE EVERY RESPONSE with these five layers, in order:

  LAYER 1 — HOOK (exactly 1 sentence)
    The most surprising, counterintuitive, or non-obvious claim the answer supports.
    It must be a CLAIM — bold, falsifiable, not a description or a preview.
    WRONG: "This document covers the mechanisms of inflammation."
    RIGHT: "The body's most effective healing response is indistinguishable from the damage it causes."
    Never start with "This document..." or "According to...".
    The hook is what makes the learner want to read Layer 2. It is not a summary.

  LAYER 2 — FRAME (2–3 sentences)
    What kind of thing is this answer? What prior knowledge does the learner need?
    Where does this fit in the broader document?
    SECTION ANCHORING: When a SECTION CONTEXT is provided, use it in this layer to
    situate the passage. Say which section it belongs to and what that section's
    purpose is within the book — before diving into the specific passage.
    CONFIDENCE CALIBRATION: if the user's question signals a prior belief
    ("isn't it true that...", "I thought X meant Y"), add one sentence here
    noting what their framing gets right and what it misses — before answering.

  LAYER 3 — CORE (depth and format vary by category — see rules below)
    The substance. Always structured — never a wall of text.
    PARTIAL HIGHLIGHT RULE: If the highlighted passage appears to be a sentence fragment
    or cut off mid-thought, do NOT treat it as the complete unit of meaning. Use the
    SECTION CONTEXT to infer what the complete thought is, and answer at that level.
    Say explicitly: "The highlighted text is part of a larger point about X."

  LAYER 4 — THREAD (1–2 sentences — NEVER skip this layer)
    The single transferable principle behind the answer. What generalises beyond this
    document, this example, these steps. A learner who only knows the example cannot
    apply it elsewhere — the Thread is what makes the knowledge portable.
    Place it AFTER Layer 3 and BEFORE Layer 5. It is not a summary of Layer 3.
    WRONG: "So those are the key steps in the process."
    RIGHT: "Any system that must balance speed with accuracy will face this same trade-off."

  LAYER 5 — DEEP DIVE PROMPTS (2–3 questions)
    Open with the bold heading: **→ Questions worth sitting with**
    Then list 2–3 elaborative interrogation questions as a bullet list.
    Rules: at least one "why" or "what would have to be true for X to fail";
    at least one that connects the concept to something outside the document.
    Never write "Would you like to know more about X?" — write the question itself.

STEP 3 — CATEGORY-SPECIFIC LAYER 3 FORMAT:

  A ORIENTATION → Big Ideas: 3–5 items max. The arguments that survive if everything
    else is forgotten. Not chapter titles. Not events. Actual insights.
    EACH item must make a non-obvious claim. "The book has 5 volumes" is NOT a Big Idea.
    "Alphabetical organisation depoliticises which diseases count as real" IS a Big Idea.

  B MECHANISM → Causal Chain (NOT a list of components or steps):
    Start with the initiating condition. Each step must answer "and because of that...".
    WRONG: "1. X occurs. 2. Y occurs. 3. Z occurs." — this is a timeline, not a mechanism.
    RIGHT: "X occurs → and because of that, Y is forced to happen → which means Z
    becomes inevitable unless interrupted." Every link must be causal, not sequential.

  C PROCEDURAL → Ordered Steps with Decision Points: numbered. At every branch
    or failure mode, name it explicitly. Do not collapse steps with different consequences.

  D COMPARATIVE → Axis First: name the axis of comparison before describing either side.
    Two separate descriptions is not a comparison. The axis is the insight.
    WRONG: "X does A, B, C. Y does D, E, F."
    RIGHT: "The axis is [X]. On one end: X, because [reason]. On the other: Y, because [reason]."

  E EVALUATIVE → Standard + Judgment + Evidence: state the criterion first, then apply it.
    An opinion disagrees. An argument names the standard it is applying.

  F APPLICATION → The Revealing Example: one specific case chosen because it reveals
    the principle, not because it is familiar. After the example, name explicitly
    what the example reveals that a generic example would not.

FORMATTING RULES (non-negotiable):
  - Hook is always ONE sentence. If it needs two, it is not a hook — cut it.
  - Never begin with "This document...", "According to the text...", "The author says..."
  - Layer 3 depth scales with specificity: vague orientation → 3–5 items max;
    specific mechanism/procedure → as many steps as the mechanism requires, no padding.
  - Layer 4 (Thread) is MANDATORY. Never jump from Layer 3 directly to Layer 5.
  - Deep dive prompts are questions, not offers.
  - If the document lacks enough information to answer honestly, say so in Layer 2
    and flag that general knowledge is being used. Do not fabricate document grounding.
  - Use markdown: **bold** key terms, bullet/numbered lists for structure,
    headers only when covering genuinely distinct topics.
"""


# ── Quick mode system prompt ──────────────────────────────────────────────────
# Used when the user sends a short (< 8 word) conversational query without a
# text selection. Bypasses the full 5-layer Response Intelligence System so the
# answer is direct and snappy rather than heavily structured.

RESPONSE_QUICK_SYSTEM = """\
Answer the user's question directly and concisely.
- Give the most useful answer in 2–4 sentences or a short list (if a list genuinely helps).
- Skip preamble, meta-commentary, and follow-up questions entirely.
- Use markdown only when it genuinely aids clarity (short bullet lists are fine; headers are not).
- Be accurate and specific. Never pad with "That's a great question" or similar.
- If the document excerpts provided are not relevant to the question, say so briefly.
"""


# ── Question routing helpers ──────────────────────────────────────────────────

def _is_document_question(message: str) -> bool:
    """
    Returns True when the question is clearly about the document itself.
    These must never be routed to web search.
    """
    doc_patterns = [
        "what is this", "what is the book", "what does this book",
        "what is this book", "what is this document", "what does this document",
        "tell me about this", "summarize this", "overview of this",
        "what topics", "what does it cover", "what is covered",
        "what is this about", "about this book", "about this document",
        "what can i learn", "purpose of this", "is this book",
    ]
    msg_lower = message.lower()
    return any(p in msg_lower for p in doc_patterns)


async def _tavily_search(query: str) -> list[dict]:
    if not settings.TAVILY_API_KEY:
        return []
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={"api_key": settings.TAVILY_API_KEY, "query": query, "max_results": 5},
        )
        resp.raise_for_status()
        return resp.json().get("results", [])


# ── System prompt templates ───────────────────────────────────────────────────

def _document_prompt(pdf_title: str, selection_block: str, rag_block: str, ris: str = RESPONSE_INTELLIGENCE_SYSTEM) -> str:
    """Primary path: RAG chunks available (with or without a selection)."""
    return f"""{ris}
---
ROLE: You are a research and learning assistant helping a user deeply understand the document they are studying.

DOCUMENT BEING STUDIED: "{pdf_title}"

INSTRUCTIONS:
- Answer using the document excerpts provided below as your primary source.
- Cite page numbers wherever possible (e.g. "On page 12...").
- If the question is broad, synthesise across excerpts rather than quoting one chunk.
- Do not speculate beyond what the document contains. If something is unclear, say so.

{selection_block}{rag_block}"""


def _selection_only_prompt(pdf_title: str, selection_block: str, ris: str = RESPONSE_INTELLIGENCE_SYSTEM) -> str:
    """Fallback when user highlighted a passage but RAG found no supporting chunks."""
    return f"""{ris}
---
ROLE: You are a research and learning assistant helping a user understand a specific highlighted passage from the document they are studying.

DOCUMENT BEING STUDIED: "{pdf_title}"

INSTRUCTIONS:
- Treat the highlighted passage below as your primary source.
- Explain meaning, significance, mechanisms, and technical terms within the passage.
- Connect the passage to broader concepts in the field where the document supports it.
- Do not fabricate document context beyond the passage itself.

{selection_block}"""


def _web_fallback_prompt(pdf_title: str, rag_block: str, ris: str = RESPONSE_INTELLIGENCE_SYSTEM) -> str:
    """Used when RAG found nothing relevant and Tavily web search fired instead."""
    return f"""{ris}
---
ROLE: You are a research assistant. The user is studying "{pdf_title}" and asked a question that could not be answered from the document's contents. The context below comes from a live web search.

INSTRUCTIONS:
- Answer using only the provided web search results.
- Cite sources by title and URL.
- If any result is clearly unrelated to the user's question, ignore it.
- Keep Layer 3 concise — web results are already summarised.

{rag_block}"""


# ── Main chat function ────────────────────────────────────────────────────────

async def chat(
    pdf_id: int,
    pdf_title: str,
    message: str,
    history: list[dict],
    selection_text: str | None = None,
    selection_page: int | None = None,
    section_title: str | None = None,
    mode: str | None = None,
    research_session: dict | None = None,
) -> dict:
    # 1. Embed the user's question for RAG
    query_embedding = embed([message])[0]

    # 2. Retrieve top-5 RAG chunks
    hits = query_chunks(pdf_id=pdf_id, query_embedding=query_embedding, n_results=5)

    # 3. Routing decision
    web_search_triggered = False
    web_results: list[dict] | None = None

    # Build the selection block.
    # section_title anchors the passage in the document structure so Claude can
    # handle both full highlights (don't over-generalise) and partial highlights
    # (don't treat a sentence fragment as the complete unit of meaning).
    selection_block = ""
    if selection_text:
        page_label = f"page {selection_page}" if selection_page else "unknown page"
        section_label = f' — {section_title}' if section_title else ""
        selection_block = (
            f"HIGHLIGHTED PASSAGE ({page_label}{section_label}):\n"
            f'"{selection_text}"\n\n'
            + (
                f'SECTION CONTEXT: "{section_title}" — this heading names the section '
                f"the passage belongs to within the document's structure. Use it to:\n"
                f"  1. Situate the answer: mention this section in Layer 2 (Frame) "
                f"so the reader knows where in the book they are.\n"
                f"  2. Handle partial highlights: if the selected text is a sentence "
                f"fragment, interpret it within the section's scope rather than treating "
                f"the fragment as a complete standalone claim.\n"
                f"  3. Scale depth: a passage in an introductory section warrants a "
                f"different depth of explanation than one in a technical chapter.\n\n"
                if section_title else ""
            )
        )

    no_good_hits = not hits or all(h["distance"] > RELEVANCE_THRESHOLD for h in hits)
    force_document = _is_document_question(message) or bool(selection_text)
    ris = RESPONSE_QUICK_SYSTEM if mode == "quick" else RESPONSE_INTELLIGENCE_SYSTEM

    if no_good_hits and not force_document:
        # Genuine external question — fall back to web
        web_search_triggered = True
        enriched_query = f'{pdf_title}: {message}'
        web_results = await _tavily_search(enriched_query)
        rag_block = f"Web search results for «{enriched_query}»:\n{_format_web_context(web_results)}"
        system_prompt = _web_fallback_prompt(pdf_title, rag_block, ris=ris)

    elif selection_text and no_good_hits:
        # Selection present but RAG found nothing supportive
        system_prompt = _selection_only_prompt(pdf_title, selection_block, ris=ris)

    else:
        # Normal path: answer from document chunks
        rag_block = f"Document excerpts (retrieved by relevance):\n{_format_chunk_context(hits)}"
        system_prompt = _document_prompt(pdf_title, selection_block, rag_block, ris=ris)

    session_block = _format_research_session_context(research_session)
    if session_block:
        system_prompt = f"{system_prompt}\n\n{session_block}"

    # 4. Build message list
    messages = [
        {"role": h["role"], "content": h["content"]}
        for h in history
        if h.get("role") in ("user", "assistant")
    ]
    messages.append({"role": "user", "content": message})

    # 5. Call Claude
    client = _get_anthropic()
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1536,
        system=[{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=messages,
    )

    return {
        "answer": response.content[0].text,
        "sources": [
            {
                "page_number": h["page_number"],
                "chunk_index": h["chunk_index"],
                "distance": round(h["distance"], 4),
                "chunk_id": h.get("chunk_id"),
                "text": h.get("text"),
            }
            for h in hits
        ],
        "web_search_triggered": web_search_triggered,
        "web_results": web_results,
    }


# ── Formatters ────────────────────────────────────────────────────────────────

def _format_chunk_context(hits: list[dict]) -> str:
    return "\n\n".join(
        f"[Excerpt {i} — Page {h['page_number']}]\n{h['text']}"
        for i, h in enumerate(hits, 1)
    )


def _format_research_session_context(session: dict | None) -> str:
    if not session:
        return ""
    title = (session.get("title") or "").strip()
    topic = (session.get("topic") or "").strip()
    context = (session.get("context") or "").strip()
    if not title and not topic and not context:
        return ""
    return f"""RESEARCH SESSION CONTEXT (soft framing only):
- Session: {title or "Untitled session"}
- Topic: {topic or "Not specified"}
- User context: {context or "Not specified"}

Use this only to frame learning takeaways, connect the answer to the user's research goal, and notice cross-document relevance. Do not let session context override the document excerpts or highlighted passage."""


def _format_web_context(results: list[dict]) -> str:
    return "\n\n".join(
        f"[Result {i}] {r.get('title', '')}\n{r.get('url', '')}\n{r.get('content', '')}"
        for i, r in enumerate(results, 1)
    )


# ── Entry synthesis ───────────────────────────────────────────────────────────

_SYNTHESIS_SYSTEM = """\
You are a learning synthesis assistant.

Given a highlighted passage from a document and the Q&A exchanges a learner had about it, \
write a compact synthesis of what they now understand.

Rules:
- Treat the ANSWERS as the primary evidence of what was established during the chat.
- Preserve the main mechanisms, distinctions, and implications that appear in the answers; \
do not collapse them into a vague paraphrase.
- Do NOT enumerate or list the Q&As. Fuse them into a single unified understanding.
- Write declaratively about the understanding itself: state what is known, not what was asked.
- If the learner's own note is provided, treat it as the strongest signal of their understanding \
and anchor the synthesis to it.
- If the Q&As reveal a gap — a key aspect of the passage left unexamined — name it in one \
sentence at the end: "What remains unexplored: ..."
- For summary mode: 2–3 sentences maximum.
- Plain prose. No markdown, no bullet points, no headers.
"""

_SYNTHESIS_DEEP_SYSTEM = """\
You are a learning synthesis assistant.

Given a highlighted passage from a document and the Q&A exchanges a learner had about it, \
write a deeper synthesis of what the learner now understands from the chat.

Rules:
- Use the ANSWERS as the main evidence of what the learner covered.
- Preserve the deeper structure of the explanation: central claim, mechanism, implications, and transferable insight.
- Do not merely shorten the answer. Reorganize it into a coherent study note.
- If the learner's own note is provided, integrate it as the strongest signal of understanding.
- If the Q&As reveal a gap, end with one sentence beginning: "What remains unexplored: ..."
- 4–6 sentences maximum.
- Plain prose only. No markdown, no bullet points, no headers.
"""


def synthesize_entry(highlight_text: str, qa_pairs: list[dict], user_note: str = "", mode: str = "summary") -> str:
    """
    Distil all Q&A exchanges about a passage into a 2–3 sentence synthesis of
    what the learner now understands.  Uses Haiku for speed and low cost.
    Falls back to "" on any error.
    """
    client = _get_anthropic()

    qa_text = "\n\n".join(
        f"Q: {q.get('question', '')[:300]}\nA: {q.get('answer', '')[:2200]}"
        for q in qa_pairs
    )
    user_content = f"Passage:\n{highlight_text[:500]}\n\nQ&A exchanges:\n{qa_text}"
    if user_note and user_note.strip():
        user_content += f"\n\nLearner's own note:\n{user_note.strip()}"

    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500 if mode == "deep" else 260,
            system=_SYNTHESIS_DEEP_SYSTEM if mode == "deep" else _SYNTHESIS_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        )
        return msg.content[0].text.strip()
    except Exception:
        return ""


# ── Concept extraction ────────────────────────────────────────────────────────

_CONCEPT_SYSTEM = """\
You are a knowledge tagger. Given a highlighted passage and an explanation, \
extract 2–4 core concept tags that capture what this passage is fundamentally about.

Rules:
- Output ONLY a JSON array of lowercase strings, nothing else.
- Each tag is a short noun phrase: 1–3 words maximum.
- Tags must be general enough to cluster related passages across a document.
- Avoid overly specific names; prefer the underlying concept.
- Examples: ["doppler effect", "ultrasound imaging"], \
["gallstone formation", "bile chemistry"], ["spaced repetition", "memory decay"]
"""

_STUDY_CARD_QUESTION_SYSTEM = """\
You convert a chat exchange into a clear study question for a saved review card.

Rules:
- Output only the final question text.
- If the user's original question is already a clear, self-contained study question, keep it with only light cleanup.
- If the original question is vague, context-dependent, conversational, or too weak for later review, rewrite it into a standalone question.
- Ground the question in what the answer actually established.
- Prefer a question that tests understanding, mechanism, or evidence rather than generic phrasing.
- Keep it concise: usually 8–22 words.
- Do not mention "chat", "assistant", or "response".
- Never refuse, explain limitations, ask for more information, or output a fallback note.
- Never output bullets, multiple lines, or commentary.
- If context is limited, still write the best single-line standalone study question you can infer from the answer and source text.
"""


def extract_concepts(highlight_text: str, answer: str) -> list[str]:
    """
    Return 2–4 concept tags for a highlighted passage and its Q&A answer.
    Uses Haiku for speed and low cost. Falls back to [] on any error.
    """
    client = _get_anthropic()
    user_text = (
        f"Passage: {highlight_text[:400]}\n\n"
        f"Explanation: {answer[:800]}"
    )
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            system=_CONCEPT_SYSTEM,
            messages=[{"role": "user", "content": user_text}],
        )
        raw = msg.content[0].text.strip()
        # Parse JSON array; fall back to regex extraction if malformed
        try:
            tags = json.loads(raw)
            if isinstance(tags, list):
                return [str(t).strip().lower() for t in tags if str(t).strip()][:4]
        except json.JSONDecodeError:
            pass
        # Regex fallback: extract quoted strings
        tags = re.findall(r'"([^"]+)"', raw)
        return [t.strip().lower() for t in tags if t.strip()][:4]
    except Exception:
        return []


def prepare_study_card_question(question: str, answer: str, source_text: str = "") -> str:
    """
    Rewrite raw chat questions into clearer standalone study questions when needed.
    Falls back to the original question on any error.
    """
    client = _get_anthropic()
    user_text = (
        f"Original question: {question[:300]}\n\n"
        f"Answer: {answer[:1600]}"
    )
    if source_text.strip():
        user_text += f"\n\nSource passage: {source_text[:800]}"
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            system=_STUDY_CARD_QUESTION_SYSTEM,
            messages=[{"role": "user", "content": user_text}],
        )
        rewritten = msg.content[0].text.strip().splitlines()[0].strip()
        rewritten = re.sub(r"\s+", " ", rewritten)
        bad_markers = ("i cannot", "i can't", "i would need", "lacks sufficient context", "to create a useful")
        if not rewritten or any(marker in rewritten.lower() for marker in bad_markers):
            return question
        if not rewritten.endswith("?"):
            rewritten = f"{rewritten.rstrip('.!')}?"
        return rewritten or question
    except Exception:
        return question
