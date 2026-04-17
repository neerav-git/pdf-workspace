# pdf-workspace — Project Knowledge File

> Paste this file at the start of any Claude conversation to restore full context instantly.
> Update it after every meaningful session. Last updated: 2026-04-15.
> See VISION.md for the product north star and feature priority order — check it before building anything.

---

## What This App Is

A **document-grounded active recall system** implementing FSRS-based spaced repetition and generative evaluation to improve long-term retention of academic literature.

Core loop (current):
1. Upload a PDF → chunked, embedded, stored.
2. Read in the viewer; highlight any text.
3. Hover menu: Explain / Simplify / Quiz / Summarise / Voice / Save note.
4. Answers go to chat. Save any highlight + Q&A pair to a per-PDF **Highlight Index**.
5. The Index is proto-flashcard material — browsable by page, starrable, searchable.

Core loop (target — retrieval side not yet built):
6. Saved Q&A pairs enter FSRS scheduling → review queue.
7. Review session: recall from memory → confidence rating → Claude grades → FSRS updates interval.
8. Retention dashboard shows forgetting curve per document and items due today.

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

---

## Current State (as of 2026-04-15)

### Working
- Full upload → embed → chat pipeline
- Voice input (toggle, 1.5s min, Whisper)
- Text selection hover menu with all actions
- Highlight Index (by page + starred views)
- PDF scrolling with page tracking
- Editable page number
- Navigable ToC (native outline or auto-generated, size-aware)
- ToC search filter
- Persistent text highlight during menu interaction
- Tavily web search fallback (with document-context guard + enriched queries)
- Error boundary + debug endpoints
- Markdown rendering in assistant chat messages
- Automated backend test suite (pytest, hits live server)
- `diagnose.sh` — one-command full system check with `--fix` and `--tests` flags

### Known Gaps / Next Up (see VISION.md for full priority rationale)

**TIER 1 — Must ship before anything else:**
1. **Persistence** — Zustand is in-memory. Refresh wipes everything. A retention app that forgets on refresh is self-defeating.
2. **FSRS memory item system** — `memory_items` table on `qa_pairs`; transforms the index from a graveyard into a scheduled review queue.
3. **Review session UI** — separate screen; typed recall → confidence rating → Claude grades → FSRS updates.
4. **Upgrade Quiz Me** — generative recall with typed answers, Claude grading, FSRS integration.

**TIER 2:**
5. Retention dashboard — items due today, retention % per doc, study streak.
6. Pre-reading question priming — 5 questions shown before page 1 on first open.
7. Feynman Mode — user explains from memory, Claude challenges, gaps report.

**TIER 3 (after Tier 2):**
8. Knowledge graph, 9. Image/figure selection, 10. Cross-document synthesis.

---

## Architecture — Key Files

```
backend/
  app/
    main.py                  FastAPI app, lifespan, /health, /health/detailed
    core/config.py           Pydantic Settings (env vars)
    models/pdf.py            PDFDocument ORM model
    routers/
      pdfs.py                Upload, list, stream, TOC, TOC debug, delete
      chat.py                RAG chat endpoint
      voice.py               Whisper transcription
    services/
      pdf_service.py         extract_pages(), chunk_pages(), get_page_count()
      chroma_service.py      upsert_chunks(), query_chunks(), delete_pdf_chunks()
      embedding_service.py   embed() via sentence-transformers
      chat_service.py        three prompt templates, _is_document_question(), Tavily fallback
      toc_service.py         get_toc() — native outline or size-aware font heuristic
      s3_service.py          upload, get_presigned_url, get_file_bytes

frontend/src/
  store/index.js             Zustand: pdfs, selectedPdf, currentPage, highlights, notes, chat
  api/
    client.js                Axios base (baseURL: /api)
    pdfs.js                  listPdfs, uploadPdf, deletePdf, getPdfFileUrl, getToc
    chat.js                  sendMessage({pdfId, message, history, selectionText, selectionPage})
  components/
    PDFViewer.jsx            Viewer, scrolling, ToC panel, selection detection
    PDFViewer.css
    SelectionMenu.jsx        Hover menu (8 actions, all with onMouseDown prevention)
    SelectionMenu.css
    ChatPanel.jsx            Chat + Index tab switcher, logPrompt, voice integration, react-markdown
    ChatPanel.css
    HighlightIndex.jsx       Index view (by-page + starred), single exported component
    HighlightIndex.css
    PDFSidebar.jsx           PDF library sidebar (upload, list, select, delete)
    PDFSidebar.css
    ErrorBoundary.jsx        Catches React crashes, shows error + "Copy error for Claude"
  hooks/
    useVoiceRecorder.js      State machine: IDLE→REQUESTING→RECORDING→TRANSCRIBING→ERROR
    usePersistentHighlight.js CSS Custom Highlight API wrapper
  utils/
    indexMatch.js            findRelatedEntries() — fuzzy word-overlap + page bonus

backend/tests/
  conftest.py                session fixtures: httpx client, uploaded_pdf_id (real PDF lifecycle)
  test_health.py             /health, /health/detailed, per-service + API key checks
  test_pdfs.py               list, upload, URL, stream, TOC, 404s
  test_chat.py               basic, with selection, with history, sources schema, 404
backend/requirements-dev.txt pytest + pytest-asyncio

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
- **ToC stopping at B for Gale's Encyclopedia**: likely correct — Gale's is a multi-volume set; Volume 1 covers A–B. Pages 448–637 are probably appendices/index, not C–Z content.
- **Persistence (not yet built)**: all user data lives in browser memory. Highest priority next step.
- **Knowledge graph**: chunk embeddings + ToC section titles + highlight index entries = most of the data already exists. Nodes = ToC sections or highlight clusters; edges = cosine similarity between ChromaDB chunk vectors. Design the data model before building.
- **Image highlighting**: requires canvas region capture + multimodal Claude API call — feasible but higher cost per interaction.
