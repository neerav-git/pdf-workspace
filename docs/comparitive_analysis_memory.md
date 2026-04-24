# Comparative Analysis Guidance

This note captures the intended design direction for a future `Comparative Analysis` tab inside research sessions. It should guide implementation decisions so the feature becomes a serious literature-review surface rather than a decorative dashboard.

## Core Principle

Every comparison cell must be grounded in one of three evidence sources:

| Source | Meaning | Example |
|---|---|---|
| Paper-derived | Extracted from PDFs with evidence spans and page or section provenance | stated methods, findings, limitations |
| Reader-derived | User notes, saved Q&As, synthesis blocks, manually edited takeaways | what the reader found important |
| Review-derived | Spaced-repetition logs, grades, confidence, recall mode, stability | what the reader retained |

The system should compare normalized, evidence-backed claims. It should not compare free-form summaries without provenance.

## Fixed Backbone Plus Session-Specific Dimensions

The comparative analysis system should not be entirely fixed and should not be entirely generated.

If everything is fixed, the analysis becomes generic and misses what is distinctive about a research session. If everything is generated, the analysis becomes unstable as more PDFs are added. The correct architecture is a fixed universal backbone plus adaptive session-specific dimensions.

### Universal Backbone

These categories should exist for every research session.

| Universal Category | Why It Stays Fixed |
|---|---|
| Core problem | Every paper solves or studies something |
| Target population / user | Needed to compare scope and intended audience |
| Main contribution | Needed for literature-review summaries |
| Methodology | Needed for rigor comparison |
| Data / materials | Needed for reproducibility and context |
| Evaluation design | Needed for evidence quality |
| Main results | Needed for findings comparison |
| Limitations | Needed for critical synthesis |
| Future work | Needed for gap analysis |
| Assumptions / hypotheses | Needed to compare theoretical framing |
| Evidence strength | Needed to avoid treating all claims equally |

These categories form the stable tabs and rows that make comparison durable across sessions.

### Session-Specific Dimensions

Fine-grained dimensions should be generated from:

| Input | Use |
|---|---|
| Session title | names the broad research goal |
| Session context | tells the AI what the user is trying to understand |
| Paper abstracts and introductions | identifies recurring paper-level themes |
| Extracted paper claims | identifies what the papers actually cover |
| User-saved index entries | reveals what the reader found important |
| Review data | later reveals what the reader retains or forgets |

For a `Learning Design Research` session, generated dimensions might include:

| Generated Dimension |
|---|
| skimming support |
| guided comprehension |
| retrieval practice |
| cognitive load reduction |
| attention guidance |
| confidence calibration |
| long-term retention |
| cross-document synthesis |
| AI trust / verification |
| novice versus expert scaffolding |
| paper-structure navigation |

For a `Medical Encyclopedia` session, dimensions should be different:

| Generated Dimension |
|---|
| disease definition |
| symptoms |
| diagnosis |
| treatment |
| contraindications |
| patient risk factors |
| prognosis |
| clinical terminology |
| differential diagnosis |

The app should not hardcode these fine-grained dimensions. It should generate, propose, and let the user curate them.

### Three-Layer Data Architecture

| Layer | Role |
|---|---|
| Universal schema | Stable categories every session receives |
| Session ontology | 8–15 generated dimensions specific to the session |
| Paper claims | Evidence-backed facts mapped to both universal categories and session dimensions |

This gives the user both stable comparison and adaptive depth.

### What Should Be Synthesized

The following can be synthesized dynamically per session:

| Synthesized Artifact | Reason |
|---|---|
| Session ontology | Depends on session context and paper mix |
| Fine-grained comparison dimensions | Must adapt to the research topic |
| Gap categories | Depend on the session goal |
| Cross-paper agreement/disagreement summaries | Emerges from paper set |
| “What this session still does not cover” | Depends on current coverage |
| Recommended next-paper search queries | Depends on gaps |
| User-learning takeaways | Depends on notes, Q&As, and reviews |

The following should not be freely synthesized. They should be extracted with evidence:

| Evidence-Required Field | Reason |
|---|---|
| Paper title | factual metadata |
| Participant count | factual study detail |
| Study method | factual methodology detail |
| Reported metrics | factual result detail |
| Main results | must be source-grounded |
| Limitations | should cite paper text |
| Page-grounded claims | must preserve provenance |

### How The Analysis Evolves As More PDFs Are Added

When a new PDF enters a research session:

| Step | Action |
|---|---|
| 1 | Extract paper profile |
| 2 | Extract normalized paper claims |
| 3 | Map claims to the universal schema |
| 4 | Map claims to the current session ontology |
| 5 | Detect whether the paper introduces recurring dimensions not yet represented |
| 6 | Propose ontology updates to the user |
| 7 | Recompute comparison tables |
| 8 | Preserve old dimensions unless the user approves deletion, merge, or rename |

The system should suggest dimension changes rather than silently mutate the research session.

Example prompts:

| Suggested Change | User Decision |
|---|---|
| Add `social annotation` as a comparison dimension? | accept / reject / rename |
| Merge `trust in AI` and `verification behavior`? | merge / keep separate |
| Rename `reading aid` to `attention guidance`? | accept / edit |

This keeps the comparative analysis adaptive but inspectable.

### Practical Starting Constraint

Start with:

| Constraint | Value |
|---|---|
| Universal categories | about 10–12 |
| Session dimensions | about 8–12 initially |
| Claim-to-dimension mapping | max 3 dimensions per claim |
| Evidence requirement | every table cell cites evidence |
| User controls | pin, rename, merge, hide dimensions |

This is enough to support serious comparative analysis without making the interface unstable.

## Comparative Analysis Tab Structure

### 1. Literature Review Matrix

One row per paper. Fixed columns keep the table readable as the session grows.

| Column | Purpose |
|---|---|
| Paper | Identifies the paper |
| Year | Publication year if extractable |
| Domain | Field or topic area |
| Target reader | Intended user or studied population |
| Reading stage targeted | Skimming, deep reading, review, comprehension, triage |
| Main intervention | Core system or design contribution |
| AI/NLP technique | Models, classifiers, summarizers, QA, highlighting |
| Evaluation design | Study type and comparison condition |
| Participants | Sample and population |
| Primary metrics | Measures used in the paper |
| Strongest finding | Main supported result |
| Main limitation | Most important caveat |
| Future direction | What the paper proposes next |

### 2. Problem Framing Table

Rows compare how papers frame the problem.

| Row | What It Should Capture |
|---|---|
| Problem being solved | The core failure or unmet need |
| Who struggles | User population |
| Why current tools fail | Missing support or workflow breakdown |
| Reading pipeline stage | Search, skim, navigate, understand, retain |
| Success definition | What counts as improvement |

### 3. Methodology Comparison Table

| Row | What It Should Capture |
|---|---|
| Study type | Formative, controlled lab, deployment, diary, field study |
| Formative work | Whether the design was grounded in prior user observations |
| Main evaluation | Primary empirical test |
| Sample | Participant count and expertise |
| Task duration | Short timed task, longitudinal use, naturalistic setting |
| Baseline | PDF reader, normal document reader, prior system |
| Measures | Time, accuracy, confidence, comprehension, qualitative themes |
| Statistics used | Mixed effects, t-tests, non-inferiority, descriptive stats |
| Ecological validity | How close the setup is to real use |
| Longitudinal component | Whether repeated use was studied |

### 4. Claims And Findings Table

| Row | What It Should Capture |
|---|---|
| Primary positive result | Strongest supported benefit |
| Null result | Where no difference was found |
| Behavioral change | How reading behavior shifted |
| Preferred feature | What users valued most |
| Helped most when | Context where the system was strongest |
| Failed when | Context where the system was weakest |

### 5. Assumptions And Hypotheses Table

Only include explicit assumptions when the paper states them. Mark inferred rows as `inferred`.

| Row | What It Should Capture |
|---|---|
| Assumed user deficit | What the user lacks or struggles with |
| Assumed mechanism of help | Why the intervention should work |
| Trust assumption | How users are expected to treat AI output |
| AI-output assumption | What must be true about model output |
| Hypothesized behavior change | Expected change in reading behavior |
| Hypothesized learning change | Expected change in comprehension or retention |

### 6. Limitations And Future Work Table

| Row | What It Should Capture |
|---|---|
| Generalizability limit | Population, domain, sample, setting limits |
| Evaluation limit | Study length, artificiality, task constraints |
| AI/model limit | Hallucination, classification error, PDF parsing |
| UX/design limit | Distraction, context loss, discoverability |
| Open research question | What remains unanswered |
| Suggested next capability | What future systems should add |

### 7. Goal Coverage And Gaps

Compare session goals to paper coverage.

Example rows for a learning-interface design session:

| Session Goal | Coverage Type |
|---|---|
| Skimming support | covered strongly |
| Comprehension support | covered partially |
| Retention support | weak or missing |
| Personalization | partial |
| Cross-document synthesis | missing |
| Trust and calibration | partial |
| Long-term learning | missing |

### 8. Retention And Learning Analytics

This table must use review data only.

| Column | Meaning |
|---|---|
| Paper | Paper being reviewed |
| Total cards | Number of saved review cards |
| Reviewed cards | Cards with review attempts |
| Avg confidence | Mean pre-grade confidence |
| Avg grade | Mean LLM grade |
| Calibration gap | Difference between confidence and grade |
| Avg stability | FSRS memory stability |
| Lapse rate | How often cards fail after review |
| Retention by facet | Objective/method/result/etc. recall performance |
| Retention by topic | Which paper topics are best remembered |

## Recommended Visualizations

| Visualization | Best Use |
|---|---|
| Stacked facet bars | Compare objective/novelty/method/result/limitation coverage across papers |
| Topic coverage heatmap | Show which papers cover which session topics |
| Methodology matrix | Compare study design, sample, baseline, metrics |
| Outcome dot plot | Compare reported outcomes across papers |
| Retention bars | Show which papers the reader remembers better |
| Goal gap matrix | Show what the research session still does not cover |
| Evidence drawer | Let users click any table cell to inspect supporting passages |

The most important interaction is click-through evidence. A visually impressive dashboard without evidence drilldown will not be trustworthy.

## Sample Comparative Analysis: Paper Plain vs Scim

### Literature Review Matrix

| Paper | Target Reader | Reading Stage Targeted | Main Intervention | Evaluation | Main Outcome |
|---|---|---|---|---|---|
| Paper Plain | Healthcare consumers / non-experts | Deeper within-paper navigation and understanding | Key question index, answer gists, section gists, term definitions | Formative study of 12 non-expert readers plus 24-person within-participant usability study | Lower reading difficulty, higher confidence/relevance, no loss in comprehension |
| Scim | Researchers skimming scientific papers | Early-stage skimming and paper triage | Faceted extractive highlights, density controls, sidebar/browser | Formative interviews/observations plus 19-person in-lab study plus 12-person two-week diary study | Faster information finding in some tasks; useful for high-level skimming, especially dense or unfamiliar papers |

### Problem Framing

| Dimension | Paper Plain | Scim | Difference |
|---|---|---|---|
| Core problem | Medical papers are inaccessible to non-experts who need them | Researchers must skim large literatures quickly | Paper Plain addresses access and approachability; Scim addresses scale and efficiency |
| User population | Healthcare consumers | Researchers, mainly NLP readers in the study | Different expertise levels and stakes |
| Reading failure mode | Jargon, dense text, not knowing what to read, not finding relevant answers | Hard to skim selectively without missing important/diverse content | Paper Plain assumes deep comprehension barriers; Scim assumes triage/skimming barriers |
| Success criterion | Easier reading and confidence without comprehension loss | Faster identification of important information during skim | Different optimization targets |

### Methodology Comparison

| Dimension | Paper Plain | Scim |
|---|---|---|
| Formative phase | 12 non-expert think-aloud readers | Formative interviews/observations plus design probe/prototype evaluation |
| Main study size | 24 participants | 19 in-lab participants |
| Longitudinal study | No | Yes, 12 participants over two weeks / 10 days of Scim use |
| Baseline | Typical PDF reader | Normal document reader |
| Task type | Timed reading of medical papers in scenario context | Skimming and information-seeking tasks; later naturalistic diary skimming |
| Main metrics | Reading difficulty, understanding, relevance confidence, comprehension | Time, accuracy, ease, diary-reported usefulness |
| Stronger ecological validity | Moderate | Stronger, because of diary study |

### Key Findings

| Row | Paper Plain | Scim |
|---|---|---|
| Strongest positive finding | Participants rated reading significantly easier and felt more confident they found relevant information | Participants found information faster with Scim than baseline in the in-lab study |
| Null / constrained result | No observable degradation in comprehension, but no strong comprehension gain either | No significant difference in difficulty or accuracy in the in-lab study |
| Behavioral shift | Readers used key-question guidance to jump non-linearly to relevant passages | Readers used highlights and sidebar to skim selectively and skip more confidently |
| Most valued feature | Key Question Index and Answer Gists | Faceted highlights plus highlight browser / density controls |
| Main failure mode | Gists can be vague; risk of overconfidence; generated text must be checked | Highlights can miss context and conflict with author-provided visual cues |

### Assumptions And Hypotheses

| Row | Paper Plain | Scim |
|---|---|---|
| Assumed user deficit | Non-experts lack domain knowledge and knowledge of paper structure | Readers lack fast, reliable skimming support across many papers |
| Assumed mechanism of help | Guidance plus plain-language scaffolding lowers approachability barriers | Faceted, distributed highlights support efficient skim decisions |
| Trust assumption | Readers should read gists alongside original text, not replace it | Readers will learn to trust and use highlights with repeated exposure |
| AI dependence | Depends on QA/summarization/term support being useful and safe enough | Depends on facet classification and post-processing being good enough |
| Main hypothesis | Guided navigation and layered summaries improve reading experience without harming comprehension | Intelligent highlighting improves skimming speed and usefulness, especially in dense/unfamiliar papers |

### Conceptual Difference

Paper Plain is fundamentally a guided comprehension interface. Scim is fundamentally a skimming acceleration interface.

That distinction should drive comparison logic:

| Paper | Better Characterized As | Implication |
|---|---|---|
| Paper Plain | Guided comprehension and novice scaffolding | Stronger evidence for helping non-experts approach difficult papers |
| Scim | Expert workflow support and literature triage | Stronger evidence for helping researchers skim and decide what to inspect |

## Gap Analysis For A Learning Interface Design Session

If the session goal is to design interfaces that help readers understand, compare, and retain research papers, these two papers cover some areas well and leave important gaps.

| Area | Coverage |
|---|---|
| Reading support interfaces | Strong |
| Navigation and attention guidance | Strong |
| Usability evaluation | Strong |
| Rhetorical / structural support | Strong |
| Confidence and perceived ease | Strong |
| Within-paper information access | Strong |
| Comprehension outcomes | Partial |
| Trust in AI assistance | Partial |
| Behavior change during reading | Partial |
| Long-term retention | Weak or missing |
| Spaced repetition / review loops | Missing |
| Knowledge graph construction from reading | Missing |
| Cross-paper synthesis | Missing |
| Transfer of understanding across papers | Missing |
| Confidence versus true learning calibration | Missing |
| Personalized adaptation based on later recall | Missing |

## Implementation Plan

### 1. Add A Paper-Comparison Extraction Layer

Create paper-level structured records separate from highlights and study cards.

Proposed entities:

| Entity | Purpose |
|---|---|
| paper_profiles | Paper-level structured metadata |
| paper_claims | Evidence-backed normalized claims |
| paper_metrics | Extracted reported metrics/results |
| session_goal_items | Goals derived from session context |
| session_gap_items | Gaps between session goals and paper coverage |

`paper_profiles` should hold:

| Field | Meaning |
|---|---|
| paper title | canonical paper name |
| venue/year | if extractable |
| target reader | studied/intended user |
| domain | field/topic |
| intervention type | interface, model, tool, study |
| reading stage targeted | skim, understand, compare, retain |
| study types | formative, lab, diary, deployment |
| sample summary | participants and population |
| primary contributions | stated contributions |
| limitations | stated limitations |
| future directions | stated future work |

`paper_claims` should hold:

| Field | Meaning |
|---|---|
| pdf_id | source PDF |
| category | objective, novelty, method, result, limitation, future_work, assumption, hypothesis |
| subcategory | e.g. target_user, baseline, primary_outcome |
| claim_text | normalized claim |
| evidence_chunk_ids | source chunks |
| page_refs | page references |
| confidence | extraction confidence |
| explicitness | explicit, inferred, reader_authored |

### 2. Build Extraction In Two Passes

| Pass | Work |
|---|---|
| Paper profiling | Extract abstract, intro, method/evaluation, results, discussion, limitations, conclusion |
| Claim normalization | Convert facts into comparable claims such as target_user, study_type, primary_outcome |

Do not let the UI compare free-form summaries. Compare normalized claims.

### 3. Keep Paper Facts Separate From Reader Data

| Layer | Role |
|---|---|
| Source facts | What the paper says |
| Reader distillations | What the reader found important |
| Retention metrics | What the reader remembers |

Reader notes and Q&As should enrich salience, not overwrite paper facts.

### 4. Generate Session-Level Comparison Views

For each research session:

| Trigger | Result |
|---|---|
| New PDF added | update profiles, claims, tables |
| Session context edited | recompute goal coverage |
| User adds high-signal note/Q&A | update reader-derived salience |
| Review data changes | update retention analytics |

### 5. Comparison UI

Top controls:

| Control | Purpose |
|---|---|
| Paper selector | compare selected papers or all papers |
| Source filter | paper only, paper + reader, include review |
| Evidence threshold | hide weakly supported claims |
| Explicit-only toggle | hide inferred assumptions |

Main layout:

| Area | Purpose |
|---|---|
| Summary cards | agreement, differences, gaps |
| Tabbed tables | overview, methods, findings, assumptions, limitations |
| Evidence drawer | source excerpts and saved Q&A |
| Retention panel | review-derived learning analytics |
| Gap panel | missing coverage and possible paper recommendations |

### 6. Gap Engine

Use session context as the target schema.

Example context:

> I’m studying learning-interface design for helping readers understand, compare, and retain research papers.

Target dimensions:

| Dimension |
|---|
| skimming support |
| comprehension support |
| retention support |
| trust/calibration |
| personalization |
| cross-document synthesis |
| longitudinal evidence |

Output:

| Coverage Level | Meaning |
|---|---|
| covered strongly | multiple papers provide evidence |
| covered partially | one paper or weak evidence |
| missing | not covered by current session |

### 7. Paper Recommendation Engine

Only add web recommendations after gaps are explicit.

Pipeline:

| Step | Work |
|---|---|
| Gap query generation | turn missing dimensions into scholarly queries |
| Scholarly search | Semantic Scholar, OpenAlex, Crossref |
| Rerank | session relevance, gap fit, method diversity, recency |
| Explain | why this paper fills a gap |

Recommendation output:

| Field | Meaning |
|---|---|
| suggested paper | title and citation |
| gap filled | which session gap it addresses |
| complements | which current paper it complements |
| reason | evidence-based explanation |

### 8. Retention Analytics

Activate only when enough review data exists.

Metrics:

| Metric | Meaning |
|---|---|
| cards reviewed per paper | review coverage |
| average grade | recall quality |
| average confidence | metacognitive confidence |
| confidence-grade calibration gap | over/underconfidence |
| mean stability | FSRS retention estimate |
| lapse rate | forgetting |
| retention by facet | objective/method/result/etc. performance |
| retention by topic | topic-level recall strength |

This lets the app answer:

| Question |
|---|
| Which paper’s ideas do I remember best? |
| Which topics do I consistently forget? |
| Which kinds of papers produce durable learning? |
| Which claims are familiar but not retained? |

### 9. Safe Implementation Order

| Order | Step |
|---|---|
| 1 | Add paper_profiles and paper_claims |
| 2 | Build paper-level extraction and evidence storage |
| 3 | Generate static comparison tables from paper facts only |
| 4 | Add session goal coverage |
| 5 | Add reader-derived enrichment |
| 6 | Add review-derived retention tables |
| 7 | Add web-based gap recommendations |

## Final Design Constraint

Comparative analysis should be built from normalized, evidence-backed paper claims. The index and review system should enrich salience and retention, but neither should blur into speculative summary generation.
