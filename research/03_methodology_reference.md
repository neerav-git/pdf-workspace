---
file: 03_methodology_reference.md
purpose: Convert the contribution claim and gap analysis into a concrete, defensible evaluation plan. Covers study design, power analysis, measurement instruments, grading-validity sub-study, and ecological-validity considerations. This is the file Claude Code consults when building instrumentation.
last_updated: 2026-04-16
depends_on: [01_literature_landscape.md, 02_gap_analysis.md]
referenced_by: [04_build_decisions.md, CLAUDE.md]
status: step_3_deliverable
---

# Methodology Reference — Evaluation Plan for the Thesis

> This file is the working methodological reference. It is not a thesis chapter draft — it is the document you consult before committing study-design decisions, and before writing the methodology chapter. Every design choice is traced to a citation in `01_literature_landscape.md`.

---

## Part 1 — What the Thesis Must Measure

From `02_gap_analysis.md`, the contribution statement carries three empirical commitments:

1. **Primary outcome: delayed retention** of academic material reviewed via LLM-graded generative recall, compared against an active control.
2. **Secondary outcome: confidence calibration** — change in users' accuracy at predicting their own recall quality over the study period.
3. **Methodological outcome: LLM grader validity** — inter-rater reliability of Claude's grading against a human expert on a held-out sample.

These three outcomes each demand specific design decisions. The rest of this file works through each.

---

## Part 2 — Study Design Options, Ranked by Feasibility

### Design A — Between-subjects RCT with controlled material (RECOMMENDED for master's)

**Structure:**
- Recruit N ≥ 60 per condition (see Part 3 power analysis), ideally university students in a reading-heavy field.
- All participants read the same 2–3 academic papers or textbook chapters during a study session.
- Random assignment to condition:
  - **Treatment:** uses the tool (highlight → auto-generate Q&A → FSRS-scheduled generative recall over 1–2 weeks)
  - **Active control:** re-reads their own highlights on the same FSRS schedule (time-matched)
- **Immediate post-test** after study session (baseline comprehension).
- **Delayed post-test** at 1 week or 2 weeks (primary outcome).
- **Optional second delayed post-test** at 4 weeks if thesis timeline permits.

**Strengths:**
- Matches Butler & Roediger 2007 [5d.5] (the single best design analog) and Karpicke & Blunt 2011 [2.2].
- Active control (re-reading highlights) is the right comparison — it's the behavior the tool aims to replace.
- Tractable on a master's timeline (4–6 weeks of data collection).

**Weaknesses:**
- Short duration limits longitudinal claims (Gap 5 in `02_gap_analysis.md`).
- Controlled material sacrifices some ecological validity.

**Verdict:** This is the recommended design. Defensible, feasible, precedented.

### Design B — Classroom deployment study

**Structure:**
- Deploy tool in an actual university course for one term.
- Random assignment to tool use vs. usual study methods, or within-subject alternation.
- Course exam performance as primary outcome.

**Strengths:**
- Strong ecological validity (Greving, Lenhard & Richter 2023 [5b.2] is the template here).
- Longitudinal.

**Weaknesses:**
- Requires instructor cooperation and IRB for course-integrated research.
- Confounds: students study other ways too; hard to isolate tool's effect.
- Timeline often exceeds master's thesis.
- Realistic only if you have an advisor with an aligned course.

**Verdict:** Aspirational. If a faculty collaborator exists, upgrade to this. Otherwise Design A.

### Design C — Within-subjects crossover

**Structure:**
- Same participants use both conditions on different materials, counterbalanced.
- Delayed retention measured per condition.

**Strengths:**
- Smaller N needed (roughly half of Design A).
- Each participant serves as own control.

**Weaknesses:**
- Carryover effects: learning the tool once may bleed into control condition.
- Motivational confounds: once participants "get it," they may apply tool-like strategies in control.
- Harder to analyze; harder to defend.

**Verdict:** Only if recruitment is severely constrained and you have a statistician advising.

### Design D — Observational / log-based study

**Structure:**
- Release tool to volunteers; analyze their review_log data over several weeks.
- Correlate FSRS stability, review frequency, etc. with self-reported retention.

**Strengths:**
- Rich data; low effort per participant; scales.
- Useful for methodological outcome (grader validity).

**Weaknesses:**
- No control group = no causal claim about retention.
- Cannot answer the primary empirical question.

**Verdict:** Use as a secondary data-collection stream alongside Design A. Not sufficient on its own.

### Decision

**Primary: Design A (between-subjects RCT).** Secondary data collection via Design D for the IRR sub-study and exploratory analyses.

---

## Part 3 — Power Analysis

### Expected effect size

From the meta-analytic evidence:

- Adesope et al. 2017 [2.1]: Hedges' g = 0.61 for practice testing over restudy (overall); g = 0.67 in classroom settings.
- Donoghue & Hattie 2021 [2.5]: mean effect 0.56 across 10 techniques, with practice testing among the highest.
- Schwieren et al. 2017 (referenced in [2.1]): d = 0.56 for psychology classroom.
- LLM ITS meta-analysis 2025 [2.17]: g = 0.84 for tutor-framed LLM interventions (but includes engagement confounds).

**Conservative planning estimate: Hedges' g = 0.5.** (Smaller than classroom-testing-effect average because the intervention is partially novel and longer-term retention effects attenuate.)

### Calculation (between-subjects t-test, two-tailed)

Following Lakens 2013 [5b.1]. Using standard parameters:

- α = 0.05, two-tailed
- Power (1 − β) = 0.80
- Expected effect g = 0.50 (conservative)
- Allocation ratio 1:1

Required N per group = **64** (total N ≈ 128).

### Sensitivity analysis

- If g = 0.40 (smaller effect): N per group = 100 (total 200). Probably infeasible for a master's.
- If g = 0.60: N per group = 45 (total 90).
- If g = 0.70 (optimistic, matches classroom meta-analytic): N per group = 34 (total 68).

### Recommendation

**Target N = 60 per group (total 120).** This provides:
- ~78% power for g = 0.50
- ~93% power for g = 0.60
- Buffer against attrition (expect ~15% loss between immediate and delayed post-test; recruit 70 per group to land on 60).

If recruitment caps below this, **the thesis should pre-register this as an exploratory study and report confidence intervals rather than null-hypothesis tests.** This is a legitimate and increasingly accepted methodological stance.

### Tools

- **G*Power 3.1** (free, GUI): standard for power calculation, produces publication-ready reports.
- **pwr R package:** `pwr.t.test(d = 0.5, power = 0.80, sig.level = 0.05, type = "two.sample")`.
- **jpower in jamovi:** [5b.1] reference.

---

## Part 4 — Measurement Design

### 4.1 Primary outcome: delayed retention

**Instrument:** short-answer recall test on the material from the study session, administered at delay.

**Question design decisions:**

- **Identical vs. related questions:** Wooldridge et al. 2014 [5d.2] showed testing-effect benefits shrink with related-but-different test questions. Two options:
  - **Option I (simpler, narrower claim):** Use the same questions at immediate and delayed test. Cleaner analysis. Risk: reviewer says "that's just rote memorization."
  - **Option II (harder, broader claim):** Generate related-but-different questions for delayed test. Stronger claim. Risk: more complex analysis; need to validate that related questions are equivalent in difficulty.
  - **Recommendation:** **Use Option I for primary analysis, include 3–5 related-but-different "transfer" questions as secondary analysis.** This is defensible and honest about what each measure shows.

- **Number of items:** Butler & Roediger 2007 [5d.5] used 12 short-answer questions per lecture × 3 lectures = 36 total. For a master's scope, plan ~15–20 recall items per paper, 2 papers → 30–40 items total.

- **Grading of outcome test:** **Not by Claude.** The primary outcome must be graded by a human blinded to condition, using the same rubric Claude uses during the intervention. Using Claude to grade the outcome test would be circular. This is a significant practical workload: ~2,000 graded answers (30 items × 60 participants × 2 conditions × 2 timepoints, minus attrition). Budget for this. Consider dual-rater for a subset to establish human-human ICC as a benchmark.

### 4.2 Secondary outcome: confidence calibration

**Instrument:** 1–5 Likert scale self-rating of confidence, collected *before* user sees their grade.

**Metric:** Calibration = correlation (or absolute mean deviation) between user's pre-grade confidence and Claude's post-grade rating, tracked across sessions.

**Analysis:** Does calibration improve over the study period? (Operationalize as mean calibration in first 3 sessions vs. last 3 sessions per user.)

**Citation:** [4.12] (Bjork, Dunlosky & Kornell 2013) for the theoretical framing of confidence-fluency miscalibration.

**Reporting:** Mean calibration deviation at baseline and endpoint, 95% CIs, pre–post change. This is a secondary outcome, so no α-correction is strictly necessary but report multiplicity honestly.

### 4.3 Methodological outcome: LLM grader validity

**Design: IRR sub-study.**

- Sample ~100 participant recall responses, stratified across question types and paper topics.
- Have one human expert (ideally a subject-matter TA or domain grad student) grade independently using the same rubric Claude uses.
- Compute ICC(3,1) or weighted kappa.

**Target thresholds:**
- **Acceptable:** ICC ≥ 0.75 (per Koo & Li 2016 [5c.4]: "good reliability").
- **Strong:** ICC ≥ 0.90 (per Yavuz 2024 [5c.1] benchmark of 0.972 for fine-tuned models).
- **Unacceptable:** ICC < 0.50 — thesis must acknowledge grading limitation.

**If ICC is low:** report honestly, use human grades as ground truth for primary analysis, discuss grading limitations in thesis. This is still a publishable methodological finding.

**Second human grader recommended** for a subset (~30 responses) to establish human-human IRR as a benchmark. If human-human IRR is ICC = 0.85 and human-LLM is ICC = 0.78, the LLM is approaching the human-human ceiling — a strong result.

### 4.4 Exploratory outcomes (worth instrumenting, not primary claims)

- **Per-item response latency:** time from card-shown to recall-submitted. Standard engagement proxy.
- **Return visits / session count:** does the tool sustain use?
- **FSRS parameter evolution:** do model parameters converge to stable per-user values over the study period?
- **Self-report Likert items post-study:** perceived usefulness, likelihood of continued use, qualitative feedback on specific features (including the learning graph — Gap 8 revision).

---

## Part 5 — Ecological Validity Considerations

Six decisions bear on ecological validity. Each has a defensible stance.

### 5.1 Material selection

- **Authentic academic content:** Use published papers or textbook chapters, not constructed prose. Matches Butler & Roediger 2007 [5d.5] and Karpicke & Blunt 2011 [2.2] methodology.
- **Domain:** Ideally match participants' academic field to approximate real study motivation (Greving & Richter 2018 [5d.4] critique of "educationally relevant" lab materials). Psychology or biology texts work if participants are from those fields.
- **Length:** 3,000–8,000 words per paper. Long enough to generate meaningful highlights; short enough for a 60-minute study session.

### 5.2 Motivation and stakes

Lab-study participants lack real course stakes. This is a genuine limitation per [5d.4]. Partial remedies:

- Pay participants a completion bonus contingent on the delayed post-test.
- Frame the study as "contributing to learning-science research" to engage intrinsic motivation.
- If possible, recruit from a course where the material is curriculum-relevant.

The thesis should acknowledge reduced-stakes as a limitation, not try to claim it's not there.

### 5.3 Time-on-task matching

Active control (re-reading highlights) must be time-matched to the tool condition per `02_gap_analysis.md` Objection 5. Specifically:

- If tool users spend ~15 min/day reviewing, control users should review their highlights for the same time per day.
- Instrument both conditions to log time-on-task; report balance in methodology.

### 5.4 Delay interval selection

From Cepeda et al. 2008 [1.9]: optimal gap is 10–40% of retention interval for short horizons, dropping as horizon lengthens.

- **1-week delayed test:** standard; most testing-effect lab studies use this. [2.2, 5d.5]
- **2-week delayed test:** better trade-off between retention-decay and feasibility.
- **4-week delayed test:** ideal for thesis impact but adds attrition risk.

**Recommendation:** Primary analysis at 2 weeks. Secondary at 4 weeks if feasible (budget for ~20–25% attrition between immediate and 4-week).

### 5.5 Randomization and blinding

- **Participant blinding:** impossible — participants know whether they're using a novel tool or re-reading.
- **Outcome-grader blinding:** essential. Human grader of the outcome test must not know condition.
- **Randomization unit:** individual, not material. Stratify on baseline reading comprehension if possible (short pre-test measure).

### 5.6 Attrition and deviation tracking

Pre-register:
- How attrition will be handled (intention-to-treat vs. complete-case).
- What counts as "condition non-adherence" (e.g., tool condition user who stops using it mid-study).
- Sensitivity analyses for these decisions.

---

## Part 6 — Pre-registration

Pre-registration is strongly recommended, not required. It adds credibility at modest cost.

**Platform:** OSF (osf.io). Free, standard in the field.

**What to register before data collection:**
1. Primary hypothesis (with directional prediction and expected effect size).
2. Secondary hypotheses (confidence calibration, grader ICC).
3. Study design: sample size target, allocation, inclusion/exclusion.
4. Measurement instruments (recall items, confidence scale, post-study survey).
5. Analysis plan: primary model, covariates, handling of attrition and non-adherence.
6. Rubric version(s) that will be used for Claude grading.

**When to register:** after pilot, before main data collection.

**What NOT to register (exploratory):** post-hoc analyses you may want to run after seeing data (e.g., moderator analyses, qualitative themes).

Distinguishing confirmatory (pre-registered) from exploratory (not) analyses in the thesis write-up is sufficient. This matches current best practice.

---

## Part 7 — Rubric Design for LLM Grading

This section operationalizes Gap 7 from `02_gap_analysis.md`.

### 7.1 Rubric structure

Based on Yavuz 2024 [5c.1] (analytical > holistic) and Grevisse 2024 [2.7] (high-quality keys needed):

- **Analytical rubric**, not holistic.
- Multiple dimensions per response, not a single score.
- Explicit pass/partial/fail anchor descriptions per dimension.
- Return structured JSON, not prose.

### 7.2 Proposed dimensions for document-grounded recall

Three-dimensional rubric on a 1–5 scale each:

| Dimension | What it measures | Anchor examples |
|---|---|---|
| **Core claim** | Does the recall capture the main claim of the source passage? | 5: captures core claim accurately; 3: partial capture; 1: misses or contradicts |
| **Supporting detail** | Does the recall include accurate supporting mechanism / evidence? | 5: includes relevant mechanism; 3: mentions but vague; 1: absent or wrong |
| **Faithfulness** | Are any asserted details correct per source? (detects confabulation) | 5: all asserted details correct; 3: minor errors; 1: fabrication present |

Overall score = mean of three dimensions. Individual dimension scores retained for analysis.

### 7.3 JSON output schema

Force Claude to return:
```json
{
  "core_claim_score": <1-5>,
  "core_claim_rationale": "<1 sentence>",
  "supporting_detail_score": <1-5>,
  "supporting_detail_rationale": "<1 sentence>",
  "faithfulness_score": <1-5>,
  "faithfulness_rationale": "<1 sentence>",
  "rubric_hits": ["<key concept 1 matched>", ...],
  "missing": ["<key concept not mentioned>", ...],
  "confidence": <1-5>,
  "feedback": "<plain-language feedback for user>"
}
```

The `confidence` field is critical per Ferrer et al. 2026 [2.9] — this is the self-reported confidence that serves as the grader's own calibration signal. Store it in `review_log`.

The `rubric_hits` and `missing` arrays are computable analysis data — they let you do post-hoc "which concepts did users retain vs. forget?" analyses without re-grading.

### 7.4 Rubric versioning

- Every `review_log` row stores `rubric_version_id`.
- If rubric changes mid-pilot, old grades are re-runnable against new rubric (keep original response text).
- Thesis reports which version was used for the pre-registered analysis.

### 7.5 Rubric calibration during pilot

Before main data collection:
1. Pilot on ~50 responses with preliminary rubric.
2. Human expert grades same 50 responses blind.
3. Compute agreement.
4. If ICC < 0.75: iterate rubric (see GradeOpt-style process [2.8]), re-pilot.
5. Freeze rubric for main study.

Budget 1–2 weeks for rubric calibration. Do not skip this step.

---

## Part 8 — Analysis Plan

### 8.1 Primary analysis

**Model:** Independent-samples t-test on delayed retention scores, with condition as the between-subjects factor.

**Alternatively (recommended if stratified recruitment):** ANCOVA with condition as factor and immediate post-test score as covariate. This increases power and controls for baseline comprehension.

**Effect size reporting:** Hedges' g with 95% CI.

**Software:** R preferred (`lm()` + `effectsize::hedges_g()`). SPSS or jamovi acceptable.

### 8.2 Secondary analyses

- **Confidence calibration trajectory:** linear mixed model with session number as within-subjects factor, calibration deviation as outcome, condition as between-subjects factor.
- **Per-dimension analysis of recall:** same primary model on each rubric dimension separately.
- **Transfer analysis:** t-test on related-but-different items only.

### 8.3 Methodological analysis (IRR sub-study)

- ICC(3,1) and weighted kappa between Claude and human expert on the sampled 100 responses.
- Report 95% CI for ICC (bootstrap recommended).
- If 2 human graders used on a subset, report human-human ICC as benchmark.

### 8.4 Exploratory

- Qualitative content analysis of post-study feedback on the learning graph feature and tool overall.
- Time-on-task as a covariate in sensitivity analyses.
- Per-paper, per-user random effects in a mixed model (if sample size permits).

### 8.5 Deviations from plan

Any analysis not in Parts 8.1–8.3 that you run should be labeled "exploratory" in the thesis write-up. This distinguishes confirmatory from exploratory findings honestly.

---

## Part 9 — Timeline and Effort Estimate

For a master's thesis doing Design A with N = 120:

| Phase | Duration | Effort notes |
|---|---|---|
| Literature chapter drafting | 3–4 weeks | Can overlap with implementation |
| Tool feature-complete | 4–6 weeks | Per Stage 1A/B/C/D in roadmap |
| Rubric calibration pilot | 2 weeks | 50 pilot responses + iteration |
| Pre-registration on OSF | 1 week | Standard template |
| IRB approval | 2–6 weeks | Varies by institution; start early |
| Participant recruitment | 2–4 weeks | Often the bottleneck |
| Main study data collection | 3–4 weeks | Including 2-week delay |
| Delayed post-test administration | 1 week | Automated if instrumented |
| Data grading (human grader for outcome test) | 2–3 weeks | ~2,000 short answers |
| Analysis and write-up | 4–6 weeks | |
| **Total** | **~28–40 weeks** | |

This is the realistic timeline. Cut Design A down to the minimum feasible version if constrained:
- N = 60 total (g = 0.5 exploratory).
- 1-week delay only.
- Reduced IRR sub-study (~50 responses, one human grader).

---

## Part 10 — Summary for Claude Code

When called on methodology questions, routing is:

- **"How many participants do we need?"** → Part 3. Target N = 60/group; pre-register as exploratory if below.
- **"What's the primary outcome?"** → Part 4.1. Delayed short-answer recall, human-graded.
- **"How do we grade the user's recall during the tool use?"** → Part 7. Analytical rubric, structured JSON, versioned.
- **"Should Claude grade the outcome test too?"** → No. Human blinded grader. Claude grading is the *intervention*, not the outcome measure.
- **"Do we need IRB?"** → Yes for any human-subjects data collection. Start early.
- **"Should we pre-register?"** → Part 6. Recommended, not required. OSF platform.
- **"What's the delay interval?"** → Part 5.4. Primary at 2 weeks, secondary at 4 weeks if feasible.
- **"Identical or related questions at delayed test?"** → Part 4.1. Primary: identical. Secondary: 3–5 related-but-different for transfer claim.

The single most important thing to get right: **human grader of the outcome test blinded to condition.** If this is compromised, the primary empirical claim is invalidated. Everything else has remediation paths.
