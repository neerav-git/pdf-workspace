---
file: 01_literature_landscape.md
purpose: Authoritative bibliographic spine for the thesis. Every other file in this folder cites into this one.
last_updated: 2026-04-16
depends_on: []
referenced_by: [02_gap_analysis.md, 03_methodology_reference.md, 04_build_decisions.md, CLAUDE.md]
status: step_1_deliverable
scope: 4 literatures × ~10-15 entries each, curated not exhaustive; section 5 adds targeted supplementary entries
relevance_tags: [foundational, methodological, competitor, critique, gap-evidence, neighbor]
---

# Literature Landscape — PDF Learning Retention App

This file organizes the research literature that grounds the thesis. It is divided into four literatures, each of which maps to a specific thesis question:

- **Literature 1 — SRS/FSRS research:** justifies *which scheduling algorithm* and why.
- **Literature 2 — AI-augmented learning & LLM grading:** justifies *that LLM-graded generative recall is viable* and locates the work's contribution.
- **Literature 3 — Document-grounded tools & PKM:** locates the work in the *tool landscape* and distinguishes it from existing products.
- **Literature 4 — Retention measurement & cognitive foundations:** justifies *how to evaluate* the system and the *learning-science basis* of every feature.

Each entry has the format:

- **Citation** (authors, year, venue)
- **Claim** (one-line)
- **Methodology** (brief)
- **Tag** (relevance: foundational / methodological / competitor / critique / gap-evidence / neighbor)
- **Build-relevance** (why this paper changes or confirms a project decision)

"Neighbor" means a paper doing something very close to what this thesis proposes. "Gap-evidence" means it establishes that something is *not* yet done.

---

## Literature 1 — SRS / FSRS Research

> Core question: which scheduling algorithm, and can you defend the choice against alternatives?

### 1.1 Ye, Su & Cao (2022) — SSP-MMC / FSRS foundation
- **Citation:** Ye, J., Su, J., & Cao, Y. (2022). A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling. *Proceedings of the 28th ACM SIGKDD Conference on Knowledge Discovery and Data Mining (KDD '22)*, 4381–4390. DOI: 10.1145/3534678.3539081
- **Claim:** SSP-MMC (the algorithmic predecessor of FSRS) reduces review cost by 12.6% vs. prior state-of-the-art; deployed in MaiMemo to millions of students.
- **Methodology:** Trained on 220M MaiMemo review logs; Markov memory model + stochastic shortest path; evaluated on review count to target recall probability.
- **Tag:** foundational
- **Build-relevance:** This is the canonical citation for "why FSRS." Cite in Chapter 2. The dataset (open at Harvard Dataverse) is relevant if you ever want to validate parameter choices.

### 1.2 Su, Ye, Nie, Cao & Chen (2023) — SSP-MMC-Plus / IEEE TKDE extension
- **Citation:** Su, J., Ye, J., Nie, L., Cao, Y., & Chen, Y. (2023). Optimizing Spaced Repetition Schedule by Capturing the Dynamics of Memory. *IEEE Transactions on Knowledge and Data Engineering*. DOI: 10.1109/TKDE.2023.3251721
- **Claim:** Extends SSP-MMC with an alternating memory prediction / schedule optimization loop; introduces a new benchmark dataset.
- **Methodology:** Same corpus as 1.1, extended methodology.
- **Tag:** foundational
- **Build-relevance:** Secondary citation for FSRS lineage. Useful to demonstrate the algorithm has peer-reviewed pedigree beyond the KDD paper.

### 1.3 Open Spaced Repetition — SRS Benchmark (ongoing, 2022–present)
- **Citation:** Open Spaced Repetition Group. *A benchmark for spaced repetition schedulers/algorithms.* GitHub: open-spaced-repetition/srs-benchmark. Expertium's Benchmark blog: https://expertium.github.io/Benchmark.html
- **Claim:** FSRS-6 achieves 99.6% superiority over SM-2 on log loss across 9,999 Anki collections (≈350M reviews). FSRS-7 (newest) adds fractional intervals and per-user forgetting curve shape.
- **Methodology:** Benchmarks FSRS v4/4.5/5/6/7, HLR, Ebisu, DASH, SM-2, LSTM against each other on held-out user collections; metrics are log loss and RMSE-bins.
- **Tag:** methodological
- **Build-relevance:** This is the quantitative evidence you cite in the thesis when defending FSRS over SM-2. Not peer-reviewed, but the dataset and methodology are public and cited by the research community. The thesis should acknowledge this is a community benchmark, not a peer-reviewed paper.

### 1.4 Settles & Meeder (2016) — Half-Life Regression (HLR)
- **Citation:** Settles, B., & Meeder, B. (2016). A Trainable Spaced Repetition Model for Language Learning. *Proceedings of the 54th Annual Meeting of the Association for Computational Linguistics (ACL)*, 1848–1858.
- **Claim:** HLR combines psycholinguistic theory with ML to estimate per-item half-life; improved Duolingo engagement by 12% in operational A/B test.
- **Methodology:** Logistic-style regression on ~65M Duolingo review events; features include lexeme, learner history, time since last review.
- **Tag:** foundational / competitor-algorithm
- **Build-relevance:** Cite as the alternative you considered before selecting FSRS. HLR is simpler but less accurate (per 1.3's benchmark). Useful for the "alternatives considered" section.

### 1.5 Tabibian, Upadhyay, De, Zarezade, Schölkopf & Gomez-Rodriguez (2019) — MEMORIZE
- **Citation:** Tabibian, B., et al. (2019). Enhancing human learning via spaced repetition optimization. *Proceedings of the National Academy of Sciences*, 116(10), 3988–3993. DOI: 10.1073/pnas.1815156116
- **Claim:** MEMORIZE uses stochastic optimal control to compute optimal review times; outperforms uniform and threshold-based baselines on Duolingo data.
- **Methodology:** Mathematical framework (marked temporal point processes); validated on Duolingo dataset.
- **Tag:** foundational / competitor-algorithm
- **Build-relevance:** The most prestigious venue in the SRS literature (PNAS). Cite to show the thesis is aware of the optimal-control approach to scheduling. FSRS is simpler and more widely deployed; this is the "more principled but less practical" alternative.

### 1.6 Shu, Balepur, Feng & Boyd-Graber (2024) — KARL ⭐ CRITICAL NEIGHBOR
- **Citation:** Shu, M., Balepur, N., Feng, S., & Boyd-Graber, J. L. (2024). KARL: Knowledge-Aware Retrieval and Representations aid Retention and Learning in Students. *Proceedings of EMNLP 2024*, 14161–14178. arXiv: 2402.12291
- **Claim:** **Content-aware scheduling** (using flashcard text via BERT embeddings + Deep Knowledge Tracing) beats content-blind student models like FSRS on AUC and calibration; a 6-day online study with 27 learners showed KARL improved medium-term learning over state-of-the-art.
- **Methodology:** 123,143 study logs collected on trivia questions; DKT-inspired architecture with retrieval + BERT; deployed in their own Pinafore flashcard app.
- **Tag:** **neighbor** — the closest research neighbor to this thesis.
- **Build-relevance:** **This paper must be read in full before Stage 1A.** KARL is the only published work combining content-aware student modeling with a spaced-repetition scheduler in a deployed app. Three implications: (a) **KARL occupies part of the space this thesis aimed at** — adjust contribution claim to exclude "using card content for scheduling is novel"; (b) KARL's dataset is trivia, not document-grounded academic reading — the *document-grounded* angle remains open; (c) KARL uses DKT+BERT, not LLM-graded generative recall — the *generative recall evaluation* angle remains open.

### 1.7 Soderstrom & Bjork (2015) — Learning vs. Performance
- **Citation:** Soderstrom, N. C., & Bjork, R. A. (2015). Learning versus performance: An integrative review. *Perspectives on Psychological Science*, 10(2), 176–199. DOI: 10.1177/1745691615569000
- **Claim:** Performance during training is an unreliable proxy for learning. Manipulations that improve short-term performance can fail to produce long-term retention; conversely, "desirable difficulties" depress short-term performance but improve long-term learning.
- **Methodology:** Integrative review of verbal and motor learning literature, 1930s–2010s.
- **Tag:** foundational / methodological
- **Build-relevance:** This is the paper that justifies **why the thesis must measure delayed retention, not immediate post-session performance.** If you only measure performance at end of a review session, you risk capturing "performance" (short-term) and missing "learning" (long-term). Cite in the evaluation chapter. This is a more modern replacement for the Bjork 1994 citation in your VISION.md.

### 1.8 Cepeda, Pashler, Vul, Wixted & Rohrer (2006) — Spacing meta-analysis
- **Citation:** Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3), 354–380.
- **Claim:** 839 assessments across 317 experiments confirm the spacing effect; optimal inter-study interval scales with retention interval (target 10–20% of retention interval for most delays).
- **Methodology:** Meta-analysis.
- **Tag:** foundational
- **Build-relevance:** The canonical meta-analysis for the spacing effect. Gives effect sizes you can cite. Also gives the rule-of-thumb that informs FSRS parameter selection (though FSRS learns intervals from data, not from this heuristic).

### 1.9 Cepeda, Vul, Rohrer, Wixted & Pashler (2008) — Temporal ridgeline
- **Citation:** Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science*, 19(11), 1095–1102.
- **Claim:** Empirically, for a 1-week test delay the optimal study gap is ~20–40% of the delay; for a 1-year delay it drops to ~5–10%. Optimal gap shrinks proportionally as delay grows.
- **Methodology:** N=1,354 participants; facts learned once, reviewed after gaps up to 3.5 months, tested up to 1 year later.
- **Tag:** foundational / methodological
- **Build-relevance:** Cite to justify that any "one correct spacing" is wrong — the interval depends on your target retention horizon. This supports using FSRS (which adapts intervals per user) over fixed-interval alternatives.

### 1.10 FSRS vs. SM-2 cohort studies in medical education
- **Citation examples:** Exploring the Impact of Spaced Repetition Through Anki Usage on Preclinical Exam Performance (2024, PMC12357012); A Cohort Study Assessing the Impact of Anki as a Spaced Repetition Tool on Academic Performance in Medical School (2023, PMC10403443).
- **Claim:** Greater Anki matured-card count and study hours correlate with higher exam performance in medical students.
- **Methodology:** Observational cohort studies; no random assignment.
- **Tag:** gap-evidence (for the *absence* of controlled trials)
- **Build-relevance:** Cite to show SRS has real-world uptake in high-stakes contexts. Also cite as evidence that **the field still lacks rigorous RCTs** of SRS-based tools in academic-reading contexts — which your thesis could contribute toward.

### 1.11 Critiques of SRS / Anki — transfer and fragmentation
- **Sources:** Mehta et al. 2023 comment (Springer 10.1007/s40670-023-01864-2); Balint SAEM Pulse 2022 "Flashcard Folly"; Anki community discussions on "Anki debt" and low-interval-hell.
- **Claim:** SRS can promote surface recognition over deep understanding; over-decomposition of concepts can disrupt holistic comprehension; card quality strongly moderates benefit.
- **Methodology:** Commentary and observational reports; limited empirical backing.
- **Tag:** critique
- **Build-relevance:** **Engage with this in the thesis, don't avoid it.** The response template you've designed (layered disclosure, Feynman mode) is arguably an explicit response to fragmentation critiques. Claim this explicitly: the app isolates discrete memory items but scaffolds them against the source document to preserve context, and the Feynman mode forces integration. Don't just say "we use SRS" and stop.

---

## Literature 2 — AI-Augmented Learning & LLM Grading

> Core question: is LLM-graded generative recall viable, and where does this work sit relative to published systems?

### 2.1 Adesope, Trevisan & Sundararajan (2017) — Practice-testing meta-analysis
- **Citation:** Adesope, O. O., Trevisan, D. A., & Sundararajan, N. (2017). Rethinking the use of tests: A meta-analysis of practice testing. *Review of Educational Research*, 87(3), 659–701.
- **Claim:** Practice tests outperform restudy and all other comparison conditions. Hedges' g ≈ 0.61 overall; g ≈ 0.67 in classroom settings. Moderated by test format, feedback, and test-criterion match.
- **Methodology:** Meta-analysis.
- **Tag:** foundational / methodological
- **Build-relevance:** The canonical effect-size benchmark for the testing effect. When you later do a power analysis, use g = 0.5–0.7 as your expected effect for a similar-design study. Cite in both Chapter 2 (motivation) and the methodology chapter.

### 2.2 Karpicke & Blunt (2011) — Retrieval practice beats concept mapping
- **Citation:** Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more learning than elaborative studying with concept mapping. *Science*, 331(6018), 772–775.
- **Claim:** Students practicing retrieval (free recall with repeated study+recall cycles) outperformed those concept-mapping on a 1-week delayed test — even when the delayed test format was concept-mapping itself.
- **Methodology:** Between-subjects experiment with college students and science texts.
- **Tag:** foundational / methodological-template
- **Build-relevance:** **The single most important methodological precedent for your evaluation study.** Uses authentic science texts (not word lists), 1-week delayed test, multiple dependent measures. If you design your RCT to resemble this, it is immediately defensible. The replication by Lechuga et al. (2015, Learning and Instruction) and the Mintzes et al. 2011 comment + Karpicke's response are also worth reading for the methodological critique literature.

### 2.3 Roediger & Butler (2011) — Retrieval practice review
- **Citation:** Roediger, H. L., III, & Butler, A. C. (2011). The critical role of retrieval practice in long-term retention. *Trends in Cognitive Sciences*, 15(1), 20–27.
- **Claim:** Retrieval practice promotes not just memorization but flexible, transferable knowledge; feedback enhances its benefits.
- **Methodology:** Review.
- **Tag:** foundational
- **Build-relevance:** Use for the "retrieval practice enhances transfer, not just recall" claim. This is your rebuttal to the "SRS only helps rote memorization" critique from 1.11.

### 2.4 Dunlosky, Rawson, Marsh, Nathan & Willingham (2013) — Learning techniques review
- **Citation:** Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*, 14(1), 4–58.
- **Claim:** Practice testing and distributed practice get "high utility" ratings. Highlighting and rereading get "low utility." Elaborative interrogation and self-explanation get "moderate."
- **Methodology:** Narrative review + rating.
- **Tag:** foundational / methodological
- **Build-relevance:** **The single best paper to cite when justifying your feature priority.** Practice testing = Quiz Me (generative recall). Distributed practice = FSRS. Highlighting (low utility) is explicitly what your thesis claims is *inadequate alone* — this citation directly supports your positioning. Elaborative interrogation (moderate) grounds your response template.

### 2.5 Donoghue & Hattie (2021) — Meta-analysis of Dunlosky's 10 techniques
- **Citation:** Donoghue, G. M., & Hattie, J. A. C. (2021). A meta-analysis of ten learning techniques. *Frontiers in Education*, 6:581216.
- **Claim:** Meta-analysis across 242 studies, 169,179 participants; overall mean effect 0.56; practice testing and distributed practice are the highest-effect techniques.
- **Methodology:** Meta-analysis updating Dunlosky et al. 2013.
- **Tag:** foundational / methodological
- **Build-relevance:** More recent and more quantitative than 2.4. Use both.

### 2.6 Bisra, Liu, Nesbit, Salimi & Winne (2018) — Self-explanation meta-analysis
- **Citation:** Bisra, K., Liu, Q., Nesbit, J. C., Salimi, F., & Winne, P. H. (2018). Inducing self-explanation: A meta-analysis. *Educational Psychology Review*, 30(3), 703–725.
- **Claim:** Self-explanation prompts yield g = 0.55 across 64 studies; multiple-choice format is least effective, open-ended most effective.
- **Methodology:** Meta-analysis.
- **Tag:** foundational
- **Build-relevance:** Supports your Feynman mode feature. Also directly supports the "open-ended generative recall beats multiple choice" design choice.

### 2.7 Grevisse (2024) — LLM ASAG in medical education
- **Citation:** Grevisse, C. (2024). LLM-based automatic short answer grading in undergraduate medical education. *BMC Medical Education*, 24:1060. DOI: 10.1186/s12909-024-06026-5
- **Claim:** GPT-4 and Gemini 1.0 Pro both reached moderate agreement with human graders on 2,288 answers across 12 courses and 3 languages. Gemini's grades were not significantly different from human grades; GPT-4 was slightly more conservative. Both achieved high precision on fully-correct answers.
- **Methodology:** Real-world university-exam data, rubric-guided LLM prompts, comparison to single human grader.
- **Tag:** **neighbor / methodological**
- **Build-relevance:** **Critical citation for defending LLM-as-grader.** Key implementation details: (a) "high-quality keys" (rubrics) are essential for consistent grading; (b) LLMs over-credit if rubric is vague; (c) moderate agreement is the realistic ceiling with current models. Your rubric design must heed these findings.

### 2.8 GradeOpt — Chu et al. (2024) — LLM grading with optimized rubrics
- **Citation:** Chu, Y., et al. (2024). A LLM-Powered Automatic Grading Framework with Human-Level Guidelines Optimization. arXiv: 2410.02165
- **Claim:** GradeOpt iteratively refines grading rubrics via self-reflection to better match human graders; outperforms baselines on pedagogical content knowledge grading.
- **Methodology:** Self-reflection + multi-agent prompt optimization.
- **Tag:** methodological
- **Build-relevance:** If you want to version and tune your grading rubric (recommended in `04_build_decisions.md`), cite this paper to justify iterative rubric refinement as a validated approach.

### 2.9 Ferrer et al. (2026) — LLM grader calibration
- **Citation:** Ferrer, R., et al. (2026). When Can We Trust LLM Graders? Calibrating Confidence for Automated Assessment. arXiv: 2603.29559
- **Claim:** Across 7 LLMs (4B–120B params) on 3 datasets, **self-reported confidence** yields the best-calibrated signal (avg ECE 0.166 vs 0.229 for self-consistency). Self-consistency is 38% worse despite 5× inference cost.
- **Methodology:** Comparison of confidence estimation methods; expected calibration error (ECE) as metric.
- **Tag:** **methodological — load-bearing for this thesis**
- **Build-relevance:** **This paper dictates your grading-confidence design choice.** Have Claude output a self-reported confidence with the grade. Use that signal (not sampling or log-probs) for any automation-vs-human-review routing. Cite directly in methodology chapter. Newest and most directly applicable.

### 2.10 CHiL(L)Grader — human-in-the-loop calibrated grading (2026)
- **Citation:** (2026). CHiL(L)Grader: Calibrated Human-in-the-Loop Short-Answer Grading. arXiv: 2603.11957
- **Claim:** Post-hoc temperature scaling + selective prediction defers uncertain LLM grades to humans; continual learning loop adapts to new rubrics. Auto-grades 35–65% of answers with high confidence.
- **Methodology:** Three ASAG datasets; calibration + selective prediction + continual learning.
- **Tag:** methodological
- **Build-relevance:** Not required for a master's thesis, but a good citation when discussing limits of pure automation. The thesis could mention this as a future direction.

### 2.11 Meyer, Breuer & Fürst (2024) — ASAG2024 combined benchmark
- **Citation:** Meyer, G., Breuer, P., & Fürst, J. (2024). ASAG2024: A Combined Benchmark for Short Answer Grading. *SIGCSE Virtual 2024*. arXiv: 2409.18596
- **Claim:** First comprehensive cross-subject/cross-scale ASAG benchmark; shows specialized task-finetuned models (BART-SAF, PrometheusII-7B) vs. general LLMs.
- **Methodology:** Benchmark dataset construction.
- **Tag:** methodological
- **Build-relevance:** Useful if you want to evaluate your grading prompt against established benchmarks. Not required.

### 2.12 Shu et al. (2024) — KARL (see Literature 1, entry 1.6)
- *Cross-reference.* KARL also belongs here as the closest AI-augmented-learning neighbor. Treat as primary neighbor in both literatures.

### 2.13 Enhancing LLM-Based Short Answer Grading with RAG (2025)
- **Citation:** Enhancing LLM-Based Short Answer Grading with Retrieval-Augmented Generation. *EDM 2025 Short Papers*. URL: educationaldatamining.org/EDM2025/proceedings/2025.EDM.short-papers.81
- **Claim:** Adaptive RAG framework for grading: retrieves domain knowledge per question+answer context; outperforms non-RAG LLM grading on science short-answer tasks.
- **Methodology:** RAG-augmented grading pipeline.
- **Tag:** **methodological — directly applicable**
- **Build-relevance:** Your project is RAG-native. If you also use RAG for grading (grade against the retrieved passage, not just Claude's priors), you have prior-art support. Cite this as the methodological precedent for that design choice.

### 2.14 Jurenka et al. (2024) — LearnLM / pedagogical instruction-following
- **Citation:** LearnLM Team Google (2024). LearnLM: Improving Gemini for Learning. arXiv: 2412.16429 (Dec 2024 update of May 2024 tech report)
- **Claim:** Training an LLM with "pedagogical instruction following" (system prompts specifying desired pedagogy) produces a model that expert raters prefer over GPT-4o (+31%), Claude 3.5 Sonnet (+11%), and base Gemini 1.5 Pro (+13%) on learning scenarios.
- **Methodology:** Fine-tuning + expert pedagogical evaluation rubrics.
- **Tag:** **neighbor**
- **Build-relevance:** **Critical validation for your response template approach.** LearnLM takes exactly the stance your RESPONSE_TEMPLATE.md takes: pedagogy is encoded at the system-prompt level, not baked into the model. This is both (a) an endorsement of your approach (you're aligned with Google's research stance) and (b) a competitor (Google's model might be preferable for your grading step). Discuss in both contribution-claim and alternatives-considered sections.

### 2.15 LearnLM RCT (Nov 2025) — classroom efficacy evidence
- **Citation:** LearnLM Team Google (2025). AI tutoring can safely and effectively support students: An exploratory RCT in UK classrooms. (Nov 2025 report — goo.gle/LearnLM-Nov25)
- **Claim:** Exploratory RCT with N=165 UK secondary students. LearnLM-tutored students performed at least as well as students tutored by humans on all measured learning outcomes. Supervising tutors approved 76.4% of LearnLM's drafted messages with zero/minimal edits.
- **Methodology:** RCT with static-hints vs. tutoring conditions; within tutoring, randomized to human vs. supervised LearnLM.
- **Tag:** methodological / gap-evidence
- **Build-relevance:** **Use as your methodological model for an RCT.** N=165 is feasible for a master's thesis. Their "static hints vs. interactive AI" contrast is structurally similar to "re-reading highlights vs. FSRS-scheduled generative recall" that your thesis could run.

### 2.16 nature (2025) — Systematic review of ITS in K-12
- **Citation:** A systematic review of AI-driven intelligent tutoring systems (ITS) in K-12 education. *npj Science of Learning* (2025). URL: nature.com/articles/s41539-025-00320-7
- **Claim:** Systematic review of 28 studies (N=4,597 students): ITS effects on K-12 learning are generally positive but attenuated when compared against non-intelligent tutoring systems (not just vs. no intervention).
- **Methodology:** Systematic review, quasi-experimental designs.
- **Tag:** methodological / critique
- **Build-relevance:** Cite for a balanced framing: AI tutoring helps, but mostly vs. nothing. The harder question is whether it helps vs. non-AI tutoring. Your thesis should define its comparison condition carefully (likely vs. re-reading or flashcard apps, not vs. "no intervention").

### 2.17 LLM ITS meta-analysis (2025)
- **Citation:** A Meta-Analysis of LLM Effects on Students across Qualification, Socialisation, and Subjectification. arXiv: 2509.22725 (2025)
- **Claim:** Across studies from Nov 2022–2025, LLMs framed as **interactive tutors** produce Hedges' g = 0.84 on qualification outcomes vs. g = 0.44 for LLMs as passive tools. Duration >8 weeks produces the largest effects.
- **Methodology:** Meta-analysis, random-effects model, moderator analysis.
- **Tag:** **methodological — load-bearing**
- **Build-relevance:** Your thesis can use this to defend its power analysis (expect g = 0.5–0.8 for tutor-framed interventions), the study-duration question (>8 weeks matters), and its positioning ("pedagogically active, not passive tool").

---

## Literature 3 — Document-Grounded Tools & PKM

> Core question: where does this work sit in the tool landscape, and what remains unaddressed?

### 3.1 NotebookLM (Google, 2023–present) — the primary commercial competitor
- **Sources:** edu.google.com/ai-notebooklm; Google Workspace Updates (April 2026); ResearchGate evaluation (2025, DOI 10.48550/arXiv reference: 393965130)
- **Product claim:** Document-grounded Q&A, audio/video overviews, interactive mind maps, Learning Guide conversational mode, auto-generated flashcards and quizzes. Powered by LearnLM. Up to 300 sources on Education Plus.
- **Tag:** **competitor** (product, not a research paper per se)
- **Build-relevance:** The tool that occupies the most overlap with your project. **But note:** its flashcards/quizzes are auto-generated from the document (not user-highlighted), its review does not use FSRS scheduling, and there is no typed-recall-grading loop. This is the positioning that your thesis must defend. The ResearchGate potential-evaluation paper (2025) is not a rigorous RCT — treat it as product commentary. The Google "Learn Your Way" preliminary efficacy claim (+11 percentage points on long-term recall; avidopenaccess.org, 2025) is not yet peer-reviewed and uses internal comparison; cite cautiously.

### 3.2 ChatPDF, Scholar GPT, Paperpal, SciSpace, R Discovery, Paperguide, ScholarAI, AnswerThis, Scite, Elicit, Consensus
- **Sources:** Their product pages; HKUST library evaluation (2024): "Trust in AI: Evaluating Scite, Elicit, Consensus, and Scopus AI" (library.hkust.edu.hk/sc/trust-ai-lit-rev/)
- **Product claim:** Semantic search, PDF Q&A, literature-review automation, citation analysis.
- **Tag:** **competitor / adjacent**
- **Build-relevance:** None of these tools do scheduled review, retention measurement, or generative-recall grading. They are **reading-assistance tools, not retention tools**. Your thesis positioning should make this distinction sharply: "existing tools optimize document comprehension; this thesis optimizes learner retention." The HKUST evaluation shows these tools have notable reliability issues (including citing predatory journals) — cite that to motivate a more grounded design.

### 3.3 InsightGUIDE (2025) — opinionated scaffolded PDF reader
- **Citation:** InsightGUIDE: An Opinionated AI Assistant for Guided Reading. arXiv: 2509.20493 (2025)
- **Claim:** Structured-prompt LLM reader scaffolds users through academic papers with "Priority Signals" (flags for innovation, limitations, high-impact figures). Qualitative evaluation suggests interaction paradigm, not model capability, is the bottleneck.
- **Methodology:** Preliminary qualitative evaluation.
- **Tag:** **neighbor** / competitor
- **Build-relevance:** **Methodologically very close to your RESPONSE_TEMPLATE.md.** Both claim that structured prompting is the differentiator. Cite this as parallel prior art and distinguish: InsightGUIDE focuses on *reading*, your thesis focuses on *retention*. The response template is a necessary component of your thesis, not its whole contribution.

### 3.4 Google LearnLM-powered Learn Your Way (2025)
- **Sources:** learnyourway.withgoogle.com; AVID Open Access coverage (avidopenaccess.org/resource/443-a-glimpse-into-the-future-with-learn-your-way-from-google-labs/)
- **Product claim:** Adaptive study from user-uploaded PDFs. Google reports +11 percentage points on long-term recall vs. standard digital reader in internal efficacy study.
- **Tag:** competitor
- **Build-relevance:** Note in thesis that Google itself is actively building in this direction. The +11pp claim is promising but unpublished at this writing — do not rely on it as citable evidence; cite it as industry signal.

### 3.5 Anki — the SRS incumbent
- **Source:** faqs.ankiweb.net; academic evaluations in medical-education literature (Ankitects docs; cohort studies in 1.10).
- **Tag:** competitor
- **Build-relevance:** Anki is where SRS lives for serious users. Your contribution *vs. Anki* is: (a) document-grounded (no manual card creation), (b) Q&A pairs auto-generated from user highlights via LLM, (c) FSRS out-of-the-box (Anki had to add it in 23.10). Don't claim to replace Anki for vocabulary; claim complementarity for document-reading contexts.

### 3.6 PKM literature — Obsidian, Zettelkasten, "second brain"
- **Sources:** Ahrens, *How to Take Smart Notes* (2017, Sönke Ahrens — book); Forte, *Building a Second Brain* (2022 — book); community documentation.
- **Tag:** adjacent / non-research-primary
- **Build-relevance:** The PKM literature is mostly popular-press and community-documented, not peer-reviewed. Treat it as a conceptual cousin: PKM organizes knowledge for retrieval on demand; your thesis optimizes retrieval of knowledge from memory. Cite one or two popular works (Ahrens) for conceptual positioning, but do not rely on PKM as peer-reviewed evidence. The "learning graph" pivot in your VISION.md is stronger than the "knowledge graph" framing precisely because it sidesteps this literature's non-rigor.

### 3.7 Karpathy LLM-wiki (April 2026) and Graphify
- **Sources:** Karpathy blog post (April 3, 2026); Graphify GitHub (appeared April 2026).
- **Tag:** adjacent / practitioner-artifact
- **Build-relevance:** Acknowledge as practitioner context, not primary source. Karpathy's system optimizes the *document*; your thesis optimizes the *learner*. State this distinction explicitly in thesis introduction and acknowledge Karpathy's approach as an orthogonal research direction (knowledge organization) to yours (retention).

### 3.8 Duolingo production evidence
- **Source:** Settles & Meeder 2016 (entry 1.4); Duolingo engineering blogs.
- **Tag:** foundational / industry-evidence
- **Build-relevance:** Duolingo's deployed A/B tests (12% engagement gain from HLR vs. Leitner) provide industry-scale evidence that SRS tuning matters. Cite in thesis introduction as evidence of real-world impact.

---

## Literature 4 — Retention Measurement & Cognitive Foundations

> Core question: how do you evaluate a retention intervention rigorously, and what effect size should you expect?

### 4.1 Roediger & Karpicke (2006) — Test-enhanced learning
- **Citation:** Roediger, H. L., III, & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science*, 17(3), 249–255.
- **Claim:** Single test after studying yields better 1-week delayed recall than two study periods without testing. Classic demonstration of the testing effect.
- **Methodology:** Between-subjects, prose passages, immediate vs. delayed (2-day, 1-week) tests.
- **Tag:** foundational
- **Build-relevance:** Canonical citation. Already in your VISION.md. Supplement with 2.1 (Adesope meta-analysis) and 2.2 (Karpicke & Blunt) for effect sizes and methodology template.

### 4.2 Karpicke, Butler & Roediger (2009) — Metacognition of study strategies
- **Citation:** Karpicke, J. D., Butler, A. C., & Roediger, H. L., III. (2009). Metacognitive strategies in student learning: Do students practise retrieval when they study on their own? *Memory*, 17(4), 471–479.
- **Claim:** Only 11% of students report rereading+self-testing as their primary strategy; majority prefer passive rereading despite lower efficacy.
- **Methodology:** Survey of Washington University undergraduates.
- **Tag:** gap-evidence / motivation
- **Build-relevance:** Cite in the thesis motivation: students demonstrably *won't* self-test without scaffolding. A tool that surfaces scheduled retrieval is addressing a documented gap in student behavior, not just providing a convenience.

### 4.3 Bjork & Bjork (1992) / Bjork (1994) — Desirable difficulties
- **Citation:** Bjork, R. A. (1994). Memory and metamemory considerations in the training of human beings. In J. Metcalfe & A. Shimamura (Eds.), *Metacognition: Knowing about knowing*. MIT Press.
- **Claim:** Manipulations that make learning feel harder (spacing, interleaving, testing) produce better long-term retention than manipulations that make it feel easier.
- **Methodology:** Review chapter.
- **Tag:** foundational
- **Build-relevance:** Cite for the theoretical frame of "this app makes learning feel harder on purpose." Use Soderstrom & Bjork 2015 (entry 1.7) as the more modern and testable version.

### 4.4 Donoghue & Hattie (2021) — Meta-analysis (see 2.5)
- *Cross-reference.* Also belongs here for effect-size benchmarks.

### 4.5 Ebbinghaus (1885/1913) — Forgetting curve
- **Citation:** Ebbinghaus, H. (1885/1913). *Memory: A Contribution to Experimental Psychology*.
- **Claim:** Memory strength decays approximately logarithmically with time; forgetting is steepest immediately after learning.
- **Methodology:** Single-subject experiments on nonsense syllables (self).
- **Tag:** foundational
- **Build-relevance:** Historical anchor. Cite for conceptual motivation, acknowledge limits (n=1, nonsense syllables). Do not rely on for effect sizes.

### 4.6 Sweller (1988) — Cognitive load theory
- **Citation:** Sweller, J. (1988). Cognitive load during problem solving: Effects on learning. *Cognitive Science*, 12(2), 257–285.
- **Claim:** Working memory has ~4-item capacity; learning materials should minimize extraneous load, manage intrinsic load, and foster germane load.
- **Methodology:** Theoretical framework grounded in Miller (1956) + experimental validation.
- **Tag:** foundational
- **Build-relevance:** Grounds your response template's structural choices. Already in your RESPONSE_TEMPLATE.md.

### 4.7 Ausubel (1960) — Advance organizer theory
- **Citation:** Ausubel, D. P. (1960). The use of advance organizers in the learning and retention of meaningful verbal material. *Journal of Educational Psychology*, 51(5), 267–272.
- **Claim:** Presenting organizing framework before content improves retention of that content.
- **Methodology:** Between-subjects experiment.
- **Tag:** foundational
- **Build-relevance:** Grounds the "Frame" layer of your response template. Grounds the "pre-reading question priming" feature.

### 4.8 Pressley et al. (1992) — Elaborative interrogation
- **Citation:** Pressley, M., Wood, E., Woloshyn, V. E., Martin, V., King, A., & Menke, D. (1992). Encouraging mindful use of prior knowledge: Attempting to construct explanatory answers facilitates learning. *Educational Psychologist*, 27(1), 91–109.
- **Claim:** Asking learners to generate "why" explanations improves factual retention; the effect scales with prior knowledge.
- **Methodology:** Review + experimental data.
- **Tag:** foundational
- **Build-relevance:** Direct grounding for the "elaboration prompts" in your response template Layer 5.

### 4.9 Fiorella & Mayer (2015) — Generative learning
- **Citation:** Fiorella, L., & Mayer, R. E. (2015). *Learning as a generative activity: Eight learning strategies that promote understanding*. Cambridge University Press.
- **Claim:** Eight strategies (summarizing, mapping, drawing, imagining, self-testing, self-explaining, teaching, enacting) all enhance understanding by forcing the learner to generate structure rather than passively receive it.
- **Methodology:** Book-length review.
- **Tag:** foundational
- **Build-relevance:** Direct grounding for your Feynman mode feature.

### 4.10 Miller (1956) — Working memory capacity
- **Citation:** Miller, G. A. (1956). The magical number seven, plus or minus two: Some limits on our capacity for processing information. *Psychological Review*, 63(2), 81–97.
- **Claim:** Short-term memory holds ~7±2 items (now revised to ~4 chunks by Cowan 2001).
- **Methodology:** Historical review.
- **Tag:** foundational (historical)
- **Build-relevance:** Grounds "chunking" in your response template. Best paired with Cowan (2001, *Behavioral and Brain Sciences*) for the modern revised estimate of ~4 items.

### 4.11 Loewenstein (1994) — Information-gap theory of curiosity
- **Citation:** Loewenstein, G. (1994). The psychology of curiosity: A review and reinterpretation. *Psychological Bulletin*, 116(1), 75–98.
- **Claim:** Curiosity is driven by awareness of an information gap; even small gaps motivate strong engagement.
- **Methodology:** Review.
- **Tag:** foundational
- **Build-relevance:** Grounds the "Hook" layer of your response template.

### 4.12 Bjork (2011/2013) — Confidence calibration
- **Citation:** Bjork, R. A., Dunlosky, J., & Kornell, N. (2013). Self-regulated learning: Beliefs, techniques, and illusions. *Annual Review of Psychology*, 64, 417–444.
- **Claim:** Learners' confidence in their knowledge is systematically miscalibrated; fluency of retrieval leads to overconfidence.
- **Methodology:** Review.
- **Tag:** foundational / methodological
- **Build-relevance:** **Justifies the pre-grade confidence rating in your review session UI.** Capturing user confidence before Claude's grade is not just nice-to-have — it's measuring a well-documented miscalibration that your thesis can track across the study period as a secondary outcome ("calibration improvement" is a publishable finding in its own right).

### 4.13 Bakker, Theis-Mahon & Brown (2023) — Validity critique of AI research tools
- **Citation:** Bakker, C., Theis-Mahon, N., & Brown, S. J. (2023). Evaluating the Accuracy of scite, a Smart Citation Index. *Hypothesis: Research Journal for Health Information Professionals*, 35(2).
- **Claim:** Scite's citation classifications are unreliable enough to require human verification.
- **Methodology:** Evaluation study.
- **Tag:** critique / methodological
- **Build-relevance:** Cite as prior art showing AI-research-tool evaluation is a recognized subfield. Supports your thesis being legitimate scholarly work.

### 4.14 Whitfield & Hofmann (2023) — Elicit evaluation
- **Citation:** Whitfield, S., & Hofmann, M. A. (2023). Elicit: AI literature review research assistant. *Public Services Quarterly*, 19(3), 201–207.
- **Claim:** Elicit accelerates literature review tasks; quality is usable but not perfect; best as triage, not replacement.
- **Methodology:** Evaluation.
- **Tag:** methodological
- **Build-relevance:** Citation model for "how to evaluate an AI research/learning tool in a published paper." Useful if your thesis takes a similar applied-evaluation stance.

---

## Summary by Tag

**Foundational (must-cite):** 1.1, 1.4, 1.5, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11

**Methodological (how to evaluate):** 1.3, 1.7, 2.1, 2.2, 2.7, 2.9, 2.15, 2.17, 4.2, 4.12, 4.13, 4.14

**Neighbors (closest prior work — read fully):** 1.6 (KARL), 2.14 (LearnLM tech report), 2.15 (LearnLM RCT), 3.3 (InsightGUIDE)

**Competitors (tools, not research — position against):** 3.1 (NotebookLM), 3.2 (ChatPDF/Elicit etc.), 3.4 (Learn Your Way), 3.5 (Anki)

**Critiques (engage, don't ignore):** 1.10, 1.11, 2.16, 4.13

**Gap-evidence (what's NOT yet done):** 1.10 (no RCTs in academic-reading SRS), 2.15 (N=165 RCT precedent but not retention-focused), 3.2 (no retention focus in existing PDF AI tools), 4.2 (students don't self-test without scaffolding)

---

## Section 5 — Supplementary Searches (added 2026-04-16)

> Added after initial compilation to fill four specific thin spots. Four searches executed covering: (5a) peer-reviewed scholarly reading interfaces; (5b) power-analysis and sample-size planning; (5c) human–LLM grading agreement (ICC/kappa/reporting conventions); (5d) retention studies on authentic academic material. Each section's entries are numbered 5a.1, 5b.1, etc.

### 5a — Peer-reviewed scholarly reading interfaces (fills Literature 3 gap)

#### 5a.1 Lo, Chang, Head, Bragg, Zhang, Trier, Anastasiades, August, Authur, Bransom, Cachola, Candra, Chandrasekhar, Chen, Cheng, Chou, Downey, Evans, Fok, Hu, Huff, Kang, Kim, Kinney, Kittur, Kang, Klein, Lochner, Magnusson, Marsh, Murray, Naik, Nguyen, Palani, Park, Paulic, Rachatasumrit, Rao, Sayre, Shen, Siangliulue, Soldaini, Tran, van Zuylen, Wang, Wilhelm, Wu, Yang, Yoon, Zamarron, Zhang, Hearst, Weld, Downey & Chang (2023) — Semantic Reader Project overview
- **Citation:** Lo, K., et al. (2023). The Semantic Reader Project: Augmenting Scholarly Documents through AI-Powered Interactive Reading Interfaces. arXiv: 2303.14334
- **Claim:** Umbrella overview of the Semantic Reader research program — 10 interactive-reading prototypes (ScholarPhi, CiteSee, Scim, Paper Plain, Relatedly, Threddy, CiteRead, Papeos, Ocean, SciA11y) each addressing specific reading barriers; shared PaperMage + PaperCraft infrastructure.
- **Methodology:** Research-through-design; each prototype has individual evaluation (usability or small controlled study).
- **Tag:** **neighbor / competitor**
- **Build-relevance:** **This is the research program your thesis most needs to position against in Literature 3.** The Semantic Reader ecosystem is the peer-reviewed counterpart to commercial tools like ChatPDF. Your thesis should acknowledge: (a) they have solved *comprehension* problems in scholarly reading at a higher level than any commercial tool; (b) **none of them target retention** — all their interventions are in-session reading aids, not scheduled review. The retention angle remains genuinely open. Cite this paper in Chapter 2 as the definitive HCI prior work on academic-reading augmentation.

#### 5a.2 Head, Lo, Kang, Fok, Skjonsberg, Weld & Hearst (2021) — ScholarPhi
- **Citation:** Head, A., Lo, K., Kang, D., Fok, R., Skjonsberg, S., Weld, D. S., & Hearst, M. A. (2021). Augmenting Scientific Papers with Just-in-Time, Position-Sensitive Definitions of Terms and Symbols. *Proceedings of the ACM CHI Conference on Human Factors in Computing Systems (CHI '21)*. 🏆 Best Paper Award.
- **Claim:** Four novel features (position-sensitive tooltip definitions, declutter filter, equation diagrams, auto-glossary) make scientific papers more understandable. Usability study shows benefit across experience levels.
- **Methodology:** Iterative design + small-N usability evaluation.
- **Tag:** **neighbor**
- **Build-relevance:** **Methodological model for how to evaluate an in-session reading interface.** If your thesis includes a reading-assistance component (rather than pure retention study), ScholarPhi is the design-and-evaluate template. Note the study does NOT measure retention — this is where your thesis extends the literature.

#### 5a.3 August, Wang, Bragg, Hearst, Head & Lo (2023) — Paper Plain
- **Citation:** August, T., Wang, L. L., Bragg, J., Hearst, M. A., Head, A., & Lo, K. (2023). Paper Plain: Making Medical Research Papers Approachable to Healthcare Consumers with Natural Language Processing. *ACM Transactions on Computer-Human Interaction (TOCHI)*, 30(5), Article 38, 1–38. DOI: 10.1145/3589955. arXiv: 2203.00130
- **Claim:** Four NLP-enabled features (term definitions, in-situ plain-language section summaries, key question index, answer gists) make medical papers more approachable to lay readers without loss of comprehension. Four-condition between-subjects study comparing full Paper Plain, guidance-only, sections+terms-only, and PDF baseline.
- **Methodology:** Between-subjects controlled evaluation; two medical papers × four interface variants = 8 conditions; participants assigned two of the 8.
- **Tag:** **neighbor / methodological**
- **Build-relevance:** **The single most useful methodological template for a thesis user study in this space.** The 4-condition design (full tool / component-only variants / baseline) is exactly what you'd want to run. Also notable: it's published in TOCHI, a premier HCI venue — a master's thesis citing it strongly is on solid ground. Read this paper in full before drafting your study design in `03_methodology_reference.md`.

#### 5a.4 Fok, Chang, et al. (2023) — Scim (skimming support)
- **Citation:** Fok, R., Chang, J. C., et al. (2023). Scim: Intelligent Faceted Highlights for Interactive, Multi-Pass Skimming of Scientific Papers. (Via Semantic Reader Open Research Platform)
- **Claim:** AI-generated multi-color faceted highlights (by purpose: novelty, methods, results, etc.) support non-linear, multi-pass reading of scientific papers.
- **Methodology:** Prototype evaluation.
- **Tag:** neighbor
- **Build-relevance:** Worth citing as an alternative approach to AI-mediated reading. Again, not retention-focused — reinforces the gap your thesis addresses.

### 5b — Power analysis and sample-size planning (fills Literature 4 methodological gap)

#### 5b.1 Lakens (2013) — Effect sizes & power analysis primer
- **Citation:** Lakens, D. (2013). Calculating and reporting effect sizes to facilitate cumulative science: a practical primer for t-tests and ANOVAs. *Frontiers in Psychology*, 4:863. PMC3840331.
- **Claim:** Standard reference for computing Cohen's d, Hedges' g, and conducting power analyses for common experimental designs. Explicitly addresses how to plan sample size from expected effect size.
- **Methodology:** Methodological primer.
- **Tag:** **methodological**
- **Build-relevance:** **Cite as the power-analysis methodology reference for your thesis.** Pair with `jpower` (jamovi) or `G*Power` software. For a between-subjects retention study expecting Hedges' g = 0.5 (a conservative estimate from Adesope 2017), 80% power, α = .05 two-tailed, you need approximately 64 participants per group (128 total). Worked power calculations will live in `03_methodology_reference.md`.

#### 5b.2 Greving, Lenhard & Richter (2023) — Power simulation for testing-effect classroom study
- **Citation:** Greving, S., Lenhard, W., & Richter, T. (2023). The Testing Effect in University Teaching: Using Multiple-Choice Testing to Promote Retention of Highly Retrievable Information. *Teaching of Psychology*. DOI: 10.1177/00986283211061204
- **Claim:** Demonstrates a rigorous power-simulation approach for testing-effect studies in authentic university classrooms; uses generalized linear mixed models (GLMM) with parameters drawn from prior classroom studies (Greving & Richter, 2018). Finds that 1-day vs. 7-day delays and retrievability moderate effects.
- **Methodology:** Simulation-based power analysis with GLMM; authentic classroom deployment.
- **Tag:** **methodological — load-bearing**
- **Build-relevance:** **This is the study-design template most directly applicable to your thesis.** They studied retrieval practice vs. restudy using textbook chapters, with a surprise criterial test 1–7 days later. If you replace "multiple-choice practice" with "LLM-graded generative recall practice" and keep everything else, you have a defensible thesis experiment. Cite in both `03_methodology_reference.md` and Chapter 3 (methodology) of the thesis.

#### 5b.3 Kornell & Bjork (2008) + Verkoeijen et al. (2014) — High-powered replication
- **Citations:** Kornell, N., & Bjork, R. A. (2008). Learning concepts and categories: Is spacing the "enemy of induction"? *Psychological Science*, 19(6), 585–592. // Verkoeijen, P. P. J. L., et al. (2014). Is spacing really the "friend of induction"? *Frontiers in Psychology*, 5:259.
- **Claim:** Kornell & Bjork found spaced (interleaved) presentation of painting exemplars produced better inductive learning than massed; Verkoeijen et al. performed a pre-registered high-powered web-based replication with overlapping 95% CIs.
- **Methodology:** Controlled lab experiment; pre-registered replication with explicit power analysis.
- **Tag:** methodological
- **Build-relevance:** Methodological model for thinking about the *inductive learning* angle (not just rote). Cite only if your thesis claims your tool supports transfer/induction, not only retention. The Verkoeijen replication is also useful as a model for pre-registered replication design.

### 5c — Human–LLM grading agreement (fills Literature 2/4 validity gap)

#### 5c.1 Yavuz, Çelik & Yavaş Çelik (2024) — LLM essay grading with ICC reporting
- **Citation:** Yavuz, F., Çelik, Ö., & Yavaş Çelik, G. (2024). Utilizing large language models for EFL essay grading: An examination of reliability and validity in rubric-based assessments. *British Journal of Educational Technology*. DOI: 10.1111/bjet.13494
- **Claim:** Fine-tuned ChatGPT reached ICC = **0.972** with 15 experienced EFL instructor raters across 5 rubric domains; default ChatGPT ICC = 0.947; Bard ICC = 0.919. All three LLMs reached "excellent" agreement territory (ICC > 0.9). Significant overlap with human grades in specific rubric domains.
- **Methodology:** 3 student essays × 15 human raters + 2 LLMs = rigorous IRR design; analytical grading rubric with 5 domains (grammar, content, organization, style, mechanics).
- **Tag:** **methodological — load-bearing**
- **Build-relevance:** **Critical citation for defending LLM-as-grader in your thesis.** Provides concrete IRR numbers with rubric-based grading that you can benchmark against. Implementation lessons: (a) fine-tuning improves ICC; (b) analytical (multi-dimensional) rubrics give better reliability than holistic; (c) ICC is the appropriate statistic for continuous/ordinal grading scales (like your 1–5). If your thesis reports ICC ≥ 0.75 between Claude and a human grader on a subset of responses, you're in defensible territory per Koo & Li (2016) guidelines (see 5c.4).

#### 5c.2 Cole (2024) — IRR methods primer
- **Citation:** Cole, R. (2024). Inter-Rater Reliability Methods in Qualitative Case Study Research. *Sociological Methods & Research*. DOI: 10.1177/00491241231156971
- **Claim:** Review of kappa variants (Cohen's, weighted, Fleiss'), ICC, Krippendorff's alpha, Gwet's AC1 — with guidance on which to use when.
- **Methodology:** Methodological review.
- **Tag:** methodological
- **Build-relevance:** Reference for choosing the right IRR statistic. Key decision: **Cohen's kappa for categorical/binary grades; weighted kappa for ordinal scales with known distance; ICC for continuous or ordinal-treated-as-continuous.** Your 1–5 grading scale is ordinal; weighted kappa or ICC(3,1) is defensible.

#### 5c.3 Fleiss & Cohen (1973) — Equivalence of weighted kappa and ICC
- **Citation:** Fleiss, J. L., & Cohen, J. (1973). The Equivalence of Weighted Kappa and the Intraclass Correlation Coefficient as Measures of Reliability. *Educational and Psychological Measurement*, 33(3), 613–619.
- **Claim:** Quadratic-weighted kappa and ICC are mathematically equivalent under specific conditions.
- **Methodology:** Mathematical proof.
- **Tag:** methodological (classical)
- **Build-relevance:** Canonical citation to justify reporting either weighted kappa or ICC (not both redundantly).

#### 5c.4 Koo & Li (2016) — ICC selection and interpretation guidelines
- **Reference (implied from secondary sources; verify before citing):** Koo, T. K., & Li, M. Y. (2016). A guideline of selecting and reporting intraclass correlation coefficients for reliability research. *Journal of Chiropractic Medicine*, 15(2), 155–163.
- **Claim:** Provides decision framework for choosing among the 10 forms of ICC based on study design; interprets ICC < 0.5 = poor, 0.5–0.75 = moderate, 0.75–0.9 = good, > 0.9 = excellent.
- **Methodology:** Methodological guidance.
- **Tag:** methodological
- **Build-relevance:** **The interpretive threshold citation.** When your thesis reports "ICC = 0.82," cite this paper for the "good reliability" interpretation. Standard in educational-assessment IRR reporting.

### 5d — Retention studies on authentic academic material (strengthens ecological validity precedent)

#### 5d.1 Shobe (2022) — Testing effect in authentic intro psychology classroom
- **Citation:** Shobe, E. (2022). Achieving Testing Effects in an Authentic College Classroom. *Teaching of Psychology*, 49(2). DOI: 10.1177/00986283211015669
- **Claim:** Simple retrieval-practice quizzes (with *related* but not identical questions to later tests) produced testing effects in an authentic Intro Psychology course; feasible for instructors to implement.
- **Methodology:** Quasi-experimental comparison of course sections with and without retrieval practice; real students in real courses.
- **Tag:** methodological
- **Build-relevance:** Establishes that testing effects replicate in naturalistic college settings with minimal instructor overhead — the same ecological context your thesis tool targets. Cite for external validity.

#### 5d.2 Wooldridge, Bugg, McDaniel & Liu (2014) — Cautionary note on authentic material
- **Citation:** Wooldridge, C. L., Bugg, J. M., McDaniel, M. A., & Liu, Y. (2014). The testing effect with authentic educational materials: A cautionary note. *Journal of Applied Research in Memory and Cognition*, 3(3), 214–221.
- **Claim:** Testing effects that appear robust with identical-question testing may shrink or disappear with *related-but-different* final test questions — which is what really happens in classrooms.
- **Methodology:** Two experiments with college biology textbook content, N = ~338.
- **Tag:** **critique / methodological — important caveat**
- **Build-relevance:** **Engage with this paper in the thesis, don't avoid it.** It's the strongest methodological critique of lab testing-effect findings. Your thesis can sidestep the critique by: (a) using the *same* recall questions across sessions (valid but narrow), OR (b) explicitly measuring transfer with related-but-different questions (more ambitious, more defensible). Decision lives in `03_methodology_reference.md`.

#### 5d.3 Akbulut (2024) — Practice testing in authentic university classrooms
- **Citation:** Akbulut, F. D. (2024). Impact of different practice testing methods on learning outcomes. *European Journal of Education*. DOI: 10.1111/ejed.12626
- **Claim:** Comprehensive classroom study comparing multiple-choice vs. short-answer vs. mixed practice tests, immediate vs. delayed, graded vs. non-graded. Short-answer with delayed timing produced stronger retention.
- **Methodology:** Semester-long authentic university intervention across multiple conditions.
- **Tag:** methodological
- **Build-relevance:** Supports your design choice of short-answer (typed generative) over multiple-choice. Also supports delayed over immediate quizzing — aligning with FSRS scheduling.

#### 5d.4 Greving & Richter (2018) — Source study for Greving et al. 2023 power analysis
- **Citation:** Greving, S., & Richter, T. (2018). Examining the Testing Effect in University Teaching: Retrievability and Question Format Matter. *Frontiers in Psychology*, 9:2412. PMC6288371.
- **Claim:** In a real university lecture, multiple-choice testing without feedback was NOT superior to restudying; retrievability of items mattered more than testing per se.
- **Methodology:** Field study in authentic German university lecture; careful internal-validity controls.
- **Tag:** **critique / methodological**
- **Build-relevance:** A cautionary citation — not every lab-validated testing-effect intervention survives contact with real classroom conditions. Your thesis should acknowledge this: without feedback and with low-retrievability questions, testing effects can disappear. Your design should include feedback (Claude's grading output *is* feedback) and ensure questions are answerable from the source material.

#### 5d.5 Butler & Roediger (2007) — Lecture retention with short-answer vs. multiple-choice
- **Citation:** Butler, A. C., & Roediger, H. L., III. (2007). Testing improves long-term retention in a simulated classroom setting. *European Journal of Cognitive Psychology*, 19(4/5), 514–527.
- **Claim:** Short-answer testing with feedback produced the strongest 1-month retention of lecture content; multiple-choice with feedback second; lecture-summary review weakest.
- **Methodology:** Simulated classroom; 3 consecutive lectures × 3 post-lecture activity conditions; 1-month delayed short-answer final test.
- **Tag:** **foundational / methodological**
- **Build-relevance:** **Strongest single-study support for your design.** Short-answer (= generative recall) + feedback (= Claude's grading output) + 1-month delayed test = exactly your proposed thesis experiment. This single citation can ground the whole study design.

---

## Updated Summary by Tag (after supplementary searches)

**Foundational (must-cite):** 1.1, 1.4, 1.5, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5d.5

**Methodological (how to evaluate):** 1.3, 1.7, 2.1, 2.2, 2.7, 2.9, 2.15, 2.17, 4.2, 4.12, 4.13, 4.14, 5a.3, 5b.1, 5b.2, 5c.1, 5c.2, 5c.3, 5c.4, 5d.1, 5d.2, 5d.3, 5d.4, 5d.5

**Neighbors (closest prior work — read fully):** 1.6 (KARL), 2.14 (LearnLM tech report), 2.15 (LearnLM RCT), 3.3 (InsightGUIDE), 5a.1 (Semantic Reader overview), 5a.2 (ScholarPhi), 5a.3 (Paper Plain)

**Competitors (tools, not research — position against):** 3.1 (NotebookLM), 3.2 (ChatPDF/Elicit etc.), 3.4 (Learn Your Way), 3.5 (Anki)

**Critiques (engage, don't ignore):** 1.10, 1.11, 2.16, 4.13, 5d.2, 5d.4

**Gap-evidence (what's NOT yet done):** 1.10, 2.15, 3.2, 4.2

---

## What's NOT yet mapped (remaining gaps after supplementary searches)

The supplementary searches closed the four critical gaps. What remains is truly out-of-scope for Tier 1:

- **Latency / response-time as a learning metric** — relevant for instrumentation design but not thesis-critical.
- **Adaptive testing / IRT applied to SRS** — a potential future direction, not Tier 1.
- **Deep reading comprehension research (Graesser, McNamara, Kintsch)** — relevant if the thesis adds a comprehension arm; currently retention-focused.
- **Qualitative UX evaluation methods for AI tools** — relevant if the thesis adds a qualitative component.

None of these gaps block Stage 1A or Step 2 (gap analysis). They are flagged for Step 3 (methodology reference) if the study design expands beyond quantitative retention outcomes.

---

## Immediate next-step reading list (before Stage 1A)

Read in this order; budget 3–4 focused days (updated after supplementary searches):

1. **Shu et al. 2024 (KARL)** — entry 1.6. Full paper. This most changes your contribution claim.
2. **August et al. 2023 (Paper Plain)** — entry 5a.3. **Strongest methodological template** for your user study design.
3. **Butler & Roediger 2007** — entry 5d.5. Single-study model for short-answer + feedback + 1-month delayed retention.
4. **Greving, Lenhard & Richter 2023** — entry 5b.2. Authentic-classroom power analysis + GLMM study design template.
5. **Ferrer et al. 2026 (LLM grader calibration)** — entry 2.9. Dictates your grading-confidence implementation.
6. **Yavuz et al. 2024 (LLM essay grading ICC)** — entry 5c.1. Benchmark ICC numbers you'll want to beat or match.
7. **Grevisse 2024 (LLM ASAG medical)** — entry 2.7. Dictates your rubric design.
8. **Karpicke & Blunt 2011** — entry 2.2. Your evaluation-study methodology model.
9. **Jurenka et al. 2024 (LearnLM)** — entry 2.14. Validates (and competes with) your response template.
10. **LearnLM RCT Nov 2025** — entry 2.15. Your study-design precedent.
11. **Adesope et al. 2017 meta-analysis** — entry 2.1. For power analysis.
12. **Lo et al. 2023 (Semantic Reader overview)** — entry 5a.1. Chapter 2 positioning.

Everything else can be read during thesis drafting, not before implementation.
