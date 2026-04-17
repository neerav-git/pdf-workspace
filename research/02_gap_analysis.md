---
file: 02_gap_analysis.md
purpose: Synthesize the literature landscape into an explicit, defensible gap statement and contribution claim. This is the file that answers "is this feature a genuine contribution or is it duplicative?" for every design decision going forward.
last_updated: 2026-04-16
depends_on: [01_literature_landscape.md]
referenced_by: [03_methodology_reference.md, 04_build_decisions.md, CLAUDE.md]
status: step_2_deliverable
---

# Gap Analysis & Contribution Statement

> This file is the routing hub for feature decisions. Before adding or keeping any feature in the Tier 1 build, check that it closes a gap identified here. If it doesn't, it belongs in Tier 2 or 3, or should be cut. The five-question filter in VISION.md is operationalized in this file.

---

## Part 1 — The Research Landscape, Condensed

Step 1 surveyed 61 entries across four literatures. Four synthesis points emerge:

**The testing effect and spacing effect are settled science.** Three meta-analyses converge on moderate-to-large effect sizes (Hedges' g = 0.50–0.67) for practice testing over restudy [entries 2.1, 2.5, 4.2]. Spacing produces additional retention benefits when interval scales to target retention horizon [1.8, 1.9]. These findings are not controversial and not the thesis's contribution. They are the thesis's *foundation*.

**LLM grading has crossed a viability threshold.** Studies from 2023–2026 report moderate-to-excellent agreement with human graders, with ICC reaching 0.97 for fine-tuned models on analytical rubrics [5c.1]. Calibration methods (self-reported confidence) are now understood [2.9]. Rubric quality is load-bearing [2.7]. LLM-graded short-answer assessment is no longer a speculative claim — it is an active subfield.

**Pedagogically-tuned LLMs are an active Google research program.** LearnLM (Jurenka et al. 2024) explicitly takes the "pedagogy via system-prompt instructions" stance that your RESPONSE_TEMPLATE.md takes. Its N=165 classroom RCT shows supervised LearnLM-tutoring matched human tutoring on all measured learning outcomes [2.14, 2.15]. This validates your approach but also means "pedagogically-structured LLM responses" is no longer novel as a general claim.

**Document-grounded AI reading has mature HCI prior art.** The Semantic Reader project (ScholarPhi, Paper Plain, Scim, CiteSee, etc.) is the peer-reviewed research program behind commercial tools like ChatPDF [5a.1, 5a.2, 5a.3]. They have extensively studied how to make scholarly papers *more readable*. **None of them study retention.** All their dependent measures are in-session comprehension or usability.

---

## Part 2 — The Gap Grid

Map every closely-related research stream against what this thesis claims is unaddressed:

| Stream | What it does | What it doesn't do |
|---|---|---|
| FSRS / KARL (spaced-repetition scheduling) | Optimize review timing for known memory items | Don't tie scheduling to document-grounded user-selected content; don't use LLM generative grading as the rating signal |
| LLM ASAG literature | Grade short answers to instructor-authored questions | Don't integrate with spaced repetition; don't operate on user-generated Q&A from reading |
| LearnLM / pedagogical LLMs | Generate well-scaffolded tutoring responses | Don't maintain a retention loop; don't test the user on what they read |
| Semantic Reader project | Make scholarly papers easier to *read* | Don't measure whether reading the paper produced retention |
| NotebookLM / ChatPDF / Elicit | Commercial document Q&A and summary | No FSRS; no typed-recall grading; no retention measurement; no confidence calibration |
| Anki / Readwise | Deployed SRS infrastructure | Manual card creation (Anki) or passive re-reading of highlights (Readwise); not document-grounded; no LLM grading |

No cell in this grid is empty if read individually — every piece exists somewhere. The contribution is the **specific combination** in the intersection.

---

## Part 3 — Specific Documented Gaps (8 identified)

Each gap is supported by citations from `01_literature_landscape.md`. Each is labeled:

- **[OWNED]** — this thesis directly addresses the gap
- **[ACKNOWLEDGED]** — thesis notes the gap but does not fully address it (future work)
- **[OUT OF SCOPE]** — gap exists but is not the thesis's concern

### Gap 1 — No deployed system uses LLM-graded generative recall as the rating signal for FSRS scheduling. **[OWNED]**

**Evidence:** FSRS and its predecessors (Ye et al. 2022 [1.1], SSP-MMC-Plus [1.2], MEMORIZE [1.5], HLR [1.4], KARL [1.6]) all use binary or ordinal user-reported ratings (e.g., Again / Hard / Good / Easy) as the input to the scheduler. The user self-rates recall. None of these systems evaluate a typed answer against source material and convert that evaluation into a rating. LLM-as-grader work (Grevisse 2024 [2.7], Yavuz 2024 [5c.1], GradeOpt [2.8]) exists independently and is *not* integrated with scheduling. KARL [1.6] is the closest: it uses BERT embeddings of card content for *scheduling prediction*, but still takes binary recall outcomes (remembered / forgot) as the ground-truth signal. The user still self-rates.

**Why this matters:** Self-rated recall has known calibration problems (Bjork, Dunlosky & Kornell 2013 [4.12]). Users systematically overestimate recall fluency. Replacing self-rating with an LLM-evaluated rating against source material *could* produce more accurate scheduling — this is an empirical claim the thesis can test.

**Contribution claim:** This thesis is the first to replace self-rated SRS rating with LLM-graded generative recall and measure downstream retention effects.

### Gap 2 — No peer-reviewed scholarly-reading tool measures retention as an outcome. **[OWNED]**

**Evidence:** The Semantic Reader program [5a.1] has ten major prototypes, all evaluated for comprehension, readability, or usability. **Zero measure 1-week, 1-month, or longer retention.** Paper Plain [5a.3] explicitly evaluates "ease of reading without loss of comprehension" — a within-session measure. ScholarPhi [5a.2] measures task performance and subjective preference. This is not an oversight; it reflects the subfield's focus on reading-time experience. The retention angle is genuinely unoccupied.

**Why this matters:** Reading a paper and retaining a paper are different outcomes. The distinction maps directly onto Soderstrom & Bjork's (2015 [1.7]) learning-vs-performance split. A tool that optimizes in-session reading does not necessarily produce learning. The thesis's core claim — that retention is the important dependent measure for academic reading — is defensible because *nobody in the scholarly-reading HCI literature has tested it*.

**Contribution claim:** This thesis is the first to evaluate a document-grounded AI reading tool on delayed retention of academic material.

### Gap 3 — No existing tool integrates document-grounded highlighting, LLM-generated Q&A, and FSRS scheduling into one loop. **[OWNED]**

**Evidence:** NotebookLM [3.1] auto-generates flashcards from documents but not from user highlights, uses proprietary scheduling (not published, not FSRS), and does not evaluate typed recall. Readwise resurfaces highlights for re-reading (passive) rather than testing. Anki [3.5] uses FSRS but requires manual card creation. KARL [1.6] uses content for scheduling but operates on trivia questions, not academic documents. Paper Plain [5a.3] generates key questions but for in-session guidance, not spaced review. No single published tool has the full capture→schedule→test→grade→reschedule loop grounded in user-highlighted academic content.

**Why this matters:** The thesis's architectural contribution is the **pipeline**, not any individual component. Each component has prior art; the combined pipeline does not.

**Contribution claim:** This thesis implements and evaluates the first document-grounded end-to-end active-recall system in an academic-reading context.

### Gap 4 — Confidence calibration is treated as a research finding, not as a deployed feature. **[OWNED]**

**Evidence:** Bjork, Dunlosky & Kornell 2013 [4.12] shows learners are systematically miscalibrated; fluency breeds overconfidence. Ferrer et al. 2026 [2.9] shows LLM self-reported confidence is the best-calibrated signal for grading. Neither line of research has been integrated into a deployed learning tool. No existing SRS software captures user-reported confidence *before* the user sees the correct answer, then tracks calibration improvement over time.

**Why this matters:** Pre-grade confidence rating costs almost nothing to implement (one extra field in `review_log`). Its measurement yields a publishable secondary outcome ("Did users become better calibrated over the study period?") that is independent of the primary retention outcome. This is cheap-to-implement, valuable-to-thesis instrumentation.

**Contribution claim:** This thesis measures confidence calibration as a secondary outcome of document-grounded spaced-repetition practice — a measure that has not been reported for any deployed SRS tool.

### Gap 5 — Most published retention RCTs use single-session materials; longitudinal real-use retention studies are rare. **[ACKNOWLEDGED]**

**Evidence:** Most testing-effect studies (Karpicke & Blunt 2011 [2.2], Butler & Roediger 2007 [5d.5]) use 1-week to 1-month delayed tests on material learned in a single lab session. Authentic-classroom studies exist (Shobe 2022 [5d.1], Greving et al. 2023 [5b.2], Akbulut 2024 [5d.3]) but are semester-long with low instrumentation. LearnLM RCT (Nov 2025) [2.15] is the closest precedent at N=165 over a multi-week period, but tested math tutoring, not retention of reading material.

**Why this matters:** The *ideal* thesis study would run 8+ weeks with participants using the app for their own study material, measuring retention at 2 weeks and 8 weeks. The *feasible* master's thesis study may have to settle for 2–4 weeks with controlled material. The thesis should acknowledge this as a scope limitation rather than claim to solve it.

**Contribution claim (hedged):** This thesis provides preliminary evidence toward longitudinal retention benefits of document-grounded FSRS+LLM-graded practice. A larger longitudinal deployment is flagged as future work.

### Gap 6 — Transfer / related-but-different question retention is under-tested for AI-graded recall. **[ACKNOWLEDGED]**

**Evidence:** Wooldridge et al. 2014 [5d.2] showed that testing-effect benefits can shrink or vanish when the final test uses *related but different* questions rather than identical questions — which is the realistic classroom condition. Most SRS tools (Anki included) test with the same question repeatedly. Whether LLM-graded generative recall supports transfer (the ability to answer related-but-different questions on the source material) is an open empirical question.

**Why this matters:** The thesis's impact claim would be significantly stronger if it measured transfer, not just same-question recall. Transfer requires the LLM to generate novel questions about the same source material at test time — an extra design wrinkle.

**Decision needed:** Thesis should either (a) measure only identical-question recall and acknowledge the transfer gap, or (b) add a transfer condition and claim broader contribution. This is a scope decision that belongs in `03_methodology_reference.md`.

### Gap 7 — Rubric design for LLM grading in deployed educational tools lacks reporting conventions. **[ACKNOWLEDGED]**

**Evidence:** Yavuz 2024 [5c.1] reports ICC = 0.972 with analytical rubrics. Grevisse 2024 [2.7] shows rubric quality is load-bearing. GradeOpt [2.8] proposes iterative rubric optimization. But none of this work is consolidated into a "how to design a grading rubric for a deployed SRS tool" framework. Your thesis is not the vehicle to produce that framework, but can contribute a case study.

**Why this matters:** The thesis's methodology chapter will have to document the rubric design process carefully. This isn't a gap you're closing so much as one you're documenting.

**Contribution claim (narrow):** This thesis provides a documented, versioned grading rubric for an open-ended document-grounded recall task, with an IRR sub-study of LLM vs. human grader agreement on a held-out sample — filling a reporting-convention gap.

### Gap 8 — Knowledge graph visualization as engagement and sense-making feature for document-grounded learning tools. **[OWNED as system feature; ACKNOWLEDGED as evaluation limit]**

**Evidence:** Visual concept-map and knowledge-graph interfaces have moderate empirical support as learning tools. Donoghue & Hattie 2021 [2.5] includes concept mapping in their meta-analysis of 10 learning techniques with a measurable positive effect, though smaller than practice testing. Karpicke & Blunt 2011 [2.2] directly showed retrieval practice outperforms concept mapping on delayed retention — but the follow-up by Lechuga et al. (referenced in [2.2]) showed concept mapping still produces meaningful learning, just less than retrieval practice. Critically, their studies compared the two as *learning activities*, not as *visualization aids accompanying a retrieval practice system*. In the HCI literature, Synergi (UIST 2023 Best Paper, referenced in [5a.1]) and the broader Semantic Reader prototypes show that visual concept maps of scholarly content improve sense-making and navigation. Obsidian's graph view is the most widely-deployed consumer example of this pattern, though not formally evaluated. Commercial tools (NotebookLM mind maps) implement this visually but without connecting it to retention data.

**What makes this project's version different:** Rather than mapping *document concepts* (as Karpathy/Graphify, NotebookLM, and Obsidian do), the graph can be populated with **the user's own Q&A pairs and their FSRS state** — making it a visualization of the user's learning state, not just the corpus structure. Nodes could be color-coded by retention strength (FSRS stability), edges by cosine similarity between chunks. This is a genuinely different visual object from existing knowledge graphs, even if the underlying graph-rendering techniques are standard.

**Why this matters for the thesis:**
- As a **system feature:** the knowledge graph is a visualization over data the system already produces (highlights, Q&A pairs, FSRS state, ChromaDB embeddings). It costs modest engineering effort and produces a distinctive user-facing feature that aids engagement and sense-making. This is legitimate system-building contribution.
- As an **engagement mechanism:** engagement is a documented moderator of learning outcomes (Duolingo engagement gains from HLR, [1.4]; ITS systematic review [2.16] shows engagement-increasing features correlate with positive effects). A feature that increases user return visits indirectly supports the primary retention outcome.
- As an **empirical claim:** the thesis should NOT claim "our learning graph produces better retention than a knowledge graph" because that requires a comparison study that's outside master's scope. But it *can* claim "we implement a retention-state visualization grounded in practice-testing data" as a system contribution, and report qualitative user feedback on it.

**How to fit it in the thesis:**
1. **Chapter 3 (system design):** describe the learning graph as a design contribution; ground in concept-map literature + PKM tradition + HCI precedents (Synergi, Semantic Reader); explain the user-retention-state twist as distinguishing from existing knowledge graphs.
2. **Chapter 5 (evaluation):** collect qualitative user feedback on the graph feature via short post-study survey (engagement, perceived usefulness, whether it changed study behavior). This is a minor evaluation arm, not the thesis's primary claim.
3. **Chapter 6 (discussion / future work):** explicitly flag that a head-to-head quantitative comparison of learning-graph vs. knowledge-graph vs. no-graph conditions is future work.

**Tier assignment:** Keep in Tier 1 for the thesis's *system* contribution, but the thesis's empirical claims rest on the retention-measurement pipeline, not on the graph. This means the graph doesn't need a formal evaluation beyond user feedback, but it does need to be built and documented as a design contribution.

**Contribution claim (narrow, defensible):** This thesis contributes the design and implementation of a retention-state visualization (the "learning graph") as a novel feature in document-grounded AI learning tools, grounded in concept-map literature and personal knowledge management traditions; formal comparative evaluation is reserved for future work.

---

### Framing note — system-building thesis vs. pure empirical thesis

After writing Gaps 1–8, one scoping point is worth making explicit. This thesis is structured as a **system-building thesis with a narrow empirical arm**, not a pure empirical study. That genre is well-established in HCI and AIED — Semantic Reader [5a.1], LearnLM [2.14], Paper Plain [5a.3], and ScholarPhi [5a.2] all follow it. In this genre:

- **The empirical core** (the retention RCT in this thesis) is narrow and rigorous. Everything in `03_methodology_reference.md` governs it.
- **The system description** (Chapter 3 of the thesis) covers the full tool, including features that don't directly feed the empirical claim but contribute to the system's coherent design.
- **Additional features** are legitimate system-building contributions if they: (a) ground in cited learning-science literature, (b) have minimal spec discipline to keep from dominating the timeline, and (c) receive at least qualitative evaluation.

This framing admits three features that the pure-empirical framing would defer: the knowledge graph (Gap 8), visual intelligence / multimodal selection, and Feynman mode. All three are Tier 1 system features under this framing. They are described in the thesis as design contributions, evaluated qualitatively via post-study survey, and flagged as future work for formal comparative evaluation. The spec discipline is enforced in `04_build_decisions.md` — each gets a minimum-viable demo specification, not a full-vision implementation.

The risk this framing introduces is scope explosion during build. The mitigation is that each of these features has a **scoped "demo quality"** implementation target documented in `04_build_decisions.md`, and clear "cut lines" if timeline pressures emerge.

---

## Part 4 — The Contribution Statement (revised from VISION.md)

### The one-sentence claim

> **A document-grounded active-recall system that replaces self-rated spaced-repetition signals with LLM-graded generative recall against source material — and the first evaluation of retention outcomes for such a system.**

This is narrower and more defensible than VISION.md's original framing. It makes three specific claims:

1. **System contribution:** integrating document-grounded capture + FSRS + LLM-graded generative recall in a deployed tool.
2. **Measurement contribution:** evaluating a scholarly-reading AI tool on retention (not comprehension) outcomes, which the HCI literature has not done.
3. **Methodological contribution:** a documented rubric and validated LLM-grader agreement sub-study.

### Three supporting sub-claims

**Sub-claim A (system):** The capture → schedule → test → grade → reschedule loop implemented over user-highlighted passages from academic PDFs is a novel architecture relative to prior art in SRS, LLM grading, scholarly reading interfaces, and pedagogical LLMs.

**Sub-claim B (empirical):** Retention of material reviewed via LLM-graded generative recall is higher than retention of material reviewed via re-reading of highlights, measured at delayed post-test. [Directional prediction — effect size expected g ≈ 0.5–0.7 based on Adesope 2017 and Butler & Roediger 2007.]

**Sub-claim C (methodological):** LLM grading of open-ended document-grounded recall answers achieves acceptable inter-rater reliability with a human expert (target: ICC ≥ 0.75, defensible per Koo & Li 2016).

### Where this sits relative to prior work

- **More focused than VISION.md:** removes claims about "structured memory system" and "novel contribution vs ChatPDF" (which are true but too broad to defend in a single thesis).
- **More defensible:** every claim maps to specific gaps with cited evidence.
- **Appropriately humble:** acknowledges KARL, LearnLM, Paper Plain, and Semantic Reader exist and do adjacent work. The thesis does not claim to be the first AI-augmented learning tool, the first content-aware scheduler, or the first pedagogically-tuned LLM. It is the first to combine specific pieces with a specific evaluation design.

---

## Part 5 — Anticipated Reviewer Objections

A thesis defense (or paper review) on this work will probably surface five objections. Preparing responses now saves six months later.

### Objection 1: "KARL already does content-aware scheduling. What's new?"

**Response:** KARL uses BERT embeddings of card *text* for predicting user recall probability. The underlying ratings (remembered / forgot) are still user-reported. This thesis replaces the user-reported rating with an LLM evaluation of a typed open-ended recall against the source document. KARL operates on trivia facts; this thesis operates on academic-reading passages. Different architecture, different domain, different empirical question.

### Objection 2: "Isn't this just Anki + a ChatPDF wrapper?"

**Response:** Anki requires manual card creation. ChatPDF does not schedule or test. The integration — highlight → LLM-generated Q&A → FSRS-scheduled generative recall → LLM grading → FSRS rescheduling — is specifically what no tool (open-source or commercial) currently does. The integration is the contribution, and integration claims are legitimate in system-building research (as Semantic Reader and LearnLM both establish).

### Objection 3: "Why should we trust LLM grading?"

**Response:** Recent peer-reviewed evidence (Yavuz 2024 [5c.1]: ICC = 0.972; Grevisse 2024 [2.7]: moderate agreement in medical education across 2,288 answers; Ferrer 2026 [2.9]: self-reported confidence yields best calibration) establishes that LLM grading is methodologically viable for rubric-based short-answer tasks. This thesis adds its own agreement sub-study to ground its specific grading setup in that literature.

### Objection 4: "Your sample size is too small to detect effects."

**Response:** Based on Adesope et al. 2017 meta-analysis [2.1] reporting Hedges' g = 0.61 for practice testing in classroom settings, a between-subjects design with α = .05 two-tailed and 80% power requires approximately N = 44 per condition (88 total) to detect an effect of g = 0.6. LearnLM RCT [2.15] achieved N = 165 for a similar intervention. A master's thesis should target N ≥ 60 per condition where feasible.

### Objection 5: "You're comparing your tool to nothing / to a straw man."

**Response:** The control condition is "re-reading of user's own highlights" — the behavior the tool explicitly aims to replace. This is the active control (not "no study") per the critique in the K-12 ITS meta-analysis [2.16]. Matching time-on-task between conditions is a necessary methodological detail (handled in `03_methodology_reference.md`). Simply comparing to "no intervention" would be too weak.

---

## Part 6 — Decisions This File Drives

The following design decisions are now grounded. Each links to its justification.

| Decision | Justification | File |
|---|---|---|
| FSRS over HLR / SM-2 | [1.3] benchmark superiority; [1.1] peer-reviewed pedigree | `04_build_decisions.md` |
| LLM grading, not self-rating | Gap 1; [4.12] miscalibration; [5c.1] viable ICC | `04_build_decisions.md` |
| Confidence rating before grade reveal | Gap 4; [4.12] | `04_build_decisions.md` |
| Retention (not comprehension) as primary outcome | Gap 2; [1.7] learning-vs-performance | `03_methodology_reference.md` |
| Short-answer typed recall, not multiple choice | [2.6] open > MC; [5d.5] B&R 2007 template | `04_build_decisions.md` |
| Versioned rubric with structured JSON output | Gap 7; [2.7, 2.8]; [5c.1] analytical rubrics | `04_build_decisions.md` |
| Feedback provided after grading | [5d.4] no-feedback caveat; [2.3] feedback enhances | `04_build_decisions.md` |
| Separate review UI from reading UI | [1.7] desirable difficulties; [2.2] distraction-free | `04_build_decisions.md` |
| Claude self-reported confidence for grading routing | [2.9] Ferrer 2026 | `04_build_decisions.md` |
| Pre-registered power analysis, target N ≥ 60/condition | Objection 4 response; [5b.1, 5b.2] | `03_methodology_reference.md` |
| Delayed post-test at 1 week minimum, 1 month target | [2.2, 5d.5] | `03_methodology_reference.md` |
| Active control (re-reading highlights), matched time-on-task | Objection 5 response; [2.16] | `03_methodology_reference.md` |
| Tier 1 excludes Feynman mode, pre-reading priming | Not thesis-critical; Tier 2 per VISION.md | `04_build_decisions.md` |
| Tier 1 **includes** learning graph as system feature (not empirical claim) | Gap 8 revised: engagement + sense-making; qualitative eval only | `04_build_decisions.md` |

---

## Part 7 — Features to Cut, Keep, Move

Based on this gap analysis, revisit the Tier 1 list from roadmap.md:

**Keep in Tier 1 as empirical-core features (closes documented gaps, feeds primary analysis):**
- Persistence of highlights + Q&A pairs (Gap 3 prerequisite)
- FSRS integration with generative recall (Gap 1)
- Review session UI with confidence → recall → grade flow (Gaps 1, 4)
- LLM-graded generative recall in Quiz Me (Gap 1)
- Instrumentation: `review_log` with pre-grade confidence + Claude grade + calibration fields (Gap 4, Objection 3 response)

**Keep in Tier 1 as system-design features (demo-quality spec, qualitative evaluation only):**
- Learning graph / retention-state visualization (Gap 8)
- Visual intelligence / multimodal selection (new — see `04_build_decisions.md` Group K)
- Feynman mode (new — see `04_build_decisions.md` Group L)
- These are described in Chapter 3 (system design), evaluated via post-study qualitative survey items in Chapter 5, and flagged as future work for formal comparative evaluation. Each has a scoped demo-quality implementation target — NOT full-vision implementation — to protect the timeline.

**Move from Tier 1 to "post-thesis":**
- Nothing currently in Tier 1 moves. The empirical-core features are thesis-critical; the system-design features are now explicit and bounded.

**Keep in Tier 2 (valuable, not thesis-critical):**
- Retention dashboard (user-facing) — flagged as Tier 1.5: build if time permits after empirical-core features are solid
- Pre-reading question priming (no gap specifically closed; cheap to add post-thesis)

**Explicitly defer to post-thesis:**
- Cross-document synthesis → Tier 3; depends on mature knowledge graph + multi-document indexing
- Full-vision implementations of the Tier 1 system-design features (e.g., complete multimodal PDF analysis, cross-session Feynman tracking, cross-document knowledge graph)

**Add for thesis (not in current roadmap):**
- IRR sub-study: collect ~100 recall responses, have human expert grade them, compare to Claude's grades, compute ICC. This is Gap 7's contribution claim. Plan ~1–2 weeks of work.
- Pre-registration of primary hypothesis, design, analysis plan on OSF before data collection. This is standard practice in modern empirical psychology and strengthens the thesis considerably. Low effort, high credibility return.
- Post-study survey instrument covering: overall tool experience, learning graph usefulness, multimodal selection usefulness, Feynman mode usefulness, intent to continue use. This is the qualitative evaluation vehicle for the system-design features.

---

## Part 8 — Summary for Claude Code

When called to make implementation decisions, the routing is:

- **"Should I add feature X?"** → Check if X closes a gap in Part 3. If yes, check tier assignment in Part 7. If no, push back.
- **"Why are we doing Y this way?"** → Check Part 6 decisions table. If Y is listed, cite the justification.
- **"Is this worth the effort?"** → Tier 1 items are thesis-critical and should be built carefully. Tier 2 items should be built cheaply or deferred. Tier 3 items should not be built before the thesis is submitted.
- **"Is this contribution novel?"** → Check the Gap Grid in Part 2. If the novel element falls inside one of the 8 specific gaps, yes. If it falls outside, probably not.

The contribution statement in Part 4 is the single sentence that binds everything else. If any feature proposal cannot trace itself back to that sentence, it's probably a distraction.
