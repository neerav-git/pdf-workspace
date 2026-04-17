---
file: CLAUDE.md
purpose: Routing directives for Claude Code. Read this first before any task in this project. Tells Claude Code which file(s) to consult for which type of task.
last_updated: 2026-04-16
read_order: [VISION.md, CLAUDE.md (this file), task-specific files per routing below]
status: step_5_deliverable
---

# Directives for Claude Code

## 0. How You Should Use This File

You are Claude Code, working on a PDF learning retention application that is also a master's thesis project. This folder (`research/`) contains research-grounded guidance on every significant design and methodological decision.

**Do not try to load all files at once.** Read this file first. It tells you which file(s) to consult for the current task. Then read those specific files.

**This file supplements, does not replace, `VISION.md`.** `VISION.md` is the product north star. This folder operationalizes it with literature grounding and empirical defensibility.

**Priority of sources when they conflict:**
1. The user's explicit instruction in the current session
2. `VISION.md` (product vision, five-question filter)
3. `research/04_build_decisions.md` (technical decisions with citations)
4. `research/02_gap_analysis.md` (contribution scope)
5. `research/03_methodology_reference.md` (evaluation plan)
6. `research/01_literature_landscape.md` (bibliographic ground)
7. `PROJECT.md`, `backend.md`, `frontend.md`, `roadmap.md` (existing project docs)

If the user's instruction conflicts with a decision in `research/04_build_decisions.md` marked `well-supported`, push back and cite the reasoning. Do not silently override well-supported decisions.

---

## 1. Task Routing

Match the user's current task to one of these categories. Read the listed files before proceeding. Do not skip this step.

### 1.1 Schema changes, migrations, data model work

**Read:** `04_build_decisions.md` Groups A, B, E. Specifically decisions A3, B1, B2, B3, B4, E2, E4.

**Key rules:**
- FSRS state lives on `qa_pairs` (inline), not in a separate `memory_items` table. See B1.
- `review_log` is thesis-critical — every field documented in B2 must be present. Do not omit fields to simplify.
- Rubric versions, prompt versions, and model strings MUST be logged on every grading event (B2, B4, C5).
- `session_events` is the home for engagement-only features (visual intelligence, Feynman) — do not route these through `review_log` (K2, L2).

### 1.2 FSRS, scheduling, rating flow

**Read:** `04_build_decisions.md` Group A. Specifically A1, A2, A3.

**Key rules:**
- FSRS version is frozen for the pre-registered study period. Do not enable per-user parameter optimization mid-study (A2).
- The FSRS rating input comes from Claude's grade, not user self-rating. Mapping: Claude 1→Again, 2→Hard, 3→Good, 4–5→Easy. Store both Claude's raw score AND the derived FSRS rating (A3).
- This substitution — Claude-grade-as-rating-signal — is the thesis's central contribution. Do not casually abstract it away.

### 1.3 Grading prompt, rubric, LLM grading pipeline

**Read:** `04_build_decisions.md` Group C (all 6 decisions). `03_methodology_reference.md` Part 7. `01_literature_landscape.md` entries 2.7, 2.9, 5c.1, 2.13.

**Key rules:**
- Analytical rubric with three dimensions (core_claim, supporting_detail, faithfulness), NOT holistic (C1).
- Structured JSON output per schema in `03_methodology_reference.md` Part 7.3 (C2).
- Include Claude's self-reported confidence field — this is non-negotiable per Ferrer et al. 2026 (C3).
- `temperature=0` and pinned model string. Log `model_version` on every call (C5).
- RAG-grounded grading: pass source chunks to Claude along with the question and recall text (C6). Do NOT grade using Claude's priors only.
- Rubric is versioned via `rubric_versions` table with a `frozen_at` timestamp (B4, C4). Do not change a frozen rubric; create a new version.

### 1.4 Review session UI, Quiz Me UI

**Read:** `04_build_decisions.md` Group D (all 5 decisions). `03_methodology_reference.md` Part 4.2.

**Key rules:**
- Review session is a DEDICATED screen, not a panel in the PDF viewer (D1).
- Confidence rating is submitted WITH recall text in a single action, BEFORE the grade is revealed. This is methodologically load-bearing — if the user sees any feedback before rating confidence, the calibration measurement is invalidated (D2).
- After submission, always show: grade, per-dimension scores, feedback, correct answer, source passage (D3).
- Quiz Me and Review Session share the same grading engine — they differ only in card selection query (D4).
- Typed recall only. No multiple choice (D5).

### 1.5 Highlight-to-Q&A generation, persistence of study data

**Read:** `04_build_decisions.md` Groups B, F. `02_gap_analysis.md` Part 6 (decisions table).

**Key rules:**
- Postgres is the single source of truth. Frontend Zustand is a cache that reloads on PDF select and tab refocus (F1).
- Source chunk IDs are stored on `qa_pairs`, not passage text (B3) — resolve at review time via ChromaDB.
- Chat history stays frontend-owned and ephemeral (B5, F2). Do not add server-side chat persistence.
- Selection text in chat bypasses RAG (F2 — existing decision, kept).

### 1.6 Learning graph / knowledge graph

**Read:** `04_build_decisions.md` Group G (both decisions) AND the "Scope Discipline" section at the top of `04_build_decisions.md`. `02_gap_analysis.md` Gap 8.

**Key rules:**
- This is a DEMO-SKELETON feature. Budget: 5–7 days total. Do not expand scope (G1).
- Nodes = one per Q&A pair (not clusters — clustering is an extension point).
- Edges = cosine similarity over source chunks, capped at top-K per node.
- Node color on FSRS stability. Node size on review count.
- IN scope: static render, click-to-open-side-panel, link back to review.
- NOT in scope: clustering, cross-PDF merging, real-time updates, filters, export.
- Qualitative evaluation only — 3–4 Likert items in post-study survey (G2).
- If the primary empirical-core Tier 1 features are not yet solid, STOP building the graph and finish those first.

### 1.7 Visual intelligence / multimodal PDF selection

**Read:** `04_build_decisions.md` Group K (both decisions) AND the "Scope Discipline" section. `02_gap_analysis.md` framing note at end of Part 3.

**Key rules:**
- This is a DEMO-SKELETON feature. Budget: 4–6 days total. Do not expand scope (K1).
- ONE button on selection: "Ask about this." No multi-button toolbar.
- Single multimodal Claude call per selection. No saving selections as reviewable Q&A cards (that requires schema changes and is an extension point).
- 2x device pixel ratio when capturing the canvas region — 1x drops detail and kills response quality.
- Logged in `session_events` with `session_type='visual_chat'`. NOT in `review_log` (K2).
- **Verify multimodal API works on your chosen Claude model EARLY in the build.** This is the highest-risk demo-skeleton feature.

### 1.8 Feynman mode

**Read:** `04_build_decisions.md` Group L (both decisions) AND the "Scope Discipline" section.

**Key rules:**
- This is a DEMO-SKELETON feature. Budget: 3–5 days total. Do not expand scope (L1).
- FIXED 4-turn structure: prompt → probe 1 → probe 2 → gap summary. Do not make it variable-length.
- Dedicated system prompt version (stored in `prompt_versions`, referenced by `system_prompt_version`).
- NO cross-session gap tracking. NO automatic Feynman recommendations. NO integration with FSRS pipeline. All extension points.
- Logged in `session_events` with `session_type='feynman'`. NOT in `review_log` (L2).
- Prompt engineering is the main time sink — budget accordingly. Iterate the 4-turn prompts until the flow feels natural before adding polish elsewhere.

### 1.9 Evaluation study, user study, post-study survey

**Read:** `03_methodology_reference.md` (all parts). `02_gap_analysis.md` Part 5 (reviewer objections).

**Key rules:**
- Primary design: between-subjects RCT, active control (re-reading highlights, time-matched). See `03_methodology_reference.md` Part 2.
- Target N=60 per condition (120 total). Power analysis in Part 3.
- Primary outcome: delayed recall at 2 weeks, graded by HUMAN blinded to condition — NOT by Claude. This is the single most consequential methodological rule (Part 4.1).
- Claude grades during the intervention (during tool use). Claude does NOT grade the outcome test. Conflating these invalidates the primary analysis.
- IRR sub-study: ~100 responses human-graded and Claude-graded; compute ICC; target ≥0.75 per Koo & Li 2016 (Part 4.3, E4).
- Post-study survey includes Likert items on the system-design features (learning graph, visual intelligence, Feynman mode) per G2, and survey items K-L referenced in `02_gap_analysis.md` Part 7.

### 1.10 Response template, chat system prompt, RAG chat

**Read:** `04_build_decisions.md` Group H (both decisions). Existing `RESPONSE_TEMPLATE.md` file.

**Key rules:**
- Keep the layered-disclosure response template. It's validated by LearnLM (Jurenka et al. 2024 [2.14]) — pedagogical instruction-following is the right approach for learning-oriented LLM use (H1).
- For GRADING calls specifically, use a different system prompt focused on the grading rubric, not the response template. Do not conflate these two prompts.
- Prompt caching (`cache_control: ephemeral`) on the long system block (H2). No methodological concerns — it doesn't change model behavior.
- System prompt version (including response template version) is logged on every chat request (B4).

### 1.11 Thesis writing, chapter drafting

**Read:** `02_gap_analysis.md` Parts 1, 4, 5 (context, contribution claim, anticipated objections). `01_literature_landscape.md` as needed for citations.

**Key rules:**
- The one-sentence contribution claim is in `02_gap_analysis.md` Part 4. Every chapter traces to it.
- Thesis genre: system-building with narrow empirical arm (see `00_README.md`).
- Chapter 3 describes the FULL system including demo-skeleton features (learning graph, visual intelligence, Feynman mode). Chapter 4/5 describes only the empirical-core features as the evaluated intervention. Do not conflate these chapters.
- Every citation used in the thesis must be in `01_literature_landscape.md`. If you need a citation not yet in that file, add it with a new entry number before writing the thesis paragraph that uses it.

### 1.12 Pre-registration, IRB, research compliance

**Read:** `03_methodology_reference.md` Part 6 (pre-registration), Part 9 (timeline). `04_build_decisions.md` Group I.

**Key rules:**
- Pre-registration on OSF is recommended, not required. Distinguishes confirmatory from exploratory analyses in the thesis (I1).
- IRB approval is a hard blocker on human-subjects data collection. Start the application 6+ weeks before planned data collection (I2).
- Do NOT start data collection without IRB approval, even for pilot.

### 1.13 Questions about the project's contribution, what's novel, what to cut

**Read:** `02_gap_analysis.md` (all parts). Specifically Parts 3 (gap list), 4 (contribution claim), 7 (feature priorities).

**Key rules:**
- 8 documented gaps. A feature that doesn't close a gap is not thesis-critical. See Part 3.
- Contribution claim is in Part 4. It is narrower than `VISION.md`'s original framing ON PURPOSE — it is what's defensible given the literature.
- Tier 1 has two sub-tiers: empirical-core (full production quality) and system-design (demo-skeleton quality). Priority during build: empirical-core first.

---

## 2. The Cardinal Rules

Five rules that override everything else. Violating any of them invalidates the thesis or introduces a bug Claude Code cannot fix later:

### Rule 1: Claude does NOT grade the outcome test

During the intervention (tool use), Claude grades user recall → that feeds FSRS scheduling. This is the feature.

During the outcome test (delayed post-test administered to measure retention), a HUMAN blind to condition grades the responses. Not Claude.

If Claude grades both, the thesis's primary empirical claim is circular and a reviewer will (correctly) reject it. This rule is non-negotiable.

See `03_methodology_reference.md` Part 4.1. See also the user explanation in the design conversation.

### Rule 2: Confidence rating before grade reveal, same action

The user's confidence (pre-grade self-rating) and recall text are submitted together in a SINGLE API call. The grade is not shown until after submission. If the user sees any grading feedback before rating their own confidence, the calibration measurement is contaminated.

See `04_build_decisions.md` D2.

### Rule 3: Freeze rubrics, prompts, and model strings for the pre-registered study

Once the pilot ends and main data collection begins, the rubric, grading system prompt, and Claude model version are FROZEN. Any change after the freeze requires documentation as a protocol deviation.

If Anthropic deprecates the pinned Claude model mid-study, document the forced switch.

See `04_build_decisions.md` C4, C5. See `03_methodology_reference.md` Part 6.

### Rule 4: Empirical-core Tier 1 features come before system-design Tier 1 features

Build order: Persistence + FSRS + review session UI + generative Quiz Me + instrumentation (`review_log`, export endpoint, IRR sampling). THEN: learning graph, visual intelligence, Feynman mode. THEN: retention dashboard if time permits. THEN: polish.

If you're working on learning graph polish while the review session UI is unfinished, stop and fix priority.

See `04_build_decisions.md` "Scope Discipline" section.

### Rule 5: Demo-skeleton features stay demo-skeleton

Groups G, K, L have explicit "IN scope / NOT in scope" lists. When the user asks for "just one more feature" on any of these, check the NOT-in-scope list. If the request is there, push back. Extension points are for future work, not for thesis-timeline scope creep.

See `04_build_decisions.md` scope discipline section and each of G1, K1, L1.

---

## 3. When You're Unsure

If you don't know which file to consult for a task:

1. Start with `04_build_decisions.md` — the decisions table at the bottom maps decisions to code locations and citations.
2. If the decision isn't listed, check `02_gap_analysis.md` Part 6 decisions table.
3. If still unclear, ask the user directly: "This touches X, which isn't in my routing. Can you clarify the intent before I proceed?"

Do NOT guess when stakes are high (schema changes, grading pipeline, study design). Ask.

---

## 4. What Changed vs. Your Existing Instructions

This folder supplements your existing `VISION.md`, `PROJECT.md`, `backend.md`, `frontend.md`, `roadmap.md`, and `RESPONSE_TEMPLATE.md`. It does not replace them.

Specific interactions:

- **VISION.md's five-question filter** is still the first pass. This folder operationalizes each question with citations.
- **roadmap.md's tier priorities** are refined in `02_gap_analysis.md` Part 7 — most of roadmap.md is still accurate, but the feature priority ordering has been adjusted based on gap analysis (learning graph, visual intelligence, and Feynman mode are now Tier 1 demo-skeletons; retention dashboard is Tier 1.5; a few items moved to Tier 2).
- **backend.md's design decisions** (prompt caching, selection-text bypass, chat ephemeralness) are preserved. See `04_build_decisions.md` H2, F2, B5.
- **RESPONSE_TEMPLATE.md** is kept as the chat system prompt. See H1. It is NOT used for grading calls — those have their own system prompt per C1.

If you notice an inconsistency between the research folder and existing project docs, flag it to the user. Do not silently resolve it.

---

## 5. Status of This Folder

Current version: Complete through Step 5.

The folder should be updated when:
- A priority paper is read and changes a decision — revise `04_build_decisions.md` with a new `last_updated` timestamp.
- The pilot produces results that change rubric or grading approach — revise `03_methodology_reference.md` Part 7 and `04_build_decisions.md` Group C.
- A new feature is added or removed — revise `02_gap_analysis.md` Part 7 and `04_build_decisions.md` accordingly.

Do not update the folder opportunistically. Update it when a concrete change in the plan requires it.

---

## 6. Summary

Your job when starting any task in this project:

1. **Read this file** (you're doing that now).
2. **Identify the task category** (schema? grading? UI? study design? writing?).
3. **Read the routed file(s)** for that category from Section 1 above.
4. **Check against the Cardinal Rules** in Section 2.
5. **Proceed with confidence** — or ask if still unclear.

The goal is for every technical and methodological decision you make to be traceable to either a literature citation or an explicit user choice. That traceability is what makes this a thesis, not just a product.
