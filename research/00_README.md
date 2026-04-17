# Research Folder — PDF Learning Retention App

This folder is the research foundation for a master's thesis on a document-grounded active-recall system. It exists for two purposes:

1. **For you (the human):** a structured reference that grounds every technical and methodological decision in literature. Reading the files in order gives you a defensible chapter-by-chapter structure for the thesis.
2. **For Claude Code (the terminal AI):** persistent context that loads into every coding session. `CLAUDE.md` tells Claude Code which file to consult for which task.

Total size: ~22,000 words across five files, curated not exhaustive.

---

## What's In This Folder

| File | Purpose | When to read |
|---|---|---|
| `00_README.md` | This file — overview and navigation | First, as orientation |
| `CLAUDE.md` | Routing directives for Claude Code | Loaded by Claude Code on every session |
| `01_literature_landscape.md` | 61-entry annotated bibliography across 4 literatures | When citing, drafting chapter 2, or checking an algorithm/design choice |
| `02_gap_analysis.md` | Contribution claim + 8 specific gaps + decisions table | When deciding whether a feature earns its place |
| `03_methodology_reference.md` | Study design, power analysis, rubric design, evaluation plan | When designing the RCT, writing the methodology chapter, or making measurement decisions |
| `04_build_decisions.md` | 32 technical decisions with implementation specs and cut lines | During implementation — the reference for "how should I build X?" |

---

## How to Use This Folder

### If you're drafting the thesis

Read in order: `02_gap_analysis.md` → `01_literature_landscape.md` → `03_methodology_reference.md` → `04_build_decisions.md`. This matches the logical order of thesis chapters (motivation → literature → methods → system). The contribution claim in `02_gap_analysis.md` Part 4 is the single sentence the thesis defends; everything else traces to it.

### If you're building the system

Drop this folder into your repo root next to `VISION.md`, `PROJECT.md`, `backend.md`, `frontend.md`, and `roadmap.md`. Start Claude Code with an instruction like:

> "Read `research/CLAUDE.md` first, then `VISION.md`, then proceed with the current task."

Claude Code will consult the appropriate research file(s) for each task type. You don't need to reference the research folder manually after that — the routing is in `CLAUDE.md`.

### If you're preparing for a defense or advisor meeting

The file you want is `02_gap_analysis.md` Part 5 — five anticipated reviewer objections with responses. Pair with `03_methodology_reference.md` Part 3 (power analysis) for the "how big a sample?" question that always comes up.

---

## The Core Thesis Claim (in one sentence)

> **A document-grounded active-recall system that replaces self-rated spaced-repetition signals with LLM-graded generative recall against source material — and the first evaluation of retention outcomes for such a system.**

This is narrower than `VISION.md`'s original framing on purpose. See `02_gap_analysis.md` Part 4 for the reasoning and the three sub-claims that support it.

---

## The Thesis Genre (important context)

This is a **system-building thesis with a narrow empirical arm**, following the genre established by Semantic Reader, LearnLM, Paper Plain, and ScholarPhi. In this genre:

- **The empirical core** (the retention RCT) is narrow and rigorous. Governed by `03_methodology_reference.md`.
- **The system description** (thesis Chapter 3) covers the full tool — including features that don't directly feed the empirical claim but contribute to coherent system design (learning graph, visual intelligence, Feynman mode).
- **Qualitative user feedback** on the system-design features supplements but does not substitute for the primary empirical analysis.

This framing admits features (learning graph, visual intelligence, Feynman mode) that a pure-empirical framing would defer. It also imposes **scope discipline**: those features are demo-skeleton quality, not full-vision implementations. See `04_build_decisions.md` "Scope Discipline" section for details.

---

## How This Folder Was Built

Five sequential steps, each producing one file:

1. **Literature landscape** — 16+ targeted web searches across four literatures, compiled into 61 annotated entries. Supplemented with 4 additional searches after gap review.
2. **Gap analysis & contribution statement** — pure synthesis from Step 1. No new searches.
3. **Methodology reference** — converted the contribution claim into a concrete study design, power analysis, and measurement plan.
4. **Build decisions** — expanded the decisions table from Step 2 into 32 build-ready technical specifications with citations and cut lines.
5. **Routing files** — this README plus `CLAUDE.md`.

The folder is a living document. Update it as you read priority papers, run the pilot, or revise scope. The YAML front-matter on each file tracks dependencies and last-updated timestamps.

---

## Priority Reading List (Before Starting Tier 1 Build)

From `01_literature_landscape.md`, read these 12 papers in order. Budget 3–4 focused days.

1. Shu et al. 2024 (KARL) — closest research neighbor
2. August et al. 2023 (Paper Plain) — strongest user-study design template
3. Butler & Roediger 2007 — best single-study analog for your evaluation
4. Greving, Lenhard & Richter 2023 — classroom power analysis template
5. Ferrer et al. 2026 — dictates your LLM confidence design
6. Yavuz et al. 2024 — LLM essay grading ICC benchmark
7. Grevisse 2024 — LLM ASAG in real educational contexts
8. Karpicke & Blunt 2011 — canonical retrieval-practice methodology
9. Jurenka et al. 2024 (LearnLM) — validates your response-template approach
10. LearnLM RCT Nov 2025 — study-design precedent
11. Adesope et al. 2017 — effect-size benchmark for power analysis
12. Lo et al. 2023 (Semantic Reader overview) — Chapter 2 positioning

Reading these before Tier 1 build will refine the schema and the rubric; reading them during build will cause rework.

---

## Status and Next Actions

**Folder status:** Complete (Steps 1–5 done).

**Next concrete action in priority order:**

1. Read the 12 priority papers (3–4 days).
2. Revise the schema proposal in `04_build_decisions.md` Group B if any paper suggests changes.
3. Begin Stage 1A implementation (persistence + FSRS as atomic unit, per `02_gap_analysis.md` Part 6).
4. Draft the pre-registration document for OSF submission in parallel with build.
5. Start IRB conversations with your institution early (often the timeline bottleneck).

---

## When to Revisit This Folder

- **Monthly** during thesis drafting: confirm the contribution claim in `02_gap_analysis.md` Part 4 still matches what the system actually does.
- **Before the pilot:** lock the rubric version per `04_build_decisions.md` C4 and document the freeze.
- **After the pilot:** update `03_methodology_reference.md` with any design changes.
- **Before thesis submission:** verify that every citation used in the thesis draft is reflected in `01_literature_landscape.md`.

---

## If Something in This Folder Feels Wrong

It might be. The folder reflects scoping decisions made with you over the course of the design conversation — some are well-supported by literature, others are judgment calls (labeled `reasoned-choice` in `04_build_decisions.md`). If a decision no longer feels right as you get closer to build:

1. Check the decision's confidence level.
2. If `well-supported`: push back hard; likely something in the reasoning is being missed.
3. If `reasoned-choice`: revisit with fresh eyes; the decision was defensible but not canonical.
4. If `pending-evidence` (currently none): the decision was always conditional on pilot data.

Decisions should evolve as evidence accumulates. Frozen decisions are for pre-registered analyses only.
