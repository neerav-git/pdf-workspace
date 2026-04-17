# Backend Deep-Dive

## Request Flow

```
POST /api/pdfs/upload
  → extract_pages() (PyMuPDF)
  → chunk_pages() (tiktoken, 512 tokens, 50 overlap)
  → embed() (sentence-transformers all-MiniLM-L6-v2)
  → s3_service.upload_file()
  → PDFDocument saved to Postgres
  → chroma_service.upsert_chunks()

POST /api/chat
  → embed(question)
  → chroma_service.query_chunks() → top 5 by cosine similarity
  → if best distance > 0.75: Tavily web search instead
  → if selection_text provided: injected directly into system prompt
  → Claude claude-sonnet-4-20250514 with prompt caching on system block
  → returns {answer, sources, web_search_triggered}

POST /api/voice/transcribe
  → validate MIME (strip codec params first)
  → openai.audio.transcriptions.create(model="whisper-1")
  → returns {text}

GET /api/pdfs/{id}/toc
  → s3_service.get_file_bytes()
  → toc_service.get_toc()
  → returns {items: [{level, title, page}], generated: bool, mode: "native"|"fine"|"chapter"}

GET /api/pdfs/{id}/toc/debug
  → returns font-size stats, threshold, first/last 10 candidates (paste to Claude to diagnose)

GET /health/detailed
  → checks Postgres, ChromaDB, S3, API key presence
  → returns {status, services: {postgres, chromadb, s3, api_keys}}
```

## TOC Service Logic (toc_service.py)

```
1. doc.get_toc(simple=True) → if non-empty, return (mode="native")

2. Determine granularity from page count:
   ≤ 150 pages → mode="fine"  (H1 ≥1.6× + H2 ≥1.25× median)
   > 150 pages → mode="chapter" (H1 ≥1.6× only)

3. Pass 1: collect all font sizes (no string decode — fast)
   body_median = statistics.median(all_sizes)

4. Pass 2: for each line exceeding threshold:
   - skip if len > 100, commas > 2, ends with "."
   - last_page[text] = page_num  ← last occurrence wins
     (front-matter printed ToC lists heading at page 3;
      actual content has same heading at page 250 → keep 250)

5. Sort by final page, return all items (no cap)
```

**Why last-occurrence wins**: encyclopedias/textbooks often have a printed ToC in the
front matter listing all entries with large text. Without this, every entry would point
to the front-matter page instead of the actual content page.

**Why size-aware**: a 5-page article needs every subheading; a 600-page encyclopedia
only needs chapter/entry titles — subheadings would flood the panel before reaching C.

## RAG / Chat Service Notes

- System prompt is cache_control=ephemeral (Anthropic prompt caching)
- If `selection_text` is present it's injected as "HIGHLIGHTED PASSAGE" before RAG chunks
- Tavily only called when `best_distance > 0.75` AND no selection_text
- Chat history is passed from frontend on each request (not stored server-side)

## Health / Debug Endpoints

- `GET /health` — basic liveness check
- `GET /health/detailed` — deep check of all dependencies; use when backend behaves unexpectedly
- `GET /api/pdfs/{id}/toc/debug` — font stats + candidates; use when ToC looks wrong or stops early

## Key Fixes Recorded

- `chromadb.HttpClient` is a factory, not a class — type annotation `_client: chromadb.HttpClient | None` crashes → removed annotation
- Voice MIME `audio/webm;codecs=opus` → strip everything after `;` before validation
- Whisper needs tuple `("recording.webm", bytes, "audio/webm")` not BytesIO
- TOC stopping at B for Gale's Encyclopedia — likely correct (Volume 1 only covers A–B); not a bug
