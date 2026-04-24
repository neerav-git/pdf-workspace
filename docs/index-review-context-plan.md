# Index and Review Context Plan

## Purpose

This plan addresses two linked problems:

1. Questions in the index and review flow can lose the context needed to make them answerable.
2. The full-page `Index` and `Review` tabs currently behave too much like expanded panels instead of deep-dive learning workspaces.

The goal is to improve the learning flow without breaking existing chats, index entries, review scheduling, or PDF navigation.

## Part 1. Stabilize the Data Contract Before Changing UI

### Objective

Introduce a shared normalized question-context model that all surfaces read from:

- right-side Index panel
- full-page Index tab
- review session
- future knowledge-graph and comparison features

### Additive data shape

Add or derive the following fields at the API/store layer first:

- `question_origin`
  - `highlight`
  - `chat`
  - `concept`
  - `manual`
  - `comparison`
- `question_scope`
  - `passage`
  - `section`
  - `document`
  - `session`
- `question_intent`
  - `background`
  - `definition`
  - `method`
  - `result`
  - `critique`
  - `comparison`
  - `takeaway`
- `context_required`
- `context_summary`
- `source_excerpt_short`
- `source_excerpt_full`
- `source_locator`
  - page
  - section title
  - highlight id
  - chat turn id
  - pdf id
- `context_status`
  - `grounded`
  - `reconstructed`
  - `weak`
- `review_prompt_mode`
  - `question_only`
  - `question_plus_context`
  - `question_plus_passage`
- `needs_disambiguation`

### Rules

- Highlight-grounded questions keep the original passage plus page/section metadata.
- Partial highlights get a reconstructed context window from nearby text.
- Chat-derived questions try to inherit a section/page/concept anchor if recoverable.
- If the question cannot be tightly grounded, it is still preserved, but marked `weak` or `needs_disambiguation`.
- Original user-authored wording remains visible even if a better study framing is later suggested.

### Breakage avoidance

- Do not replace legacy fields in `QAPair` or `HighlightEntry` on the first pass.
- Build an adapter/serializer layer that derives the normalized shape from current records.
- Keep review scheduling and FSRS fields unchanged.
- Keep all existing routes working while the new fields are adopted by the UI.

### Learning-flow gains

- Every question gets an explicit “what is this about?” frame.
- Review becomes fair retrieval practice rather than ambiguous guessing.
- The app becomes capable of organizing questions by intent and scope instead of only by where they were created.

## Part 2. Repair the Panel and Review Flow Using Shared Context Primitives

### Objective

Fix the current quirks in the HUD without redesigning the whole app first.

### Index panel fixes

- Every entry should show:
  - question
  - context summary
  - source label
  - page and section
  - review status
- Source preview should be expandable inline.
- Every anchored item should support `Jump to source`.
- Add visible provenance badges:
  - `From highlight`
  - `From chat`
  - `From concept`
  - `Needs context`
- Add better grouping inside the panel:
  - by section
  - by concept
  - by question intent
- Add `Open in Index tab` as a reliable deep link.

### Review fixes

- If `context_required`, show a context summary before the answer box.
- If `review_prompt_mode = question_plus_passage`, expose an expandable source passage before answer submission.
- `Reveal passage` should remain available, but should not be the first moment the learner discovers what the question refers to.
- Add `Open source in reader` from the review card.
- If a question is too ambiguous, mark it for repair instead of silently scheduling it as normal.

### Breakage avoidance

- Keep current panel actions and tab entry points.
- Do not change how cards are scheduled in this step.
- Do not rewrite or merge old Q&A records automatically.

### Learning-flow gains

- Removes unfair ambiguity from recall.
- Preserves desirable retrieval difficulty while keeping the question intelligible.
- Makes the panel useful as a lightweight study map, not only a storage drawer.

## Part 3. Turn Full-Page Index and Review Tabs Into Deep-Dive Learning Workspaces

### Objective

The full-page tabs should consume panel-produced material, but reorganize it for readability, orientation, and study flow.

### Full-page Index tab

Use the panel as the source of truth, but provide a better organization layer:

- session and paper navigation
- grouping modes:
  - by concept
  - by section
  - by question intent
  - by source type
  - by review state
- richer entry cards:
  - question
  - context summary
  - expandable passage
  - linked Q&A history
  - concepts and tags
  - review stats
  - provenance and ambiguity badges
- sorting presets:
  - foundational first
  - methods first
  - results first
  - most reviewed
  - least grounded

### Full-page Review tab

Build a real study workspace rather than a list of due cards:

- queue views:
  - due now
  - by concept
  - by section
  - context-rich only
  - needs repair
- per-card study layout:
  - question
  - context panel
  - answer area
  - related indexed items
  - why-this-matters note
- optional study trails:
  - continue within a concept cluster
  - continue within one section or paper argument

### Breakage avoidance

- Do not force the panel component to become the full-page workspace.
- Build separate full-page presentation components that reuse the same normalized data.
- Preserve current store contracts where possible and adapt shape centrally.

### Learning-flow gains

- Better information scent.
- Better chunking by concept and argument structure.
- Better retention by letting the learner review related items together when useful.

## Part 4. Backfill, Repair, and Verification for Legacy Material

### Objective

Preserve existing chats, saved questions, and review cards while improving their context quality.

### Backfill strategy

- For highlight-grounded entries:
  - keep original highlight text
  - reconstruct a larger passage window where possible
  - infer page and section anchors
- For chat-derived entries:
  - keep original question text
  - generate a concise context summary from the chat exchange plus current PDF/page/section state
  - attach a section or page anchor when recoverable
- For weak entries:
  - mark `context_status = weak`
  - keep them visible
  - surface them in a repair flow

### Repair tools

- `Repair context`
- `Reframe as study question`
- `Attach source`
- `Convert to note`

### Verification

- regression tests for:
  - expandable passage in index
  - chat-derived question with generated context
  - review card that shows fair context before answering
  - jump from panel to full-page Index tab
  - full-page grouping and filtering behavior
  - legacy items surviving migration
- live Playwright checks on real uploaded PDFs and existing chats

### Breakage avoidance

- No destructive migration.
- No silent question rewriting.
- No disappearance of weak legacy records.
- No changes to FSRS state or review logs unless explicitly intended.

### Learning-flow gains

- Weak questions stop degrading review quality.
- The index becomes a better precursor to a knowledge graph because every item has clearer provenance, scope, and intent.

## Next Step: File-by-File Implementation Blueprint

This blueprint is the immediate follow-on work after the four-part plan above.

### Low Risk

These files are mostly presentation or adapter surfaces. They are good first targets because they can improve clarity without destabilizing storage or scheduling.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/WorkspaceIndex.jsx`

- Expand the full-page Index tab into a true deep-dive workspace.
- Add grouping, filtering, and deep-link handling from the panel.
- Keep it powered by the same normalized entry shape as the panel.

Why low risk:
- Mostly additive UI composition.
- Existing panel behavior can remain intact while this page improves.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/WorkspaceReview.jsx`

- Expand the full-page Review tab into queue views and study organization modes.
- Add concept and section grouping views without changing FSRS logic.

Why low risk:
- Mostly organizational UI.
- Can initially wrap existing review actions instead of replacing them.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/WorkspacePages.css`

- Add layout and readability rules for the new Index and Review deep-dive pages.
- Make context blocks, provenance badges, and source panels easier to scan.

Why low risk:
- Styling-only changes.
- Straightforward regression testing with screenshots and Playwright.

#### `/Users/neeravch/Desktop/pdf-workspace/playwright-tests/workspace_index_review_part2.js`

- Extend tests for the full-page Index and Review tab organization.
- Add checks for new context-summary and source-expansion UI.

Why low risk:
- Verification only.
- Helps contain regression risk elsewhere.

### Medium Risk

These files connect the UI to current highlight/index/review data and will need careful additive changes.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/HighlightIndex.jsx`

- Add expandable source passage behavior.
- Add provenance badges, context summary, and ambiguity markers.
- Improve groupings and deep links to full-page Index.

Why medium risk:
- Shared by both the panel and the full-page Index experience.
- Easy to accidentally degrade the current HUD if refactored too aggressively.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/HighlightIndex.css`

- Support expanded source previews, question-type badges, and clearer per-entry hierarchy.

Why medium risk:
- The panel is dense and visually brittle.
- Small CSS changes can easily damage alignment and overflow behavior.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/ReviewSession.jsx`

- Add context summary and optional source-passage panel to the live review card.
- Show fair context before the learner answers when needed.
- Add `Open source in reader`.

Why medium risk:
- Directly affects active review flow.
- Must preserve the current answer submission and reveal semantics.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/store/index.js`

- Add normalized adapter logic for entries and Q&A cards.
- Preserve legacy state shape while exposing the richer context fields to components.
- Centralize provenance and context-derivation rules where possible.

Why medium risk:
- Shared state hub for index, review launch, and PDF interactions.
- A poor refactor here can cause broad UI regressions.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/PDFViewer.jsx`

- Improve the bridge from highlighted source to index/review:
  - more reliable `Open Index`
  - better preview text
  - better handoff into contextual review

Why medium risk:
- Tied to reader overlays and highlight popovers.
- Must not break existing PDF interaction flow.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/ChatPanel.jsx`

- Improve metadata when chat answers are logged into the index:
  - origin
  - recoverable context
  - anchor strength
- Preserve original question wording while allowing future study-safe framing.

Why medium risk:
- Chat logging feeds directly into the index and future review cards.
- Errors here can create bad legacy data quickly.

#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/api/highlights.js`
#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/api/review.js`
#### `/Users/neeravch/Desktop/pdf-workspace/frontend/src/api/chat.js`

- Add additive API support for normalized context fields.
- Keep existing consumers working.

Why medium risk:
- Small files, but API contract changes ripple across the app.

### Regression-Sensitive

These files touch persistence, serialization, and scheduling. They should be modified after the adapter shape and UI targets are clear.

#### `/Users/neeravch/Desktop/pdf-workspace/backend/app/models/highlight.py`

- Add new optional metadata fields or linked structures for normalized question context.
- Preserve current ORM relationships with `QAPair`.

Why regression-sensitive:
- Core persistence model for highlights and index entries.
- A bad change here can affect saved data, loading, and migrations.

#### `/Users/neeravch/Desktop/pdf-workspace/backend/app/models/review.py`

- Only touch if needed for safer review prompt metadata or context exposure.
- Avoid altering FSRS state fields unless absolutely necessary.

Why regression-sensitive:
- Review scheduling and history depend on this model.
- Easy to introduce irreversible data inconsistencies.

#### `/Users/neeravch/Desktop/pdf-workspace/backend/app/routers/highlights.py`

- Expose normalized index-entry payloads:
  - provenance
  - context summary
  - source excerpts
  - ambiguity state

Why regression-sensitive:
- Backend source of truth for highlight/index data.
- Existing index creation and patch flows depend on this route.

#### `/Users/neeravch/Desktop/pdf-workspace/backend/app/routers/review.py`

- Expose richer context payload for review cards.
- Preserve review submission behavior and current reveal handling.

Why regression-sensitive:
- Active learning flow depends on it.
- Breakage here affects live review immediately.

#### `/Users/neeravch/Desktop/pdf-workspace/backend/app/routers/chat.py`

- Improve how chat-derived Q&A entries are grounded and serialized.
- Keep current chat persistence and save-to-index behavior intact.

Why regression-sensitive:
- Chat persistence and logging have already been a fragile area.
- Must not reintroduce disappearing or untraceable logged questions.

#### `/Users/neeravch/Desktop/pdf-workspace/backend/app/services/chat_service.py`

- If context summaries or question intent are derived server-side, this is a likely insertion point.
- Keep derivation advisory and additive.

Why regression-sensitive:
- This service shapes a large amount of user-visible content.
- A poor change can degrade synthesis, save-candidate quality, or question framing.

#### `/Users/neeravch/Desktop/pdf-workspace/playwright-tests/part6_chat_save_and_synthesis.js`
#### `/Users/neeravch/Desktop/pdf-workspace/playwright-tests/part7_chat_inline_log.js`
#### `/Users/neeravch/Desktop/pdf-workspace/playwright-tests/test_highlight_popover.js`

- Extend these tests to cover:
  - chat-derived context
  - partial-highlight reconstruction
  - source passage expansion
  - review fairness for ambiguous questions

Why regression-sensitive:
- These tests should lock down the exact flows most likely to break while implementing the plan.

## Recommended Execution Order

1. Add normalized adapter shape in backend serialization and frontend store, keeping all fields optional.
2. Update `HighlightIndex` and `ReviewSession` to consume the new context fields without changing scheduling.
3. Upgrade full-page `WorkspaceIndex` and `WorkspaceReview` into deep-dive views.
4. Add legacy backfill and repair affordances.
5. Extend Playwright coverage across chat, highlight, index, and review flows.

## Non-Negotiables

- Existing chats must remain visible.
- Existing index entries must remain reachable.
- Existing review scheduling and logs must remain intact.
- No silent deletion or silent reframing of user-authored questions.
- Every review card must be traceable to source passage, reconstructed context, or an explicit weak-context label.
