---
file: 04_build_decisions.md
purpose: Expand every Tier 1 technical decision into a build-ready specification with literature-backed justifications. This is the file Claude Code reads during implementation to make defensible design choices without reinventing the reasoning each time.
last_updated: 2026-04-16
depends_on: [01_literature_landscape.md, 02_gap_analysis.md, 03_methodology_reference.md]
referenced_by: [CLAUDE.md]
status: step_4_deliverable
---

# Build Decisions — Technical Specifications with Justifications

> This file is the implementation reference. Each decision has a confidence level, a primary justification, alternatives considered, and concrete implementation guidance. Decisions labeled `well-supported` have strong literature backing and should not be casually revised. Decisions labeled `reasoned-choice` are judgment calls — reasonable but revisable if downstream constraints push back. Decisions labeled `pending-evidence` are placeholders for choices that depend on pilot data.

---

## How to Read This File

Each decision follows a consistent schema:

- **Decision:** what is being decided.
- **Confidence:** `well-supported` / `reasoned-choice` / `pending-evidence`
- **Primary justification:** one-paragraph argument with citations.
- **Alternatives considered:** what else was on the table, and why it lost.
- **Implementation note:** concrete guidance for the code.
- **Cross-file references:** which other files in this folder expand on the decision.

Decisions are grouped by system component.

---

## Scope Discipline — Read Before Implementing Any System-Design Feature

Tier 1 decisions fall into two categories with **different build standards**:

**Empirical-core features (Groups A–F, H, I):** Full production quality. These feed the primary thesis analysis. Correctness, reproducibility, and methodological rigor are non-negotiable. Cutting corners here invalidates the thesis. Build these first; they are the spine.

**System-design features (Groups G, K, L):** Demo-skeleton quality. These demonstrate the system's breadth in the thesis's Chapter 3 (system design) and are evaluated only via qualitative survey feedback. **The goal is an architecturally sound skeleton that looks complete in a demo video, with clearly-stubbed extension points, NOT a fully working feature.** Cutting corners here is expected and planned.

What "demo skeleton" means in practice for each system-design feature:
- The main interaction path works end-to-end for a well-chosen demo scenario.
- Edge cases are acknowledged in code comments as extension points but not handled.
- The architecture has correct extension points — future work can enhance the feature without rewriting the foundation.
- Each feature has a documented **cut line**: what to drop if the build runs over, and what "critically behind" looks like. If you hit the cut line, reduce scope rather than delay Tier 1 empirical-core work.
- Total budget for all three system-design features combined: roughly 3–4 weeks.

This distinction matters because the thesis's empirical claim rests entirely on the empirical-core features. The system-design features contribute to Chapter 3 breadth and engagement-angle arguments, but if they ship in polished form while the review session UI is half-broken, the thesis fails. Priority order during build:

1. Empirical-core Tier 1 features working end-to-end (Groups A–F, H).
2. Pre-registration and IRB (Group I).
3. System-design demo skeletons (Groups G, K, L).
4. Tier 1.5 retention dashboard (J3) if time permits.
5. Polish pass on everything.

Do not skip ahead.

---

## Group A — Scheduling Algorithm

### A1. Use FSRS (not SM-2, not HLR, not a custom algorithm)

- **Confidence:** well-supported
- **Primary justification:** The Open Spaced Repetition benchmark across 9,999 Anki collections and ~350M reviews shows FSRS-6 achieves 99.6% log-loss superiority over SM-2 [1.3]. FSRS has peer-reviewed pedigree via the KDD 2022 SSP-MMC paper [1.1] and IEEE TKDE extension [1.2]. It is Python-native (`pip install fsrs`), open source, and now Anki's default scheduler. No competing algorithm has the same combination of empirical support, open-source availability, and deployment evidence.
- **Alternatives considered:** SM-2 (simpler but empirically inferior per [1.3]); HLR (Settles & Meeder 2016 [1.4], 12% Duolingo engagement gain but less accurate than FSRS on the benchmark); MEMORIZE (PNAS 2019 [1.5], more principled but less deployed); custom interval-from-rating heuristics (no grounding).
- **Implementation note:** Use the official `fsrs` Python package. Pin the version in requirements.txt. Pick a major version (FSRS-4.5 or FSRS-6) and freeze it for the study period; do NOT let FSRS-7 auto-upgrade mid-study — that's a methodological confound per Soderstrom & Bjork's learning-vs-performance concern [1.7].
- **Cross-file:** `02_gap_analysis.md` Part 6; `03_methodology_reference.md` Part 6 (pre-registration).

### A2. Freeze FSRS default parameters for the study period

- **Confidence:** reasoned-choice
- **Primary justification:** FSRS has tunable per-user weights that can be optimized on the user's review history. Allowing mid-study optimization would confound the primary analysis — users' scheduling changes during the study would not be consistent across participants. Freezing weights for the pre-registered study period preserves internal validity.
- **Alternatives considered:** Letting FSRS auto-optimize per user (better personalization but confounds). Fully manual weight-tuning (no grounding).
- **Implementation note:** Record the exact weight vector used in each `review_log` row. After the study ends, optimization can be re-enabled for production use; the thesis reports results under frozen weights.
- **Cross-file:** `03_methodology_reference.md` Part 5.5, Part 6.

### A3. FSRS rating derived from Claude's grade, not user self-rating

- **Confidence:** well-supported (this is the thesis's core contribution)
- **Primary justification:** This is Gap 1 in `02_gap_analysis.md`. Self-rated recall has documented miscalibration problems per Bjork, Dunlosky & Kornell 2013 [4.12]. Replacing self-rating with LLM-evaluated grading against source material is the thesis's central methodological contribution.
- **Alternatives considered:** Traditional user self-rating (the default in every SRS ever shipped — but this is exactly what the thesis replaces). Hybrid of both (too complex; dilutes the contribution claim).
- **Implementation note:** Mapping from Claude's 1–5 overall score to FSRS's 4-level rating (Again/Hard/Good/Easy):
  - Claude score 1 → FSRS Again (1)
  - Claude score 2 → FSRS Hard (2)
  - Claude score 3 → FSRS Good (3)
  - Claude score 4–5 → FSRS Easy (4)
  Store BOTH Claude's raw 1–5 and the derived FSRS rating in `review_log` so the mapping can be changed post-hoc and re-analyzed.
- **Cross-file:** `02_gap_analysis.md` Gap 1; `03_methodology_reference.md` Part 7.2.

---

## Group B — Data Model

### B1. Inline FSRS state on `qa_pairs`, not in a separate `memory_items` table

- **Confidence:** reasoned-choice
- **Primary justification:** Every Q&A pair in the index *is* a memory item by definition; a 1:1 join adds no information and increases consistency risk. Your roadmap.md proposed a separate `memory_items` table joining `qa_pairs` — this creates synchronization issues (what happens when a Q&A is deleted? both rows need to go) and a needless join on every scheduling query. The `qa_pairs` table is the natural home for FSRS state.
- **Alternatives considered:** Separate `memory_items` (roadmap.md original; more normalized but no benefit); document-based NoSQL (not justified for this data shape).
- **Implementation note:** Schema per `03_methodology_reference.md` and prior backend.md:
  ```sql
  qa_pairs (
    id, entry_id, question, answer, source_chunk_ids JSONB,
    stability FLOAT, difficulty FLOAT,
    elapsed_days INT, scheduled_days INT,
    reps INT, lapses INT,
    state VARCHAR(10),        -- 'new' | 'learning' | 'review' | 'relearning'
    due_at TIMESTAMP,
    last_review TIMESTAMP,
    created_at, updated_at,
    starred BOOLEAN DEFAULT FALSE
  )
  CREATE INDEX ON qa_pairs (due_at) WHERE state != 'suspended';
  ```
- **Cross-file:** `02_gap_analysis.md` Part 6.

### B2. `review_log` table is thesis-critical, not optional

- **Confidence:** well-supported
- **Primary justification:** Every row in `review_log` is a data point for the thesis's primary and secondary analyses. Without this table the app can ship but the thesis cannot measure its own claim. The fields must be designed *before* the pilot, not after.
- **Alternatives considered:** Storing only the latest review state on `qa_pairs` (destroys the longitudinal record needed for analysis). Event-sourced logs only (over-engineering).
- **Implementation note:**
  ```sql
  review_log (
    id, qa_pair_id,
    reviewed_at TIMESTAMP,
    confidence_rating SMALLINT,   -- user's 1-5 pre-grade (Gap 4)
    recall_text TEXT,             -- what the user typed
    recall_latency_ms INT,        -- card-shown to submit (exploratory outcome)
    claude_grade_overall SMALLINT,-- Claude's 1-5
    claude_grade_core SMALLINT,
    claude_grade_detail SMALLINT,
    claude_grade_faithfulness SMALLINT,
    claude_confidence SMALLINT,   -- Claude's self-reported 1-5 (Ferrer 2026)
    claude_rubric_hits JSONB,     -- analyzable concept list
    claude_missing JSONB,
    claude_feedback TEXT,
    fsrs_rating SMALLINT,         -- derived 1-4 that fed FSRS
    prior_stability FLOAT,
    new_stability FLOAT,
    elapsed_since_last_days FLOAT,
    model_version VARCHAR(100),   -- e.g., "claude-sonnet-4-20250514"
    rubric_version_id VARCHAR(50),
    system_prompt_version VARCHAR(50)
  )
  ```
  The `model_version`, `rubric_version_id`, and `system_prompt_version` fields are essential for methodology reporting and sensitivity analysis.
- **Cross-file:** `02_gap_analysis.md` Gap 4; `03_methodology_reference.md` Part 4.2, Part 7.

### B3. Store source chunk IDs on Q&A pairs, not just passage text

- **Confidence:** reasoned-choice
- **Primary justification:** During review, the system needs to show the passage the recall is about (Layer 2 of the response template; also needed for Claude to ground grading in source material per RAG-augmented grading [2.13]). Storing chunk IDs (not copied text) keeps the system single-source-of-truth; changes to chunking or embeddings propagate correctly.
- **Alternatives considered:** Copy passage text into `qa_pairs` at creation time (denormalized; faster reads; but drifts from ChromaDB if chunks change). Store only the page number (insufficient context; reviewer may see wrong paragraph).
- **Implementation note:** `source_chunk_ids` is JSONB array of ChromaDB IDs. Resolve to text at review time via `chroma_service.get_chunks(ids)`. Cache if perf matters.
- **Cross-file:** backend.md (existing chunking pipeline).

### B4. Don't version `qa_pairs`; DO version rubrics, prompts, and model strings

- **Confidence:** reasoned-choice
- **Primary justification:** Q&A content (question text, answer text) shouldn't change post-hoc once generated and shown to a user — that would create a reproducibility disaster. Rubrics and prompts SHOULD be versioned because they're part of the experimental apparatus and the thesis must be able to re-grade old responses under a revised rubric for sensitivity analysis. Model string versioning is required per Ferrer 2026 [2.9] methodology — model updates during the study are a confound.
- **Alternatives considered:** Version everything (over-engineering; Q&A changes are not a realistic failure mode). Version nothing (unrecoverable if rubric changes mid-pilot).
- **Implementation note:** Two small tables:
  ```sql
  rubric_versions (id, version_tag, rubric_json, system_prompt, created_at, frozen_at)
  prompt_versions (id, version_tag, prompt_text, created_at, frozen_at)
  ```
  The `frozen_at` field is set when a version is locked for the pre-registered study period. Any changes after `frozen_at` require a new version.
- **Cross-file:** `03_methodology_reference.md` Part 7.4, Part 6.

### B5. Chat history stays ephemeral / frontend-owned

- **Confidence:** well-supported
- **Primary justification:** This matches the existing decision in backend.md and roadmap.md. Server-side chat history has no thesis purpose — the thesis measures retention of Q&A review, not chat turns — and storing it creates privacy, scale, and compliance concerns. Per the PDF "No server-side chat history — frontend owns it, sends each request."
- **Alternatives considered:** Server-side chat history (privacy risk, no benefit for thesis).
- **Implementation note:** Keep current behavior. Frontend sends `history` array with each `/api/chat` request.
- **Cross-file:** backend.md.

---

## Group C — Grading System

### C1. Analytical rubric (three dimensions), not holistic single-score

- **Confidence:** well-supported
- **Primary justification:** Yavuz 2024 [5c.1] achieved ICC = 0.972 with fine-tuned ChatGPT using an analytical 5-domain rubric — explicit evidence that analytical rubrics outperform holistic ones on LLM grader agreement. Grevisse 2024 [2.7] also emphasizes "high-quality keys" (detailed rubrics) as the decisive factor in LLM grading consistency. Holistic scoring conflates distinguishable concepts (completeness vs. accuracy vs. faithfulness) and yields less usable per-dimension analysis.
- **Alternatives considered:** Holistic 1-5 score (simpler but lower IRR ceiling per [5c.1]); more than three dimensions (adds complexity; three is the empirical sweet spot for recall tasks).
- **Implementation note:** Three dimensions per `03_methodology_reference.md` Part 7.2:
  - **core_claim** (does the recall capture the main claim?)
  - **supporting_detail** (accurate mechanism/evidence?)
  - **faithfulness** (are asserted details correct per source? — confabulation detector)
  Each 1–5. Overall = mean. All four scores stored in `review_log`.
- **Cross-file:** `03_methodology_reference.md` Part 7.

### C2. Structured JSON output from grading call, not prose

- **Confidence:** well-supported
- **Primary justification:** GradeOpt [2.8] and the broader LLM-as-grader literature consistently show structured outputs are more reliable and analyzable than parsed prose. The `rubric_hits` and `missing` arrays are directly analyzable ("which concepts did users retain vs. forget?") without re-grading. Parsing prose grades into numbers is error-prone.
- **Alternatives considered:** Free-form prose grade (harder to analyze, more parse failures); XML or other structured formats (JSON is standard for the Anthropic API).
- **Implementation note:** Exact schema per `03_methodology_reference.md` Part 7.3. Use Claude's structured-output / tool-use mode. Validate the JSON on receipt; retry once with a "your last response failed JSON validation" prompt if malformed; log validation failures.
- **Cross-file:** `03_methodology_reference.md` Part 7.3.

### C3. Claude's self-reported confidence is stored and used for routing

- **Confidence:** well-supported
- **Primary justification:** Ferrer et al. 2026 [2.9] compared three confidence-estimation methods (self-reported, self-consistency voting, token probability) across 7 LLMs and 3 ASAG datasets. **Self-reported confidence had the best calibration (ECE 0.166) and is the cheapest to obtain** (single inference call vs. 5× for self-consistency). No other approach justifies its cost.
- **Alternatives considered:** Self-consistency (5× cost, worse calibration per [2.9]); token log-probabilities (not reliably exposed across providers, worse calibration); no confidence capture (loses routing capability).
- **Implementation note:** Add `confidence` field to the grading JSON schema (1–5 self-report). Store in `review_log.claude_confidence`. In thesis analysis, report calibration of Claude's confidence vs. human grader as a secondary methodological finding.
- **Cross-file:** `03_methodology_reference.md` Part 7.3.

### C4. Rubric and prompt freeze before pre-registered data collection

- **Confidence:** well-supported
- **Primary justification:** A pilot phase iterates the rubric against human grader feedback (per `03_methodology_reference.md` Part 7.5). Once ICC reaches acceptable levels, the rubric is frozen for the main study. Changes after freezing require a new version and explicit documentation. This matches pre-registration best practices [5b.1].
- **Alternatives considered:** Iterating during main data collection (invalidates results); never iterating (may ship a bad rubric).
- **Implementation note:** `rubric_versions.frozen_at` timestamp. Any grading call references a specific `rubric_version_id`. The analysis code reads only `review_log` rows where `rubric_version_id = '<frozen_version>'`.
- **Cross-file:** `03_methodology_reference.md` Part 6, Part 7.5.

### C5. `temperature=0` for all grading calls, and pin the exact model string

- **Confidence:** well-supported
- **Primary justification:** Deterministic (or near-deterministic) grading reduces within-study variance. Different temperatures produce different grading behavior per the ChatGPT vs. Gemini comparison study [referenced in entry 2.9's broader context: "changing the temperature parameter within the same model leads to behavior shifts"]. Pinning the exact model string (e.g., `claude-sonnet-4-20250514`, not `claude-sonnet-4-latest`) prevents silent model updates from confounding results.
- **Alternatives considered:** Non-zero temperature (more natural-feeling feedback; variance risk); latest-version model pointer (risk of silent model updates during study).
- **Implementation note:** Config file with frozen model string. Log `model_version` in every `review_log` row. If Anthropic deprecates the pinned model mid-study, document the forced switch as a protocol deviation.
- **Cross-file:** `03_methodology_reference.md` Part 6.

### C6. Ground grading in retrieved source passage (RAG-augmented grading)

- **Confidence:** reasoned-choice
- **Primary justification:** The EDM 2025 paper on RAG-augmented grading [2.13] shows that grading LLMs perform better when they have access to the domain-specific source material, not just the question and student answer. Since your system already has ChromaDB embeddings, passing the relevant source chunks into the grading prompt is a near-free lift with empirical support.
- **Alternatives considered:** Grade using Claude's priors only (risk of grading against Claude's worldview rather than the source document — especially bad for technical/scientific content); grade against the full document (too many tokens).
- **Implementation note:** Grading prompt structure:
  ```
  System: [grading rubric and instructions]
  User:
    SOURCE PASSAGE: [chunks from qa_pairs.source_chunk_ids]
    QUESTION: [qa_pair.question]
    EXPECTED ANSWER (for reference, derived from source at creation time): [qa_pair.answer]
    STUDENT'S TYPED RECALL: [review_log.recall_text]
    [return structured grading JSON per schema]
  ```
  This is the distinguishing feature vs. generic ASAG: grading is grounded in the passage the user actually read.
- **Cross-file:** `03_methodology_reference.md` Part 7.

---

## Group D — Review UI

### D1. Review session lives on a separate screen, not a panel in the PDF viewer

- **Confidence:** well-supported
- **Primary justification:** VISION.md and `02_gap_analysis.md` both establish this. Retrieval practice requires distraction-free generation [2.2] and the "desirable difficulties" framing from Bjork [4.3] / Soderstrom & Bjork [1.7] implies the review experience should feel distinctly effortful, not casually glanceable. Mixing review with reading undermines the separation.
- **Alternatives considered:** Review as a right-panel mode of the PDF viewer (current roadmap implication but weaker for deliberate practice); modal overlay (cramped).
- **Implementation note:** Dedicated route (e.g., `/review`). Own layout, minimal chrome. Reading-mode context (highlight color, PDF page context) is available but not prominent. Back-navigation to the PDF is one click, but not on the review screen by default.
- **Cross-file:** VISION.md; `02_gap_analysis.md` Part 6.

### D2. Confidence rating submitted WITH recall text in a single action, before grade reveal

- **Confidence:** well-supported
- **Primary justification:** This is Gap 4 in `02_gap_analysis.md`. Bjork, Dunlosky & Kornell 2013 [4.12] show fluency-driven overconfidence is systematic; confidence calibration is a secondary outcome the thesis measures. If the user sees Claude's grade before rating their own confidence, the confidence rating is contaminated by the grade and is no longer a measure of pre-feedback metacognition.
- **Alternatives considered:** Separate screens for recall → confidence → grade (three clicks instead of two; but critically, if the user sees partial feedback between screens, confidence is contaminated); skipping confidence entirely (loses the secondary outcome).
- **Implementation note:** One form, submit both fields together:
  ```
  POST /api/review/submit
    { qa_pair_id, recall_text, confidence_rating, recall_latency_ms }
  ```
  UI enforces: confidence slider cannot be skipped; grade is not shown until the form is submitted. After submit, a single response returns the grade + Claude's feedback.
- **Cross-file:** `02_gap_analysis.md` Gap 4; `03_methodology_reference.md` Part 4.2.

### D3. Show Claude's feedback and correct answer after grading, always

- **Confidence:** well-supported
- **Primary justification:** Roediger & Butler 2011 [2.3] — "feedback enhances the benefits of testing." Adesope 2017 [2.1] identifies feedback as a moderator. Greving & Richter 2018 [5d.4] showed that WITHOUT feedback, testing effects can disappear in authentic settings. Feedback is not optional — it's part of what makes the intervention work.
- **Alternatives considered:** Grade only (missing the feedback that makes testing work); progressive feedback (first the grade, then "reveal answer" button — adds friction without benefit).
- **Implementation note:** After submission, always show: (1) Claude's overall score + per-dimension scores; (2) Claude's plain-language feedback; (3) the correct answer (from `qa_pairs.answer`); (4) the source passage with a "view in context" link back to the PDF page. Users can't disable feedback.
- **Cross-file:** `03_methodology_reference.md` Part 7.

### D4. Quiz Me and Review Session share the same grading engine

- **Confidence:** reasoned-choice
- **Primary justification:** One evaluation engine is easier to maintain, test, and defend in the thesis. Quiz Me differs from Review Session only in card selection criteria (PDF-scoped vs. due-cards-global); the grading pipeline, confidence-rating flow, feedback display, and FSRS update are identical. Building two paths invites divergence.
- **Alternatives considered:** Separate code paths (per roadmap.md's original framing; double maintenance burden; risk of divergent rubrics).
- **Implementation note:** Single `ReviewSession` component. Query differs:
  - Review: `SELECT * FROM qa_pairs WHERE due_at <= NOW() AND state != 'suspended' ORDER BY due_at ASC`
  - Quiz Me: `SELECT * FROM qa_pairs WHERE pdf_id = $1 [AND page BETWEEN $2 AND $3] [AND starred = TRUE]`
  Same `/api/review/submit` endpoint for both.
- **Cross-file:** `02_gap_analysis.md` Part 7.

### D5. No multiple choice; typed recall only

- **Confidence:** well-supported
- **Primary justification:** Bisra et al. 2018 [2.6]: self-explanation meta-analysis showed multiple-choice format was the least effective of the formats compared (g = .55 overall, lowest for MC). Butler & Roediger 2007 [5d.5]: short-answer + feedback produced strongest retention. The entire thesis claim rests on generative recall; MC is recognition, not generation.
- **Alternatives considered:** MC as an "easy mode" (undermines the claim); MC after typed recall to check completeness (adds complexity for marginal benefit).
- **Implementation note:** Textarea for recall input. No word-count limit but a gentle suggestion ("1–3 sentences usually").
- **Cross-file:** `02_gap_analysis.md` Part 6.

---

## Group E — Instrumentation (Thesis-Critical)

### E1. Log recall latency (card-shown → submit) on every review

- **Confidence:** reasoned-choice
- **Primary justification:** Latency is a cheap-to-collect standard engagement/difficulty proxy. Useful as an exploratory outcome (did users speed up over time?) and as a sensitivity covariate (did one condition have systematically longer engagement?). No cost beyond a timestamp diff.
- **Alternatives considered:** Skip latency (loses useful signal for ~zero effort saved).
- **Implementation note:** Start timer when card is fully rendered (not on route change). Stop on submit. Log in `review_log.recall_latency_ms`. Drop values > 30 min as session-abandonment outliers in analysis.
- **Cross-file:** `03_methodology_reference.md` Part 4.4.

### E2. Session events table for engagement analysis

- **Confidence:** reasoned-choice
- **Primary justification:** The thesis reports return-visit and session-frequency patterns (secondary / exploratory outcome per `03_methodology_reference.md` Part 4.4). A session events table is the clean way to capture this; inferring sessions from `review_log` timestamps is fragile.
- **Alternatives considered:** Infer from `review_log` timestamps (fragile, ambiguous session boundaries); skip (loses engagement data).
- **Implementation note:**
  ```sql
  session_events (
    id, user_id, session_type VARCHAR(20), -- 'review' | 'quiz' | 'read' | 'chat'
    pdf_id, started_at, ended_at, item_count INT,
    condition_label VARCHAR(20)  -- for study participants only
  )
  ```
  Define session end as 30 minutes of inactivity or explicit "end session" action.
- **Cross-file:** `03_methodology_reference.md` Part 4.4.

### E3. `/api/research/export` endpoint returning CSV/JSON of study data

- **Confidence:** well-supported
- **Primary justification:** You'll need to get data out of Postgres into R/Python/pandas for statistical analysis. Building this endpoint now means you aren't reverse-engineering your own schema at thesis-writing time. Restrict access (admin-only or token-gated).
- **Alternatives considered:** Direct SQL access only (works but adds friction); manual CSV dumps (error-prone, not reproducible).
- **Implementation note:** Single endpoint returns all relevant tables joined: `review_log` ⋈ `qa_pairs` ⋈ `highlight_entries` ⋈ `session_events` ⋈ participant metadata. Anonymize user IDs. Include a `study_condition` column for study participants. Document the schema in the thesis methodology chapter.
- **Cross-file:** `03_methodology_reference.md` Part 8.

### E4. IRR sub-study plumbing: flag a sample of responses for human grading

- **Confidence:** well-supported (methodological contribution claim depends on this)
- **Primary justification:** Gap 7 / `03_methodology_reference.md` Part 4.3. The IRR sub-study requires ~100 recall responses to be graded by both Claude and a human expert. The simplest way to enable this is a flag on `review_log` that marks selected rows for export to a human-grading interface (can be as simple as a CSV the human fills in).
- **Alternatives considered:** Grade a random sample post-hoc (can't guarantee stratification); grade all (too much work).
- **Implementation note:** Add `human_grading_sample BOOLEAN` to `review_log`. Stratified sampling script selects ~100 responses across papers, question types, and conditions. Human grader interface shows source + question + expected answer + user's recall (no Claude scores visible — blinding). Collects human 1–5 on each of three dimensions. Store in a parallel `human_grades` table, join on `review_log.id` for ICC computation.
- **Cross-file:** `03_methodology_reference.md` Part 4.3.

---

## Group F — Persistence Architecture

### F1. PostgreSQL as single source of truth for Q&A state; frontend Zustand is a cache

- **Confidence:** well-supported
- **Primary justification:** VISION.md Tier 1 priority #1: "a retention app that forgets everything on refresh is self-defeating." Frontend state must load from API on PDF select and on tab refocus; all mutations (save highlight, create Q&A, review submission) must write server-side before being reflected in local state.
- **Alternatives considered:** Local-first with sync (over-engineering for this stage; sync conflicts are a whole subproblem); server-side only with no frontend state (poor UX, unnecessary re-fetches).
- **Implementation note:** Zustand store subscribes to PDF-select events and refetches from API. Write operations are optimistic (update local state immediately) with rollback on API error. Document the cache-invalidation rules in PROJECT.md.
- **Cross-file:** roadmap.md Tier 1; frontend.md.

### F2. Chat selection-text injection continues to bypass RAG

- **Confidence:** well-supported
- **Primary justification:** Existing design decision in backend.md and PDF conversation: "Selection text bypasses RAG — direct injection; RAG can't reliably find exact highlighted passage." This decision stays. For grading, RAG is used (C6); for chat with a highlighted selection, direct injection remains.
- **Alternatives considered:** RAG for selection chat (reliability issues documented in existing decisions).
- **Implementation note:** Preserve current behavior.
- **Cross-file:** backend.md.

---

## Group G — Learning Graph (Tier 1 System Feature, Demo-Skeleton Spec)

> **Scope discipline — read this before implementing.** The goal is a **visually impressive demo skeleton** with correct architectural foundations, not a fully-working interactive graph system. Demo target: the graph renders, it's clearly distinct from a document-concept graph, and you can click a node to see its Q&A. Extension points are documented in the code for future work, but **not implemented**. Total build budget: ~5–7 days including frontend polish.

### G1. Learning graph renders as a retention-state visualization (demo skeleton)

- **Confidence:** reasoned-choice (system design contribution, not empirical claim)
- **Primary justification:** Per Gap 8 revision in `02_gap_analysis.md`. Nodes represent the user's Q&A pairs; edges represent cosine similarity over source chunks; node color encodes FSRS stability (retention strength). This visibly distinguishes the feature from Karpathy/Graphify/Obsidian-style document-concept graphs, which are corpus-centric rather than learner-centric. The distinction is the thesis's design contribution.
- **Alternatives considered:** Document-concept graph (same as existing tools; no contribution); no graph (user feedback suggests it's valuable; engagement angle per [2.17]).

**IN demo scope:**
- One backend endpoint: `GET /api/graph/:pdf_id` returns `{nodes, edges}`.
- Nodes computed as one-per-Q&A-pair (no clustering). Node payload: `{id, label (question text truncated), stability, review_count, last_review}`.
- Edges computed as cosine similarity between source chunks above a fixed threshold (e.g., 0.75). Capped at top-K edges per node to prevent hairballs (e.g., K=3).
- D3 force-directed layout on the frontend.
- Node color: gradient on `stability` (red = low / at-risk, green = high / retained). Node size: proportional to review count, floor of 4px.
- Click node → side panel opens showing the Q&A pair + last review grade + "review now" link back to the review session.
- Static snapshot — graph recomputes on page load, not live-updating.

**NOT in demo scope (documented as extension points in code):**
- Concept clustering (nodes per cluster, not per Q&A) — requires Claude-generated cluster labels, non-trivial.
- Cross-PDF graph (merging all documents) — requires handling scale and separate ChromaDB collections.
- Real-time updates as reviews happen — requires WebSocket or polling infrastructure.
- Interactive filters (by tag, date, starred) — extension point, not built.
- Export to Obsidian-compatible format — extension point.
- Graph-walk navigation ("show me concepts related to this one I've forgotten") — extension point, genuinely useful but Tier 3.

**Implementation note (demo-quality):**
```
services/graph_service.py:
    def build_graph(pdf_id):
        qa_pairs = load_qa_pairs_for_pdf(pdf_id)
        chunks = {qa.id: load_chunks(qa.source_chunk_ids) for qa in qa_pairs}
        nodes = [to_node(qa) for qa in qa_pairs]
        edges = top_k_similarity_edges(chunks, threshold=0.75, k=3)
        return {"nodes": nodes, "edges": edges}
```
Frontend: one React component using `react-force-graph-2d` (already in your stack per backend.md). ~200 lines of code including the side panel.

**Cut line:** If not working 10 days before pilot, cut the side-panel interaction and ship as a static graph view with tooltip-on-hover. If critically behind, cut entirely and document as "planned but unshipped" in thesis.

**Cross-file:** `02_gap_analysis.md` Gap 8 (revised); VISION.md Tier 3 full vision.

### G2. Evaluate the graph qualitatively via post-study survey

- **Confidence:** well-supported
- **Primary justification:** Per Gap 8 revision. A head-to-head empirical comparison is out of master's scope. 3–4 Likert items + 1 open-response in the post-study survey is sufficient for a Chapter 3 design contribution + Chapter 5 user-feedback discussion.
- **Implementation note:** Survey items:
  - "How often did you use the learning graph?" (never / once / a few times / regularly)
  - "The learning graph helped me see what I've learned and what I haven't." (1–5 Likert)
  - "The learning graph changed how I decided what to review." (1–5 Likert)
  - "Any thoughts on the learning graph feature?" (open)
- **Cross-file:** `03_methodology_reference.md` Part 4.4.

---

## Group H — Response Template (Retain from Existing Design)

### H1. Keep RESPONSE_TEMPLATE.md layered-disclosure architecture

- **Confidence:** well-supported
- **Primary justification:** LearnLM (Jurenka et al. 2024) [2.14] explicitly validates the pedagogical-instruction-following approach — system prompts specifying pedagogy attributes produced LLM outputs that expert raters preferred over GPT-4o (+31%), Claude 3.5 (+11%), and base Gemini 1.5 (+13%). Your RESPONSE_TEMPLATE.md takes exactly this stance. InsightGUIDE (2025) [5a.3] also validates structured-prompting approaches for academic reading. The template is well-grounded prior art you can cite.
- **Alternatives considered:** Drop the response template in favor of generic Claude responses (loses the pedagogical structure that differentiates the tool). Adopt LearnLM directly (Google-only; ties you to Gemini).
- **Implementation note:** Keep RESPONSE_TEMPLATE.md as the system prompt for `/api/chat` and `/api/chat/selection`. Version it (store `system_prompt_version` per request). For grading calls specifically, use a different system prompt focused on grading rubric — not the response template.
- **Cross-file:** RESPONSE_TEMPLATE.md (existing); `02_gap_analysis.md` Part 6.

### H2. Use Anthropic prompt caching on the response template system block

- **Confidence:** reasoned-choice
- **Primary justification:** Existing backend.md decision, kept. Cache-control on the long system block reduces per-request tokens and cost. No methodological concerns — caching doesn't change model behavior.
- **Alternatives considered:** No caching (higher cost, no benefit).
- **Implementation note:** `cache_control: ephemeral` on the system message.
- **Cross-file:** backend.md.

---

## Group I — Pre-Registration and Ethics

### I1. Pre-register primary hypothesis, design, analysis plan on OSF before main data collection

- **Confidence:** reasoned-choice (recommended, not required)
- **Primary justification:** `03_methodology_reference.md` Part 6. Modest effort, meaningful credibility return, aligns with current best practice in empirical psychology and AIED. Pre-registration distinguishes confirmatory from exploratory analyses honestly.
- **Alternatives considered:** No pre-registration (still acceptable but gives up a credibility lever); registered report (more rigorous but requires pre-approval from a journal).
- **Implementation note:** OSF template for pre-registration. Complete after pilot, before main study. Distinguish confirmatory (in plan) from exploratory (not) in thesis write-up.
- **Cross-file:** `03_methodology_reference.md` Part 6.

### I2. IRB approval is a hard blocker on data collection

- **Confidence:** well-supported
- **Primary justification:** Human-subjects research requires IRB / ethics committee approval at any research institution. Start the application process 6+ weeks before planned data collection.
- **Alternatives considered:** None. This is non-negotiable.
- **Implementation note:** Consult your institution's IRB. Common gotchas: logging sensitive data (minimize — store Q&A and recall text, not identifying content); recruiting from your own courses (may require additional review); data retention policy (establish and document).
- **Cross-file:** `03_methodology_reference.md` Part 9 timeline.

---

## Group K — Visual Intelligence (Tier 1 System Feature, Demo-Skeleton Spec)

> **Scope discipline — read this before implementing.** The goal is a **visually impressive demo skeleton** that shows the system *can* reason about non-text content in PDFs, not a production multimodal reading tool. Demo target: drag-select a region, see Claude's response in the chat panel, log that it happened. Extension points are stubbed in code, not implemented. Total build budget: ~4–6 days.

### K1. Drag-select region → single multimodal Claude call → chat-panel response (demo skeleton)

- **Confidence:** reasoned-choice (demo-skeleton system feature)
- **Primary justification:** The feature grounds in dual-coding theory (Paivio — referenced in your RESPONSE_TEMPLATE.md preamble) and in HCI precedents for interacting with non-text regions of academic papers (ScholarPhi's equation interactions [5a.2]). For the thesis, it demonstrates the system's breadth beyond text-only recall. No empirical gap closed — this is system-design contribution, not empirical contribution.
- **Alternatives considered:** Background visual analysis of all pages (over-engineering for demo skeleton); equation-specific parsing (narrow); text-only (misses the feature).

**IN demo scope:**
- Transparent canvas overlay on each rendered PDF page (2x device pixel ratio to preserve detail).
- Mousedown/move/up captures a rectangle. On release, `canvas.getImageData()` → base64 PNG.
- **Single button** shown on release: "Ask about this."
- Click → prompts user for a question via small inline input (or uses a default "Explain this visually" prompt if they skip).
- `POST /api/chat/visual` sends base64 image + the user's question + surrounding-text context (±1 page from source chunks) to Claude via multimodal API.
- Response rendered in the existing chat panel, like any other chat turn.
- Session event logged (`session_type = 'visual_chat'`).

**NOT in demo scope (documented as extension points):**
- Multiple action buttons (Explain / Break down / Ask / Save) → just one button.
- Saving visual selections as reviewable Q&A cards → requires schema change to `qa_pairs` to support image content. Big lift. Flag as extension.
- Background pre-analysis of all document images → not needed for demo.
- Equation-specific structured handling (rendering LaTeX, etc.) → extension.
- Cross-document image search → Tier 3, tied to knowledge graph future work.
- Handling non-standard PDF pages (rotated, landscape) → acknowledged edge case; best-effort in demo.

**Implementation note (demo-skeleton):**
```
Frontend:
- PDFPage component adds a <canvas> overlay per rendered page.
- Simple state machine: idle → dragging → captured → prompting → resolved.
- On 'captured', show one button absolutely positioned near the selection.
- On click → inline input for question; Enter or click "Send" posts to backend.

Backend:
- POST /api/chat/visual
  Body: {pdf_id, page_number, image_base64, question, context_chunks}
  → Anthropic multimodal API call with image block + text block.
  → Return {response_text}.
  → Log session_event.
```
No persistent storage of the image. If the user wants to re-ask about the same region, they re-select — this is a deliberate demo simplification.

**Cut line:** If not working 10 days before pilot, degrade to a single "Ask about this page" button (no drag-select; whole page as image). If critically behind, cut entirely and describe as "planned" in thesis. The demo skeleton depends on Anthropic multimodal API working for your model choice — verify this early.

**Cross-file:** `02_gap_analysis.md` system-building framing note; `02_gap_analysis.md` Part 3 framing note.

### K2. Visual selections logged in session_events, not review_log

- **Confidence:** reasoned-choice
- **Primary justification:** Visual selections are a breadth-demonstration feature, not an empirical outcome variable. `session_events` suffices. Adding to `review_log` would conflate the grading pipeline with an unrelated feature.
- **Implementation note:** `session_type = 'visual_chat'`. No schema changes required.
- **Cross-file:** decision E2.

---

## Group L — Feynman Mode (Tier 1 System Feature, Demo-Skeleton Spec)

> **Scope discipline — read this before implementing.** The goal is a **visually impressive demo skeleton** that shows the system supports generative-elaboration learning, not a production Feynman-tracking system. Demo target: user picks a concept, engages in a short Socratic-style exchange, sees a gap summary at the end. Extension points are stubbed, not implemented. Total build budget: ~3–5 days (mostly prompt engineering and UI polish).

### L1. Dedicated Feynman mode route with structured Socratic flow (demo skeleton)

- **Confidence:** reasoned-choice (demo-skeleton system feature)
- **Primary justification:** Grounded in Fiorella & Mayer 2015 on generative learning [4.9] and Bisra et al. 2018 self-explanation meta-analysis (g = 0.55 across 64 studies) [2.6]. Strong effect sizes. Demonstrates system engagement with a cognitive mechanism beyond spaced retrieval practice. No empirical-claim gap closed — system-design contribution only.
- **Alternatives considered:** Integrate Feynman into regular chat (dilutes both; worse UX); full Feynman pipeline with cross-session gap tracking and scheduling (full-vision; out of scope).

**IN demo scope:**
- New route: `/feynman/:pdf_id`.
- Entry point: user picks a source passage (from their highlights) OR types a concept name.
- **Fixed 4-turn interaction**, not open-ended:
  - **Turn 1:** Claude prompts "Explain [concept] in your own words as if teaching someone unfamiliar with it."
  - **Turn 2:** Claude reads user's explanation, asks ONE targeted probing question ("You mentioned X — can you explain how that connects to Y?").
  - **Turn 3:** Claude asks a second probing question based on what's now been said.
  - **Turn 4:** Claude generates a structured end-of-session summary: "what you seemed to understand well / concepts that seemed shaky / 2–3 things to review."
- Dedicated system prompt (separate `prompt_version`). Key instructions: stay Socratic, don't lecture, ask one question per turn, end on a constructive gap summary.
- Session event logged (`session_type = 'feynman'`, with gap-summary text in an optional field).

**NOT in demo scope (documented as extension points):**
- Variable-length sessions (more or fewer turns based on user response quality) → fixed 4 turns is deliberate; extension.
- Cross-session gap tracking (a `feynman_gaps` table that accumulates concepts user struggled with) → big lift, extension.
- Integration with FSRS pipeline (gap concepts automatically become review items) → requires schema changes and Q&A generation from gaps; extension.
- Automatic Feynman session recommendations ("it's been a week since you reviewed X; try explaining it") → requires background jobs; extension.
- Cross-document Feynman sessions → Tier 3.
- Multi-modal Feynman (user draws a diagram to explain) → future work.

**Implementation note (demo-skeleton):**
```
Route: /feynman/:pdf_id
Components:
- FeynmanStart: concept picker (dropdown of user's highlights + free-text input).
- FeynmanSession: 4-turn chat interface with progress indicator (Turn 1 of 4).
- FeynmanSummary: end-of-session gap report.

Backend:
- POST /api/feynman/start → returns initial prompt from Claude.
- POST /api/feynman/turn → accepts user response, returns next Claude turn.
- POST /api/feynman/summary → accepts full conversation, returns structured gap summary.

System prompt version: 'feynman_v1' (stored in prompt_versions).
Instructions: "You are guiding a Feynman-style self-explanation session..."
Return format for summary turn: JSON with {understood_well: [...], shaky: [...], review_targets: [...]}.
```

**Cut line:** If not working 10 days before pilot, cut to a single-turn interaction: user types explanation, Claude returns a gap report. No back-and-forth. Still demos the concept. If critically behind, cut entirely and describe as "planned" in thesis. The prompt engineering is the highest-risk item — budget time for iteration.

**Cross-file:** `02_gap_analysis.md` system-building framing note.

### L2. Feynman sessions logged in session_events, not review_log

- **Confidence:** reasoned-choice
- **Primary justification:** Feynman is a breadth-demonstration feature, not graded practice. Same logic as K2.
- **Implementation note:** `session_type = 'feynman'`. `item_count` = number of concepts covered (usually 1 in demo scope). Optional `gap_summary` text field if schema allows, or just log to a separate `feynman_summaries` table if simpler.
- **Cross-file:** decision E2.

---

## Group J — What NOT to Build (for Thesis)

These features remain explicitly deferred. Not in Tier 1 for the thesis scope.

> **Note:** Three features that appeared in earlier drafts of this list — knowledge graph, visual intelligence, Feynman mode — have been promoted to Tier 1 system-design features (Groups G, K, L) per the system-building-thesis framing. Each has demo-quality specs, not full-vision specs. See `02_gap_analysis.md` framing note at end of Part 3 for the reasoning.

### J1. NOT in Tier 1: Pre-reading question priming

- **Confidence:** well-supported (scope decision)
- **Justification:** VISION.md Tier 2. Grounded in Ausubel [4.7] advance-organizer theory but orthogonal to the retention claim. It operates on encoding during initial reading, not on review; adding it confounds the comparison condition. Cheap to add post-thesis.

### J2. NOT in Tier 1: Cross-document synthesis

- **Confidence:** well-supported (scope decision)
- **Justification:** VISION.md Tier 3. Requires mature knowledge graph + multi-document indexing as infrastructure. Weak specific learning-science grounding beyond general transfer claims. Defer.

### J3. NOT in Tier 1: Retention dashboard (user-facing) — actually "Tier 1.5"

- **Confidence:** reasoned-choice (scope decision)
- **Justification:** VISION.md Tier 2. The `/api/research/export` endpoint (E3) handles the thesis's data needs. A user-facing dashboard is engagement infrastructure, not measurement infrastructure. Build if empirical-core + system-design features are solid 2 weeks before data collection; cut without regret otherwise.
- **Implementation note (if built):** Minimum viable version = 3 numbers on a home screen (due today, estimated retention % per PDF, study streak). No fancy charts required for demo-quality.

---

## Cross-Reference: Decisions Map → Files

| Decision | Built in | Justified by |
|---|---|---|
| A1 (FSRS) | `services/fsrs_service.py` | entries [1.1], [1.2], [1.3] |
| A2 (frozen weights) | config + `fsrs_service.py` | entries [1.7], [2.9] |
| A3 (Claude→FSRS rating) | `services/fsrs_service.py` + `review_service.py` | Gap 1; [4.12] |
| B1 (qa_pairs inline FSRS) | migration + `models/qa_pair.py` | decision to avoid needless join |
| B2 (review_log) | migration + `models/review_log.py` | Gap 4; [2.9]; thesis data requirement |
| B3 (source_chunk_ids) | `models/qa_pair.py` | [2.13] RAG-augmented grading |
| B4 (rubric/prompt versioning) | migrations + `services/grading_service.py` | [5b.1] pre-registration |
| C1 (analytical rubric) | system prompt in `services/grading_service.py` | [5c.1], [2.7] |
| C2 (JSON output) | grading prompt + response parser | [2.8] |
| C3 (self-reported confidence) | grading JSON schema | [2.9] |
| C4 (rubric freeze) | `rubric_versions.frozen_at` | [5b.1] |
| C5 (temp=0, model pin) | config | [2.9] methodology |
| C6 (RAG-grounded grading) | `grading_service.py` + chroma lookup | [2.13] |
| D1 (separate review screen) | frontend route | [2.2], [4.3] |
| D2 (confidence before grade) | review UI flow | Gap 4; [4.12] |
| D3 (always show feedback) | review UI result display | [2.3], [5d.4] |
| D4 (shared engine) | `/api/review/submit` | maintenance |
| D5 (typed recall only) | review UI input | [2.6], [5d.5] |
| E1 (latency) | frontend timer + `review_log.recall_latency_ms` | exploratory |
| E2 (session events) | migration + `models/session_event.py` | exploratory |
| E3 (export endpoint) | `routers/research.py` | thesis data workflow |
| E4 (IRR sampling) | `review_log.human_grading_sample` + sampling script | Gap 7 |
| F1 (Postgres source of truth) | backend API + Zustand load-from-API | VISION.md |
| F2 (selection bypasses RAG) | `chat_service.py` existing | backend.md |
| G1 (learning graph design) | `services/graph_service.py` + D3 frontend | Gap 8 (revised) |
| G2 (graph qualitative eval) | post-study survey items | Gap 8 (revised) |
| K1 (visual drag-select + multimodal chat) | canvas overlay + `/api/chat/visual` | [5a.2], Paivio dual-coding |
| K2 (visual in session_events) | `session_events.session_type='visual_chat'` | decision E2 |
| L1 (Feynman mode route + flow) | `/feynman/:pdf_id` + dedicated system prompt | [2.6], [4.9], [2.14] |
| L2 (Feynman in session_events) | `session_events.session_type='feynman'` | decision E2 |
| H1 (response template) | RESPONSE_TEMPLATE.md as system prompt | [2.14] |
| H2 (prompt caching) | `cache_control` flag | backend.md |
| I1 (pre-registration) | OSF external | [5b.1] best practice |
| I2 (IRB) | institution-specific | ethics |

---

## Summary for Claude Code

When making implementation decisions:

1. **Check this file first.** If the decision is listed, use the specified implementation.
2. **If the decision isn't listed but is in `02_gap_analysis.md` Part 6 decisions table,** cross-reference to find the governing citation.
3. **If the decision is genuinely new,** check it against the five-question filter in VISION.md and the gap list in `02_gap_analysis.md` Part 3. Propose the decision to the user with cited reasoning before implementing.
4. **If asked to deviate from a `well-supported` decision,** push back and cite. These are not casually revisable.
5. **Decisions labeled `reasoned-choice`** are revisable if concrete downstream evidence warrants. Discuss before changing.
6. **Decisions labeled `pending-evidence`** (currently none) are explicit placeholders — revisit after pilot data.

The decisions table at the end of this file is the at-a-glance reference. Everything else is expansion.
