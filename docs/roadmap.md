# Roadmap & Design Decisions

> Priority order is governed by VISION.md. Every feature must pass the five-question
> filter before implementation begins. Check VISION.md first.

## Updated as of 2026-04-14

---

## TIER 1 — Must Ship (makes the scientific claim real)

### 1. Persistence — highlight index to PostgreSQL
**Status:** not built  
**Why first:** a retention app that forgets everything on refresh is self-defeating. All other features are pointless without this.  
**Plan:**
- New tables: `highlight_entries`, `qa_pairs`, `notes`
- API endpoints: CRUD for each
- Zustand store loads from API on PDF select, writes on every mutation
- Chat history stays ephemeral (per-session is fine)

Schema:
```sql
highlight_entries (id, pdf_id, page_number, highlight_text, starred, created_at)
qa_pairs (id, entry_id, question, answer, starred, created_at)
notes (id, pdf_id, page_number, highlight, note, created_at)
```

### 2. FSRS Memory Item System
**Status:** not built  
**Why:** the single architectural change that transforms the index from a graveyard into a scheduled review queue. Without it, saved Q&As are never revisited.  
**Plan:**
- `pip install fsrs`
- New table: `memory_items` (joins `qa_pairs`) with `next_review`, `interval`, `stability`, `difficulty`, `last_rating`, `review_history` (JSONB)
- Every new Q&A saved to index creates a `memory_item` with `next_review = now`
- After each review, FSRS updates the item's schedule based on rated recall quality

### 3. Review Session UI
**Status:** not built  
**Why:** this is where the science fires. Retrieval practice requires a distraction-free dedicated screen.  
**Flow:**
1. Show highlight context (the passage, not the question yet)
2. User types recalled answer from memory
3. User rates own confidence (1–5)
4. Claude evaluates typed answer against saved answer (1–5 quality score)
5. FSRS updates `memory_item` schedule
6. Show correct answer + Claude's evaluation
7. Move to next due item

**Implementation note:** separate route/screen from the PDF viewer. Not a panel or modal.

### 4. Upgrade Quiz Me to Generative Recall
**Status:** underbuilt (current implementation unknown — read code before touching)  
**Required:**
- Hides answer until user submits typed response
- Claude grades the response against the source material
- Result feeds into FSRS scheduling
- No multiple choice — typed generative recall only

---

## TIER 2 — High Value, Achievable After Tier 1

### 5. Retention Dashboard (home screen)
- Items due for review today
- Estimated retention % per document (from FSRS stability values)
- Study streak
- Concepts at risk of forgetting (items with next_review overdue)

### 6. Pre-Reading Question Priming
- On first open of a PDF: generate 5 questions this document will answer
- Show before page 1 loads
- ~30 lines of backend code, strong empirical backing (elaborative interrogation)
- No existing PDF app does this

### 7. Feynman Mode
- Dedicated chat mode (not the regular chat panel)
- User explains a concept from memory
- Claude challenges, asks follow-ups, plays devil's advocate
- Output: "gaps in your understanding" report grounded in the source document

---

## TIER 3 — Differentiating, After Tier 2

### 8. Knowledge Graph
- Nodes: ToC sections or highlight clusters
- Edges: cosine similarity between ChromaDB chunk vectors (infrastructure already exists)
- Node labels: concept names extracted from Q&A answers via Claude
- Visualisation: D3 force-directed graph
- Cross-PDF or per-PDF: decide when building

### 9. Visual Intelligence
- Box-select over diagrams/equations on the PDF canvas
- Capture as canvas crop → base64 → Claude vision API
- Cost: image tokens ~$0.002–0.01 per image

### 10. Cross-Document Synthesis
- "Based on Papers A, B, C — what are the main disagreements?"
- Requires knowledge graph to be meaningful

---

## Explicitly Out of Scope (for now)
- Progressive summarization
- Footnotes / resources system
- Sharing or collaboration
- Mobile app
- Any feature that improves reading comfort without improving recall

---

## Scope / Cost Notes

| Feature | Complexity | Cost |
|---|---|---|
| Persistence | Medium | None — Postgres writes |
| FSRS system | Medium | None — local algorithm |
| Review session UI | Medium | Claude grading calls — cheap (short prompts) |
| Retention dashboard | Low | None — SQL aggregates |
| Pre-reading priming | Low | One Claude call per first open |
| Feynman Mode | Medium | Claude calls per session |
| Knowledge graph | High | Batch concept extraction via Claude |
| Image selection | Medium | Image tokens per query |
| Cross-doc synthesis | High | Multiple RAG queries + Claude |

---

## Decisions Already Made

Full table in `PROJECT.md` → Design Decisions Log.

Key ones:
- **No server-side chat history** — frontend owns it, sends each request.
- **Selection text bypasses RAG** — direct injection; RAG can't reliably find exact highlighted passage.
- **Generated TOC = last occurrence wins** — front-matter ToC pages give wrong page numbers otherwise.
- **Size-aware TOC** — ≤150 pages fine-grained (H1+H2); >150 chapter-level (H1 only).
- **Knowledge graph foundation already in place** — ChromaDB vectors + ToC titles + highlight index are the raw material.
- **Quiz Me must be generative recall** — multiple choice / answer-reveal is passive, not active recall.
- **FSRS over SM-2/Anki algorithm** — more accurate, Python-native, open source (`pip install fsrs`).
