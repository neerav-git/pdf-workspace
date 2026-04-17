# PROJECT NORTH STAR — PDF Learning Retention Workspace

> Before implementing any feature, measure it against this document.
> If a proposed feature does not serve the core thesis, deprioritize or cut it.

**Guiding principle:** lean and impactful. Every feature must be:
- Minimal in implementation complexity
- Maximum in learning value
- Grounded in peer-reviewed learning science
- Something existing apps (Anki, Readwise, Elicit, Google's PDF extension) do not do in combination

---

## THE CORE PROBLEM

Existing tools solve the wrong problem. PDF readers help you read. Annotation tools help you capture. LLM chat tools help you query. None close the loop on whether the user actually retained anything.

Users highlight a lot, feel productive, and remember very little. This is the **illusion of learning** — passive engagement mistaken for encoding.

This app's job is to break that illusion.

```
Strong capture side  → highlighting, Q&A, notes, chat          ← mostly built
Missing retrieval side → review loop, recall testing, scheduling ← not yet built
```

Without the retrieval side, this is just a better annotation tool. With it, it becomes something genuinely different.

---

## THE SCIENTIFIC FOUNDATION

Every feature must map to at least one of these.

### 1. The Testing Effect — Roediger & Karpicke (2006)
Retrieving information from memory is dramatically more effective than re-reading. A student who reads once and recalls outperforms one who re-reads four times.
> **Application:** Quiz Me and any review feature must require the user to generate an answer from memory BEFORE seeing the correct one. Multiple choice is weak. Typed generative recall is strong.

### 2. Spaced Repetition — Ebbinghaus (1885), FSRS algorithm (Ye et al., 2022)
Memory decays predictably. Reviewing just before forgetting produces dramatically stronger retention than reviewing randomly or immediately. The optimal interval is learnable from the user's own performance data.
> **Application:** every Q&A pair saved to the index must enter a review queue. FSRS (open source, Python-native, more accurate than SM-2/Anki) schedules the next review based on rated recall quality.
> `pip install fsrs`

### 3. Elaborative Interrogation — Pressley et al.
"Why" and "how" questions force the learner to connect new knowledge to existing schema. "What does this mean?" is weak encoding. "Why does the author claim this? What would have to be true for this to be wrong?" is strong encoding.
> **Application:** chat system prompt and hover menu actions should be reframed toward elaborative questions, not summaries. Summaries are passive. Explanations that force connection are active.

### 4. Generative Learning — Fiorella & Mayer (2015)
Explaining something in your own words, mapping concepts, or teaching produces far stronger encoding than re-reading.
> **Application:** Feynman Mode — a dedicated session where Claude asks the user to explain a concept from memory, plays devil's advocate, and produces a "gaps in your understanding" report. No existing PDF app does this in a document-grounded way.

---

## CURRENT STATE — HONEST ASSESSMENT

~10% of the full vision is realized. What exists is a strong reading assistant. It is not yet a learning retention app.

### Built and going in the right direction
- ✓ Highlight + Q&A pairs saved to index — proto-flashcard material
- ✓ Starred Q&As — weak priority signal, not yet scheduled
- ✓ Quiz Me button — underbuilt (does not yet do generative recall)
- ✓ Source page badges — context-dependent memory cue
- ✓ Voice input — multimodal encoding, minor but valid
- ✓ Table of contents, notes, error boundary — reading UX, not learning UX

### Critically missing
- ✗ Review session UI — THE most important missing feature
- ✗ FSRS scheduling on saved Q&A pairs — without this, index is a graveyard
- ✗ Generative recall evaluation by Claude — Quiz Me must grade typed answers
- ✗ Confidence calibration — user rates confidence before seeing grade
- ✗ Retention dashboard — forgetting curve per document
- ✗ Feynman Mode — elaboration + generative learning
- ✗ Knowledge graph — schema building across documents
- ✗ Pre-reading question priming — questions before first open of PDF
- ✗ Highlight index persistence — wiped on refresh (known, most urgent fix)

---

## FEATURE PRIORITY — LEAN ORDERING

Do these in order. Do not skip ahead. Abandon or simplify rather than half-build.

### TIER 1 — Must Ship (makes the scientific claim real)

**1. Fix highlight index persistence to PostgreSQL**
Why: everything else is pointless if saves are lost on refresh.

**2. FSRS memory item system**
Why: the single architectural addition that transforms the product.
How: `memory_items` table joins `qa_pairs`, stores `next_review`, `interval`, `stability`, `difficulty`, `last_rating`, `review_history` (JSONB).

**3. Review session UI** (separate screen from PDF viewer)
Flow: show highlight context → user types recall from memory → user rates own confidence (1–5) → Claude evaluates typed answer (1–5) → FSRS schedules next review → show result.
Why separate screen: distraction-free recall is the point.

**4. Upgrade Quiz Me to generative recall**
Current: generates questions, shows answers.
Required: hides answers, accepts typed response, Claude grades it, result feeds FSRS scheduling.

### TIER 2 — High Value, Achievable

**5. Retention dashboard as home screen**
Show: items due for review today, estimated retention % per document, study streak, concepts at risk of forgetting.

**6. Pre-reading question priming**
When a PDF is opened for the first time: generate 5 questions this paper will answer, show them before page 1 loads.
Why: ~30 lines of code, strong empirical backing, zero existing apps do it.

**7. Feynman Mode**
Dedicated chat mode: user explains concept from memory, Claude challenges and probes, final output is a gaps report.

### TIER 3 — Differentiating, After Tier 2

**8. Knowledge graph** — entity extraction → D3 force graph → cross-document concept linking

**9. Visual intelligence** — canvas drag-select over diagrams/equations → Claude vision API

**10. Cross-document synthesis** — "Based on Papers A, B, C — what are the main disagreements?"

### Explicitly Out of Scope (for now)
- Progressive summarization
- Footnotes/resources system
- Sharing or collaboration
- Mobile app
- Any feature that improves reading comfort without improving recall

---

## THE THESIS

> "A document-grounded active recall system implementing FSRS-based spaced repetition and generative evaluation to improve long-term retention of academic literature."

### Novel contribution vs existing tools
| Tool | What we do differently |
|---|---|
| Anki | Document-grounded, no manual card creation, RAG context |
| Readwise | Active recall, not passive re-reading; scheduling, not curation |
| Elicit | Retention focus, not research assistant |
| Notability | Learning loop, not annotation |
| ChatPDF | Structured memory system, not one-shot Q&A |

### Citable foundations
- Roediger & Karpicke (2006) — testing effect
- Bjork (1994) — desirable difficulties
- Fiorella & Mayer (2015) — generative learning
- Ye et al. (2022) — FSRS algorithm
- Ebbinghaus (1885) — forgetting curve

---

## FILTER FOR EVERY FEATURE DECISION

Before implementing anything, ask:
1. Which learning science principle does this serve?
2. Is this capture-side or retrieval-side? (We need more retrieval.)
3. Does this exist in Anki, Readwise, or Elicit? If yes, what makes our version document-grounded and meaningfully different?
4. Can this be built in under a day and still be impactful? If not, can it be simplified until it can?
5. Does this add value or add complexity? Complexity is expensive. Value must outweigh it clearly.

If a feature fails questions 1 and 2 → deprioritize.
If it fails question 4 and cannot be simplified → defer.
