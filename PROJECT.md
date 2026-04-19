# pdf-workspace — Project Knowledge File

> Paste this file at the start of any Claude conversation to restore full context instantly.
> Update it after every meaningful session. Last updated: 2026-04-17.
> See VISION.md for the product north star and feature priority order — check it before building anything.
> See research/CLAUDE.md for thesis-specific routing rules (schema, grading, study design).

---

## What This App Is

A **document-grounded active recall system** implementing FSRS-based spaced repetition and generative evaluation to improve long-term retention of academic literature.

Core loop (current):
1. Upload a PDF → chunked, embedded, stored.
2. Read in the viewer; highlight any text.
3. Hover menu: Explain / Simplify / Quiz / Summarise / Voice / Save note.
4. Answers go to chat. Save any highlight + Q&A pair to a per-PDF **Highlight Index**.
5. The Index is proto-flashcard material — browsable by page, starrable, searchable.

Core loop (fully operational as of Phase 9):
6. Saved Q&A pairs enter FSRS scheduling → review queue.
7. Review session (dedicated screen): recall from memory → confidence rating → Claude grades (3D rubric) → FSRS updates interval.
8. Quiz Me (per-card): same grading engine, PDF-scoped due queue.
9. Retention dashboard — not yet built (Tier 1.5).

Scientific foundation: Testing Effect (Roediger & Karpicke 2006), Spaced Repetition (FSRS/Ye et al. 2022), Elaborative Interrogation (Pressley), Generative Learning (Fiorella & Mayer 2015).

See **VISION.md** for full thesis, priority order, and feature filter.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite, Zustand, react-pdf (v9 / PDF.js) |
| Backend | FastAPI (Python 3.12 via conda), SQLAlchemy, PostgreSQL |
| Vector DB | ChromaDB (local HTTP server) |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` |
| LLM | Anthropic Claude claude-sonnet-4-20250514 (prompt caching on system prompt) |
| Voice | OpenAI Whisper (`whisper-1`) |
| Web search | Tavily (fallback when RAG relevance < 0.75 cosine distance) |
| Storage | AWS S3 (PDFs), PostgreSQL (metadata), ChromaDB (chunks) |

---

## Phases Completed

### Phase 0 — Scaffold
- Monorepo: `backend/` (FastAPI) + `frontend/` (React/Vite)
- Docker Compose for Postgres + ChromaDB
- Conda env `pdf-workspace` (Python 3.12 — avoids 3.13 incompatibilities)

### Phase 1 — PDF Upload + RAG Chat
- Upload → PyMuPDF text extract → 512-token chunks (50 overlap, tiktoken cl100k) → embed → ChromaDB
- Chat: embed question → cosine search → Claude with retrieved context
- Tavily web search fallback when no chunk hits threshold
- PDF streamed from S3 via backend proxy (avoids CORS)
- PDF.js worker loaded via CDN (avoids Vite worker path issues)

### Phase 2 — Voice Input
- MediaRecorder API, `audio/webm;codecs=opus`, timeslice=100ms
- Toggle click (start / stop), minimum 1.5s enforced
- Backend strips codec params before MIME validation
- Passes audio as tuple `("recording.webm", bytes, "audio/webm")` to OpenAI SDK

### Phase 3 — Text Selection + Hover Menu
- `mouseup` handler captures selection range, positions floating `SelectionMenu`
- 7 actions: Explain, Simplify, Key Terms, Quiz Me, Summarise, Ask by voice, Save note
- 8th action: Index — shows Q&A count for related entries, or "empty" if none
- `onMouseDown={(e) => e.preventDefault()}` on ALL menu buttons (prevents selection clear)
- Selected text injected directly into system prompt as "HIGHLIGHTED PASSAGE" — bypasses RAG for the selection itself, RAG still runs for supporting context

### Phase 3b — Highlight Index
- Per-PDF index of highlight + Q&A pairs, stored in Zustand
- Organised by page (sticky page headers), secondary view: Starred
- Fuzzy matching (`indexMatch.js`) links re-selections to existing entries
- Star/unstar entries and individual Q&As
- "Save to Index" prompt appears after any selection-based Q&A
- Fixed blank-page crash: rewrote from module-level sub-components (caused Vite Fast Refresh issue) to single exported component with inline rendering

### Phase 4 — PDF Viewer Upgrades
- **Scrolling**: windowed render ±3 pages around current; IntersectionObserver updates page counter as user scrolls
- **IntersectionObserver fix**: `ratioMap` persists across callback batches so the MOST-VISIBLE page wins, not just the last-entered one
- **Editable page number**: click the `X / Y` display → becomes `<input>` → Enter/blur navigates
- **`navigateToPage()`**: sets `pendingScrollPage` ref; a no-deps `useEffect` retries after every render until the target page mounts — fixes navigation to pages outside the current render window
- **Persistent highlight**: CSS Custom Highlight API (`::highlight(pdf-selection)`) keeps the blue highlight visible while using the hover menu or chat; `usePersistentHighlight` hook
- **Table of Contents panel**: `GET /api/pdfs/{id}/toc` endpoint; side panel with search filter; ☰ toolbar button always visible once loaded

### Phase 4b — TOC Generation (toc_service.py)
- Strategy 1: PyMuPDF built-in outline (`doc.get_toc()`) — used when present, returns `mode: "native"`
- Strategy 2: Two-pass font-size heuristic across ALL pages — **size-aware granularity**:
  - **≤ 150 pages** → `mode: "fine"` — detects H1 (≥1.6×) + H2 (≥1.25×), levels preserved. Good for articles, short reports, papers.
  - **> 150 pages** → `mode: "chapter"` — H1 only (≥1.6×). Good for textbooks, encyclopedias, references.
  - **Last-occurrence wins**: actual content page beats any front-matter printed ToC page listing the same title
  - No item cap — large references get full entry coverage
- Response shape: `{items, generated, mode}` — frontend uses `mode` for banner/tooltip text
- ToC prompt banner above page 1 when no native outline; "Yes, show me" / "No thanks"
- Search filter in panel (critical for encyclopedias with hundreds of entries)
- H2 entries visually lighter + indented vs H1

### Phase 4c — Debugging & Resilience
- `GET /health/detailed` — checks Postgres, ChromaDB, S3 connectivity + API key presence; paste response to Claude to diagnose service issues
- `GET /api/pdfs/{id}/toc/debug` — font-size stats, threshold, first/last 10 candidates; paste to Claude to diagnose ToC issues
- `ErrorBoundary` wraps entire React app — blank-page crashes now show error message + "Copy error for Claude" button
- `start.sh` / `status.sh` / `stop.sh` — one-command session management with PID tracking and log files

### Phase 5 — Chat Quality + Automated Testing

**Chat service overhaul (`chat_service.py`):**
- `RELEVANCE_THRESHOLD` raised `0.75 → 1.3`: old threshold was too strict — high-level questions ("what is this book about") embed generically and all chunks scored > 0.75, causing Tavily to fire for document questions
- `pdf_title` now passed from router → chat service for every request; used in all system prompts and web search queries
- `_is_document_question()` guard: questions that are clearly about the document itself (overview, scope, structure) are forced to the document path — never routed to web search regardless of chunk distance
- Enriched Tavily query: when web search genuinely fires, query becomes `"{pdf_title}: {user_message}"` instead of raw message — prevents off-topic results (e.g. searching "what is the book all about" now searches "Gale's Encyclopedia of Medicine: what is the book all about")
- Three research-oriented system prompt templates:
  - `_document_prompt` — WHAT + WHY + HOW, page citations, markdown formatting, synthesis across excerpts
  - `_selection_only_prompt` — deep explanation of highlighted passage: meaning, significance, technical terms, field connections
  - `_web_fallback_prompt` — citation-focused, filters irrelevant results, keeps PDF title in context
- `max_tokens` raised `1024 → 1536` for richer responses

**Markdown rendering in chat (`ChatPanel.jsx`):**
- Assistant messages now rendered with `react-markdown` (v10) — bold, lists, code blocks, headers all render correctly
- `className` prop removed (deprecated in react-markdown v10); wrapped in a plain `<div className="message-bubble">` instead
- User messages stay as plain text with `pre-wrap`
- CSS added for scoped markdown styles inside `.message-assistant .message-bubble`

**Automated test suite (`backend/tests/`):**
- `conftest.py` — session fixtures: `client` (httpx), `uploaded_pdf_id` (uploads real test PDF, deletes after session)
- `test_health.py` — `/health`, `/health/detailed`, per-service connectivity, API key presence
- `test_pdfs.py` — list schema, upload (wrong type → 400), URL, stream, TOC shape, debug endpoint, 404s
- `test_chat.py` — basic response, with selection, with history, sources schema, 404 on bad id
- `requirements-dev.txt` — `pytest==8.2.2`, `pytest-asyncio==0.23.7`

**`diagnose.sh` — comprehensive diagnostic script:**
- 5-section check: port listening → health endpoints → PDF API smoke tests → env/.env/conda/node checks → log error scan
- `--fix` flag: auto-restarts failed services (postgres brew, chroma, backend, frontend)
- `--tests` flag: installs pytest if needed, runs full suite against live server
- Reports pass/fail counts and fix commands; exits non-zero if any check fails

### Phase 6 — Eval Pipeline + Playwright MCP
- LLM-as-judge + deterministic structure checks + Playwright UI tests
- Playwright MCP wired to Claude settings for in-session browser access
- Response Intelligence System (6-category / 5-layer template) baked into `chat_service.py` system prompts

### Phase 7 — Highlight Index Architecture (3 parts)

**Part 1 — Deep Section Index**
- `get_page_heading_path()`: two-phase visual-order scan, 8% header bands, ALL_CAPS + bold L3 rules, forward-order ancestor chain
- `resolve_chunk_for_highlight()`: stable chunk ID from ChromaDB
- `POST /api/pdfs/{id}/resolve-chunk` endpoint; frontend `resolveChunk()` API
- Every saved highlight carries `chunkId` + `deepSectionPath`; `groupByHierarchy` uses deepSectionPath with L3→H2 fallback

**Part 2 — Concept Tagging**
- Haiku extracts 2–4 lowercase noun-phrase tags per save (parallel with resolveChunk)
- Stored on `highlight_entries.concepts JSONB`
- By Concept view with chip-bar filter; inline concept tags in By Page view

**Part 3 — Curation States + Related Passages**
- Flag/Anchor/Reviewed toggles on every entry (ORM + Zustand + API)
- Lazy-loaded related passages via ChromaDB embedding similarity (3 similar chunks, click to jump)
- Curated tab with Stars/Anchored/Flagged sub-filters

### Phase 8 — Index Information Design Overhaul (4 parts)

**Lens Fixes (prerequisite)**
- react-pdf v9 inline arrow on `onRenderTextLayerSuccess` changed reference every render → TextLayer rebuild → empty nodes. Fixed with stable per-page handler cache via refs.
- Highlight lens only showed first 60 chars. Fixed `findTextRange` to use `fullNorm.length`.
- `highlightTexts[]` array accumulates all distinct selections from the same chunk.

**Part 1 — Question Visibility**
- Collapsed card = single row with inline first-sentence preview + relative timestamp. Click to expand.
- `firstSentence()` and `relativeTime()` module-level utilities.

**Part 2 — Annotation Field**
- Free-text marginalia on entries. Three states: ghost (dashed), editing (amber tint), saved.
- `setEntryNote` Zustand action; `note: ''` on every new entry.

**Part 3 — Synthesis Layer**
- On-demand Haiku distillation → 2–3 sentence understanding summary per passage.
- `POST /api/chat/synthesize-entry`; `synthesis: null` on entries; spinner + regenerate button.

**Part 4 — Chip Density**
- `ConceptChips` inner component (MAX_VISIBLE_CHIPS=5, overflow `+N`/`−` toggle, navigable prop).
- Concepts tab chip bar with BAR_LIMIT=12 toggle.

### Phase 9 — Tier 1A: Persistence + FSRS + Review Session + Instrumentation ✅

**DB schema (8 tables):**
- `pdf_documents`, `highlight_entries`, `qa_pairs` (FSRS state inline: stability, difficulty, step, state, due_at)
- `review_log` (28 cols, thesis-critical — all grading + FSRS transition data logged per review)
- `rubric_versions`, `prompt_versions` (versioned + freezable for pre-registered study)
- `session_events` (home for visual_chat + feynman events — NOT review_log)
- `human_grades` (IRR sub-study storage)

**FSRS v6.3.1 integration:**
- `Scheduler`, `Card`, `Rating`, `State` (no `FSRS` class — v6 API)
- `reconstruct_card()` / `persist_card_to_qa()` helpers
- DB state → fsrs.State: 'new'→Learning/step=0, 'learning'→Learning/step=1, 'review'→Review, 'relearning'→Relearning
- Claude score → FSRS rating: 1→Again, 2→Hard, 3→Good, 4–5→Easy (both stored per Research A3)
- Default `Scheduler()` weights frozen for pre-registered study period

**3D analytical rubric (grading_service.py):**
- `core_claim`, `supporting_detail`, `faithfulness` each 1–5; overall = round(mean)
- `temperature=0`, model pinned to `"claude-sonnet-4-20250514"`
- RAG-grounded: source chunks fetched from ChromaDB and passed to Claude (Research C6)
- JSON output: scores + rationales + rubric_hits + missing + confidence + feedback
- Default rubric `v1.0` seeded on startup; versioned via `rubric_versions` table

**Review Session UI (ReviewSession.jsx):**
- Full-screen overlay (no react-router), `reviewMode` boolean in Zustand
- Phases: loading → recall → graded → done → empty
- Confidence rating (1–5) + recall textarea submitted in ONE call before grade revealed (Research D2)
- Graded overlay: overall score (color-coded), 3 DimRow scores, feedback, rubric_hits/missing chips, correct answer, next review date
- `cardShownAt` ref → `recall_latency_ms` computed at submit time
- Handles `reviewScope.cards` (single-card) and `reviewScope.pdfId`/null (due queue)

**API endpoints (routers/review.py):**
- `POST /api/review/submit` — single call: confidence + recall → grade + FSRS update → review_log row
- `GET /api/review/due` — global due queue (all PDFs)
- `GET /api/pdfs/{pdf_id}/review/due` — PDF-scoped due queue (Quiz Me)
- `GET /api/qa/{qa_id}/review-data` — single card data (per-card ▶ button)
- `GET /api/review/stats` — {total, due_now, new}
- `DueCardResponse` includes `source_passage` (full ChromaDB chunk text) + `highlight_text` (stored selection)

**Research export (routers/research.py):**
- `GET /api/research/export/review-log` — 28-col CSV/JSON thesis primary dataset
- `GET /api/research/export/irr-sample` — blinded rows for human grader (no Claude scores)
- `POST /api/research/irr/sample` — randomly flag target_n rows for IRR sub-study

**Zustand migration:**
- All actions async, API-first with optimistic updates + rollback
- `selectPdf` async — fetches highlights on PDF open
- `normalizeEntry(row, pdfTitle)` / `normalizeQA(row)` — DB→UI field mapping
- `openReview(scope)` where scope: null | {pdfId} | {cards: [...]}

### Phase 9 Post-Build Fixes (2026-04-17)

- **ReviewSession question display:** Action Q&A detection (`resolveDisplayQuestion()`). Quiz Me: extracts `**Question:**` block from answer; falls back to "What do you recall about this passage?" badge. Other actions (Explain, Simplify, etc.): show action badge + generic prompt. Manual Q&As: unchanged.
- **Source passage in review:** `DueCardResponse.source_passage` — full ChromaDB chunk text fetched in `_qa_to_due_response()`; ReviewSession prefers this over raw `highlight_text`.
- **"Highlight" label:** Added `idx-entry-source-label` above passage text buttons in By Page and By Section views — visually separates source zone from Q&A list.
- **Concept chip cap:** `MAX_VISIBLE_CHIPS` raised 3→5.
- **Quiz Me structured output:** SelectionMenu prompt now requests `**Question:** / **Answer:**` format so future saves are reviewable.
- **Test data cleanup:** Patched Entry 1 `highlight_texts` (had "original selection" from dev testing).

---

## Current State (as of 2026-04-17)

### Working
- Full upload → embed → chat pipeline
- Voice input (toggle, 1.5s min, Whisper)
- Text selection hover menu with all actions
- Highlight Index (By Page / By Section / By Concept / Curated views)
- Deep section index (chunk IDs, deepSectionPath, concept tags, curation states, related passages)
- Annotation field + synthesis layer on entries
- PDF scrolling with page tracking, editable page number
- Navigable ToC (native or auto-generated, size-aware)
- Persistent text highlight during menu interaction
- Tavily web search fallback (document-context guard + enriched queries)
- Error boundary + debug endpoints
- Markdown rendering in assistant chat messages
- Automated backend test suite (pytest, live server)
- `diagnose.sh` with `--fix` and `--tests`
- **Full DB persistence** — all highlight entries and Q&A pairs stored in PostgreSQL
- **FSRS v6.3.1 scheduling** — inline on `qa_pairs`; Claude score → FSRS rating
- **3D analytical rubric grading** — core_claim / supporting_detail / faithfulness; RAG-grounded
- **Review Session UI** — full-screen overlay, 3-phase per-card, confidence-before-grade (Research D2)
- **Quiz Me upgrade** — per-card ▶ button, PDF-scoped + global due queues, live due badge
- **Thesis instrumentation** — review_log (28 cols), CSV/JSON export, IRR sampling endpoint
- **Action Q&A detection in review** — Quiz Me cards show extracted question; others show generic prompt

### Known Gaps / Next Up (see VISION.md + research/CLAUDE.md for priority rationale)

**TIER 1B — Demo-skeleton features (do after Tier 1A is solid):**
1. **Learning graph** — D3 force graph, nodes per Q&A colored by FSRS stability, edges by cosine sim (threshold 0.75, top-K=3). Budget: 5–7 days. Cluster tags from `deepSectionPath[0].title` (free, no schema change needed).
2. **Visual intelligence** — 2x DPR canvas drag-select, "Ask about this" → Claude vision. Budget: 4–6 days. **Verify multimodal API on chosen model early — highest-risk demo-skeleton feature.**
3. **Feynman mode** — fixed 4-turn, `session_events` logging (`session_type='feynman'`). Budget: 3–5 days.

**TIER 1.5:**
4. **Retention dashboard** — items due today, R = e^(-elapsed/stability) per doc, study streak.

**TIER 2 (post-thesis):**
5. Pre-reading question priming, cross-document synthesis, full-vision features.

**Research compliance (parallel with build):**
- IRB approval — hard blocker on human-subjects data collection; start 6+ weeks before planned data collection
- OSF pre-registration recommended before main study
- Rubric/model freeze before data collection begins (Research C4, C5)

---

## Architecture — Key Files

```
backend/
  app/
    main.py                  FastAPI app, lifespan (create_all + seed rubric), /health, /health/detailed
    core/config.py           Pydantic Settings (env vars)
    models/
      pdf.py                 PDFDocument ORM
      highlight.py           HighlightEntry + QAPair (FSRS state inline: stability, difficulty, step, state, due_at, source_chunk_ids JSONB)
      review.py              ReviewLog (28 cols), RubricVersion, PromptVersion, SessionEvent, HumanGrade
    routers/
      pdfs.py                Upload, list, stream, TOC, TOC debug, resolve-chunk, delete
      chat.py                RAG chat + synthesize-entry endpoint
      voice.py               Whisper transcription
      highlights.py          CRUD: highlights (7 endpoints), qa_pairs
      review.py              submit, due (global + PDF-scoped), review-data, stats
      research.py            export/review-log (CSV/JSON), export/irr-sample, irr/sample
    services/
      pdf_service.py         extract_pages(), chunk_pages(), get_page_count()
      chroma_service.py      upsert_chunks(), query_chunks(), delete_pdf_chunks(), get_collection()
      embedding_service.py   embed() via sentence-transformers
      chat_service.py        3 prompt templates, _is_document_question(), Tavily fallback, Response Intelligence System
      toc_service.py         get_toc() — native outline or size-aware font heuristic
      s3_service.py          upload, get_presigned_url, get_file_bytes
      grading_service.py     3D rubric, run_grading(), FSRS helpers, ensure_default_rubric_version()
      section_service.py     get_page_heading_path(), resolve_chunk_for_highlight()

frontend/src/
  store/index.js             Zustand: async API-first, optimistic updates + rollback, openReview(scope)
  api/
    client.js                Axios base (baseURL: /api)
    pdfs.js                  listPdfs, uploadPdf, deletePdf, getPdfFileUrl, getToc, resolveChunk, getRelatedChunks, synthesizeEntry, extractConcepts
    chat.js                  sendMessage(...)
    highlights.js            fetchHighlights, postHighlight, patchHighlight, deleteHighlight, postQA, patchQA, deleteQA
    review.js                fetchDueCards(pdfId?), submitReview, fetchReviewStats, fetchCardReviewData
  components/
    PDFViewer.jsx            Viewer, scrolling, ToC panel, selection detection
    SelectionMenu.jsx        Hover menu (8 actions); Quiz Me prompt requests **Question:**/**Answer:** format
    ChatPanel.jsx            Chat + Index tab switcher, logPrompt, voice, react-markdown, saveToIndex
    HighlightIndex.jsx       By Page / By Section / By Concept / Curated; QACard, ConceptChips (MAX=5),
                             RelatedPassages, AnnotationField, SynthesisSection, CurationBar, review bar
    ReviewSession.jsx        Full-screen overlay; 3-phase recall→graded→done; resolveDisplayQuestion()
                             extracts quiz Q from answer; action badge + generic prompt fallback
    PDFSidebar.jsx           PDF library sidebar
    ErrorBoundary.jsx        Blank-page crash catcher
  hooks/
    useVoiceRecorder.js      IDLE→REQUESTING→RECORDING→TRANSCRIBING→ERROR state machine
    usePersistentHighlight.js CSS Custom Highlight API wrapper
  utils/
    indexMatch.js            findRelatedEntries() — fuzzy word-overlap + page bonus

backend/tests/               pytest suite (conftest, test_health, test_pdfs, test_chat)
backend/requirements-dev.txt pytest + pytest-asyncio
research/                    Thesis research folder (CLAUDE.md routes all task types to specific files)
diagnose.sh                  5-section system check; --fix restarts services; --tests runs pytest
```

---

## Design Decisions Log

| Decision | Rationale |
|---|---|
| Selected text injected into system prompt directly (not via RAG) | RAG couldn't find the exact passage; direct injection guarantees Claude sees it |
| `onMouseDown` prevention on all menu buttons | Prevents focus-steal which clears the browser selection |
| CSS Custom Highlight API for persistent highlight | Only way to keep a visual highlight after selection is cleared; degrades gracefully |
| `pendingScrollPage` + no-deps useEffect for navigation | React renders pages async; effect retries each cycle until target page mounts |
| `ratioMap` persisting across IntersectionObserver callbacks | Observer fires per-changed-entry, not all-entries; map gives true most-visible page |
| Last-occurrence wins in TOC deduplication | Front-matter printed ToC lists headings before content; content page is the right target |
| No item cap on generated TOC | Encyclopedias/references have hundreds of H1 entries; cap was cutting off at B |
| Size-aware TOC granularity (≤150 = fine, >150 = chapter) | Short docs benefit from subheading detail; long references need chapter-level only |
| Single exported component for HighlightIndex | Vite Fast Refresh blanks page with module-level hook-using sub-components |
| Conda Python 3.12 (not 3.13) | psycopg2-binary, tiktoken, pydantic-core incompatible with 3.13 at project start |
| ChromaDB `_client = None` (no type annotation) | `chromadb.HttpClient` is a factory function, not a class; union type annotation crashed |
| Tavily fallback threshold: cosine distance 1.3 (was 0.75) | 0.75 was too strict — generic questions ("what is this book about") embed generically; all chunks scored > 0.75 causing Tavily to fire inappropriately. 1.3 ≈ essentially random noise. |
| `_is_document_question()` guard in chat_service | Document-level questions ("what is this book about", "what topics does it cover") must never go to web search regardless of chunk distance. Pattern-matched and forced to document path. |
| Tavily query enriched with PDF title | Raw message sent to Tavily returned garbage ("what is the book all about" → random "All About" books). Query is now `"{pdf_title}: {message}"`. |
| Three chat system prompt templates | `_document_prompt` (RAG path), `_selection_only_prompt` (highlight with no strong chunks), `_web_fallback_prompt`. Each oriented toward research/learning: explain WHY + HOW, cite pages, use markdown. |
| `pdf_title` passed router → chat service | Chat service had no knowledge of which document was open. Now threaded through for prompts, web search enrichment, and document-question detection. |
| Voice: tuple `("recording.webm", bytes, "audio/webm")` to OpenAI SDK | BytesIO approach didn't work; tuple form is what the SDK expects for multipart |
| FSRS state inline on `qa_pairs` (not separate `memory_items` table) | Eliminates a join on every review; simpler migration; FSRS fields are 1:1 with the Q&A (Research B1) |
| FSRS v6.3.1 uses `Scheduler`, not `FSRS` class | v6 rewrote the API; `FSRS()` doesn't exist. Use `Scheduler()`, `scheduler.review_card(card, rating)` → `(Card, ReviewLog)` |
| Claude score → FSRS rating, NOT user confidence | This mapping IS the thesis contribution — replacing self-rated SRS signals with LLM-graded generative recall (Research A3) |
| `temperature=0` + pinned model string for grading | Reproducibility requirement for a pre-registered study — must be logged on every call (Research C5) |
| RAG-grounded grading: source chunks passed to Claude | Prevents Claude from grading against its priors rather than the document (Research C6) |
| `review_log` stores both raw Claude score AND derived FSRS rating | Allows post-hoc revision of the score→rating mapping without re-running grading |
| confidence_rating + recall_text in ONE submit call | If user sees grade first before rating confidence, calibration measurement is contaminated (Research D2, Cardinal Rule 2) |
| `session_events` for visual_chat + feynman (NOT review_log) | Keeps thesis primary data clean — review_log is for the empirical-core graded recall only (Research K2, L2) |
| `rubric_versions` table with `frozen_at` timestamp | Rubric must be frozen before main study data collection; create new version rather than mutating frozen one (Research C4) |
| `source_passage` in DueCardResponse (ChromaDB full chunk) | `highlight_text` (user's raw selection) may have PDF extraction artifacts; ChromaDB chunk gives clean full context for review display |
| `resolveDisplayQuestion()` in ReviewSession | Quiz Me stores the raw prompt as `qa.question`; Claude's actual Q is in `qa.answer`; must extract at review time to avoid showing the raw prompt |
| `deepSectionPath[0].title` as cluster tag for knowledge graph | Already stored, free — no schema change needed for coarse concept clustering in graph view |

---

## Debug Endpoints (paste responses to Claude when things break)

| URL | What it tells you |
|---|---|
| `GET /health/detailed` | Postgres / ChromaDB / S3 connectivity + API key presence |
| `GET /api/pdfs/{id}/toc/debug` | Font-size stats, threshold, candidate headings — diagnoses ToC issues |

Frontend crashes: **ErrorBoundary** catches blank-page crashes and shows the error + **"Copy error for Claude"** button.

---

## Session Management

```bash
./start.sh              # start all 4 services (checks if already running)
./status.sh             # see what's up/down + last log lines for anything broken
./stop.sh               # graceful shutdown via saved PIDs
./diagnose.sh           # full system check: ports, HTTP, API smoke tests, env, logs
./diagnose.sh --fix     # same + auto-restart any failed service
./diagnose.sh --tests   # same + run full pytest suite
```

Logs written to `logs/` (gitignored). Tail live: `tail -f logs/backend.log`

Full manual instructions: `START.md`

---

## Environment Setup (from scratch)

```bash
# Backend
conda create -n pdf-workspace python=3.12
conda activate pdf-workspace
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# ChromaDB (separate terminal)
chroma run --path ./chroma_data --port 8001

# Frontend
cd frontend && npm install && npm run dev
```

Required `.env` in `backend/`:
```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TAVILY_API_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=
DATABASE_URL=postgresql://...
CHROMA_HOST=localhost
CHROMA_PORT=8001
```

---

## Notes on Scope

- **TOC heuristics**: font-size based detection is best-effort. Works well for structured books; imperfect for heavily typeset reference works. Native PDF bookmarks always preferred.
- **Persistence**: fully built as of Phase 9. PostgreSQL is the source of truth; Zustand is a cache that reloads on PDF select + tab refocus.
- **FSRS study freeze**: default `Scheduler()` weights are frozen for the pre-registered study period. Do NOT enable per-user FSRS parameter optimization until after data collection ends.
- **Action Q&A in review**: Quiz Me stores raw prompt as `qa.question`; Claude's answer is in `qa.answer`. `resolveDisplayQuestion()` extracts the actual question. Old cards (pre-format-instruction prompt) fall through to generic "What do you recall?" prompt — this is correct.
- **Source passage truncation**: `highlight_text` is the user's raw PDF selection, may have hyphenated line breaks. `source_passage` (ChromaDB full chunk) preferred in ReviewSession.
- **Knowledge graph (Tier 1B)**: all data already exists. Nodes = one per Q&A, color = FSRS stability, size = review count. Edges = cosine sim over source chunks, threshold 0.75, top-K=3. Cluster labels = `deepSectionPath[0].title` (free, no schema change). Budget: 5–7 days. Build AFTER Tier 1A is solid — check Research rule 4.
- **Visual intelligence (Tier 1B)**: canvas drag-select → 2x DPR capture → Claude vision → response. Logged in `session_events` (NOT `review_log`). Verify multimodal API on pinned model EARLY — highest-risk demo-skeleton feature.
- **Image highlighting (Tier 1B)**: same as visual intelligence. "Ask about this" one-button approach (no multi-button toolbar). No saving as reviewable Q&A cards — extension point.
- **Demo-skeleton features**: Groups G (graph), K (visual), L (Feynman) have explicit IN/NOT-in-scope lists in research/04_build_decisions.md. Push back on scope creep.
