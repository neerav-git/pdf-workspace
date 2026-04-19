/**
 * ReviewSession — dedicated full-screen review UI (Research D1-D5)
 *
 * Per-card flow (3 phases):
 *   Phase 1 "recall"  — Source passage shown, answer hidden. User types recall
 *                       + sets confidence rating. Both submitted in ONE call
 *                       BEFORE the grade is revealed. (Research D2 — methodologically
 *                       non-negotiable: if user sees grade first, calibration data is invalid.)
 *   Phase 2 "graded"  — Grade + 3-dim scores + feedback + correct answer revealed.
 *                       Next-card or finish controls.
 *   Phase 3 "done"    — Session complete. Stats + return button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { fetchDueCards, submitReview } from '../api/review'
import './ReviewSession.css'

// ── Text cleaning ─────────────────────────────────────────────────────────────

/**
 * Remove PDF hyphenation artifacts (word-\nwrap → wordwrap) and normalize
 * whitespace so the passage reads naturally in the review session.
 */
function cleanHighlightText(text) {
  return text
    .replace(/-\r?\n/g, '')   // de-hyphenate line breaks: "treat-\nments" → "treatments"
    .replace(/\s+/g, ' ')     // collapse runs of whitespace/newlines to single space
    .trim()
}

// ── Action Q&A detection ──────────────────────────────────────────────────────
// Mirrors ACTION_MAP in HighlightIndex — kept in sync manually.
// When "Quiz Me" fires from the hover menu, the raw prompt is stored as qa.question.
// Claude's actual generated question+answer is in qa.answer.
// For review, we extract the question portion from qa.answer so the user sees
// a real question, not a prompt string.

const ACTION_PREFIXES = [
  { prefix: 'Create a quiz question',   type: 'quiz'      },
  { prefix: 'Explain this passage',     type: 'explain'   },
  { prefix: 'Explain this in simple',   type: 'simplify'  },
  { prefix: 'Identify and define',      type: 'terms'     },
  { prefix: 'Summarise this passage',   type: 'summarise' },
]

function detectActionType(question) {
  for (const a of ACTION_PREFIXES) {
    if (question?.startsWith(a.prefix)) return a.type
  }
  return 'manual'
}

/**
 * For Quiz Me Q&As, try to extract the actual question from Claude's answer.
 * Claude typically formats these as:
 *   **Question:** <question text>\n\n**Answer:** <answer text>
 * Returns null if no structured question can be found — caller shows a generic prompt.
 */
function extractQuizQuestion(answer) {
  if (!answer) return null
  // Markdown bold pattern: **Question:** ... **Answer:**
  const boldMatch = answer.match(/\*\*[Qq]uestion:\*\*\s*([\s\S]+?)(?:\n\n\*\*[Aa]nswer:|$)/i)
  if (boldMatch) {
    const q = boldMatch[1].trim()
    if (q.length > 5) return q
  }
  // Plain pattern: Question: ...
  const plainMatch = answer.match(/^[Qq]uestion:\s*(.+)/m)
  if (plainMatch) {
    const q = plainMatch[1].trim()
    if (q.length > 5) return q
  }
  // Only use the first line as a fallback if it looks like an actual question
  // (ends with ? or starts with a question word — avoid showing answer text as the question)
  const firstLine = answer.split('\n').find((l) => l.trim())?.trim()
  const QUESTION_WORDS = /^(what|who|where|when|why|how|which|describe|explain|name|list)/i
  if (firstLine && (firstLine.endsWith('?') || QUESTION_WORDS.test(firstLine))) {
    return firstLine
  }
  return null
}

/**
 * Returns the display question for a review card.
 * - Manual Q&A: return question text directly
 * - Quiz Me: extract question from the answer field
 * - Other actions (explain, simplify, terms, summarise): return null
 *   (caller should show a generic recall prompt instead)
 */
function resolveDisplayQuestion(card) {
  const type = detectActionType(card.question)
  if (type === 'manual') return { question: card.question, isAction: false, actionType: null }
  if (type === 'quiz') {
    const extracted = extractQuizQuestion(card.answer)
    return { question: extracted, isAction: true, actionType: 'quiz' }
  }
  // explain / simplify / terms / summarise — no specific question to show
  return { question: null, isAction: true, actionType: type }
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function ScoreDot({ score }) {
  const colors = ['', '#e05252', '#e08c3a', '#d4c44a', '#70b86c', '#3a9e6c']
  return (
    <span
      className="rv-score-dot"
      style={{ background: colors[score] || '#555' }}
      title={`${score}/5`}
    >
      {score}
    </span>
  )
}

function DimRow({ label, score, rationale }) {
  return (
    <div className="rv-dim-row">
      <ScoreDot score={score} />
      <span className="rv-dim-label">{label}</span>
      <span className="rv-dim-rationale">{rationale}</span>
    </div>
  )
}

function ConfidenceRating({ value, onChange }) {
  const labels = ['', 'Guessing', 'Unsure', 'Somewhat sure', 'Confident', 'Certain']
  return (
    <div className="rv-confidence">
      <span className="rv-confidence-label">Confidence</span>
      <div className="rv-confidence-scale">
        <div className="rv-confidence-options">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={`rv-conf-btn ${value === n ? 'rv-conf-btn--active' : ''}`}
              onClick={() => onChange(n)}
              title={labels[n]}
              type="button"
            >
              {n}
            </button>
          ))}
        </div>
        <div className="rv-confidence-endpoints">
          <span className="rv-conf-endpoint rv-conf-endpoint--hard">Hard</span>
          <span className="rv-conf-endpoint rv-conf-endpoint--easy">Easy</span>
        </div>
      </div>
      {value > 0 && (
        <span className="rv-confidence-hint">{labels[value]}</span>
      )}
    </div>
  )
}

// ── Review mode toggle ────────────────────────────────────────────────────────

function ReviewModeToggle({ mode, onChange }) {
  return (
    <div className="rv-mode-toggle-wrap">
      <div className="rv-mode-toggle">
        <button
          className={`rv-mode-btn ${mode === 'concept' ? 'rv-mode-btn--active' : ''}`}
          onClick={() => onChange('concept')}
          type="button"
        >
          Concept
        </button>
        <button
          className={`rv-mode-btn ${mode === 'detail' ? 'rv-mode-btn--active' : ''}`}
          onClick={() => onChange('detail')}
          type="button"
        >
          Detail
        </button>
      </div>
      <span
        className="rv-mode-info"
        title="Concept: full passage shown — test your understanding of the idea&#10;Detail: key words hidden — test your recall of specific facts"
      >
        ⓘ
      </span>
    </div>
  )
}

// ── Cloze passage (Detail mode) ───────────────────────────────────────────────
// Deterministically masks ~30% of content words (length ≥ 4, non-numeric).
// Every 3rd content word is masked, starting at index 0.
// Click a masked word to reveal it persistently; click again to re-mask.

function ClozePassage({ text }) {
  const [revealed, setRevealed] = useState(new Set())

  const tokens = useMemo(() => {
    const result = []
    const regex = /(\b[a-zA-Z]\w*\b)|([^a-zA-Z]+)/g
    let contentIdx = 0
    let m
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) {
        const word = m[1]
        const maskable = word.length >= 4
        const masked = maskable && contentIdx % 3 === 0
        if (maskable) contentIdx++
        result.push({ type: 'word', text: word, masked, id: result.length })
      } else {
        result.push({ type: 'gap', text: m[2] })
      }
    }
    return result
  }, [text])

  const toggle = (id) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  return (
    <p className="rv-source-text rv-source-text--cloze">
      {tokens.map((tok, i) => {
        if (tok.type === 'gap') return tok.text
        if (!tok.masked) return <span key={i}>{tok.text}</span>
        const isRevealed = revealed.has(tok.id)
        return (
          <span
            key={i}
            className={`rv-masked-word${isRevealed ? ' rv-masked-word--revealed' : ''}`}
            onClick={() => toggle(tok.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(tok.id)}
            title={isRevealed ? 'Click to re-mask' : 'Click to reveal'}
            aria-label={isRevealed ? tok.text : 'masked word'}
          >
            {tok.text}
          </span>
        )
      })}
    </p>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReviewSession() {
  const { reviewScope, closeReview } = useAppStore()

  const [cards, setCards]         = useState([])
  const [idx, setIdx]             = useState(0)
  const [phase, setPhase]         = useState('loading') // loading|recall|graded|done|empty
  const [recallText, setRecallText] = useState('')
  const [confidence, setConfidence] = useState(0)
  const [gradeResult, setGradeResult] = useState(null)
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]         = useState(null)
  // null = use card-type default; 'concept' | 'detail' = user override
  const [reviewMode, setReviewMode] = useState(null)

  const cardShownAt = useRef(null)
  const textareaRef = useRef(null)

  // Load cards on mount — either pre-loaded or fetched by scope
  useEffect(() => {
    if (reviewScope?.cards) {
      // Pre-loaded single-card review (from per-card "Review now" button)
      if (!reviewScope.cards.length) {
        setPhase('empty')
      } else {
        setCards(reviewScope.cards)
        setPhase('recall')
        cardShownAt.current = Date.now()
      }
      return
    }
    const pdfId = reviewScope?.pdfId || null
    fetchDueCards(pdfId)
      .then((data) => {
        if (!data.length) {
          setPhase('empty')
        } else {
          setCards(data)
          setPhase('recall')
          cardShownAt.current = Date.now()
        }
      })
      .catch(() => setError('Could not load review cards.'))
  }, [reviewScope])

  // Auto-focus textarea when entering recall phase
  useEffect(() => {
    if (phase === 'recall') {
      cardShownAt.current = Date.now()
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [phase, idx])

  const card = cards[idx]

  const handleSubmit = useCallback(async () => {
    if (submitting || !recallText.trim() || confidence === 0) return
    setSubmitting(true)
    setError(null)
    const latency = cardShownAt.current ? Date.now() - cardShownAt.current : null
    try {
      const result = await submitReview({
        qa_pair_id: card.id,
        recall_text: recallText.trim(),
        confidence_rating: confidence,
        recall_latency_ms: latency,
      })
      setGradeResult(result)
      setPhase('graded')
    } catch (e) {
      setError('Grading failed. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }, [card, recallText, confidence, submitting])

  const handleNext = useCallback(() => {
    const next = idx + 1
    if (next >= cards.length) {
      setPhase('done')
    } else {
      setIdx(next)
      setRecallText('')
      setConfidence(0)
      setGradeResult(null)
      setReviewMode(null) // reset to card-type default for each new card
      setPhase('recall')
    }
  }, [idx, cards.length])

  // Keyboard: Ctrl+Enter to submit in recall phase
  const handleKeyDown = (e) => {
    if (phase === 'recall' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const renderHeader = () => (
    <div className="rv-header">
      <span className="rv-brand">Review Session</span>
      {cards.length > 0 && phase !== 'done' && phase !== 'empty' && (
        <span className="rv-progress">
          {idx + 1} / {cards.length}
        </span>
      )}
      <button className="rv-close" onClick={closeReview} title="Exit review">
        ✕
      </button>
    </div>
  )

  if (phase === 'loading') {
    return (
      <div className="rv-overlay">
        {renderHeader()}
        <div className="rv-center rv-muted">Loading cards…</div>
      </div>
    )
  }

  if (phase === 'empty') {
    return (
      <div className="rv-overlay">
        {renderHeader()}
        <div className="rv-center">
          <div className="rv-empty-icon">✓</div>
          <div className="rv-empty-title">Nothing due right now</div>
          <div className="rv-muted" style={{ marginTop: 8 }}>
            {reviewScope?.pdfId
              ? 'All cards for this document are up to date.'
              : 'All your cards are up to date. Come back later.'}
          </div>
          <button className="rv-btn rv-btn--primary" style={{ marginTop: 32 }} onClick={closeReview}>
            Back to reading
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="rv-overlay">
        {renderHeader()}
        <div className="rv-center">
          <div className="rv-empty-icon">🎉</div>
          <div className="rv-empty-title">Session complete</div>
          <div className="rv-muted" style={{ marginTop: 8 }}>
            Reviewed {cards.length} card{cards.length !== 1 ? 's' : ''}.
          </div>
          <button className="rv-btn rv-btn--primary" style={{ marginTop: 32 }} onClick={closeReview}>
            Back to reading
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'recall') {
    const canSubmit = recallText.trim().length > 0 && confidence > 0 && !submitting
    const { question: displayQuestion, isAction, actionType } = resolveDisplayQuestion(card)

    // Default mode: quiz cards → detail (cloze), everything else → concept (full)
    const defaultMode = detectActionType(card.question) === 'quiz' ? 'detail' : 'concept'
    const effectiveMode = reviewMode ?? defaultMode

    // Action type labels for the badge shown when we can't show a raw question
    const ACTION_LABELS = {
      explain: 'Explain', simplify: 'Simplify', terms: 'Key Terms', summarise: 'Summarise',
    }

    // Action-specific recall prompts (Fix 18)
    const ACTION_PROMPTS = {
      explain:   'What does this passage mean in your own words?',
      simplify:  'Explain this as simply as possible — no jargon.',
      terms:     'What are the key terms here and what do they mean?',
      summarise: 'Summarise this passage from memory in 2–3 sentences.',
    }

    return (
      <div className="rv-overlay">
        {renderHeader()}
        <div className="rv-card-wrap" onKeyDown={handleKeyDown}>
          {/* Source passage context — show the user's specific selection, not the full chunk.
              Clean PDF hyphenation artifacts (treat-\nments → treatments) for readability. */}
          {card.highlight_text && (
            <div className="rv-source">
              <div className="rv-source-header">
                <span className="rv-source-label">Source passage</span>
                <ReviewModeToggle mode={effectiveMode} onChange={setReviewMode} />
              </div>
              {effectiveMode === 'detail'
                ? <ClozePassage text={cleanHighlightText(card.highlight_text)} />
                : <p className="rv-source-text">{cleanHighlightText(card.highlight_text)}</p>
              }
              {card.section_title && (
                <span className="rv-source-meta">{card.section_title}{card.page_number ? ` · p. ${card.page_number}` : ''}</span>
              )}
            </div>
          )}

          {/* Question — use extracted question for Quiz Me; generic prompt for other actions */}
          {displayQuestion
            ? <div className="rv-question">{displayQuestion}</div>
            : (
              <div className="rv-question rv-question--action">
                {isAction && actionType && (
                  <span className={`rv-action-badge rv-action-${actionType}`}>
                    {ACTION_LABELS[actionType] || actionType}
                  </span>
                )}
                <span className="rv-question-generic">
                  {(isAction && actionType && ACTION_PROMPTS[actionType]) || 'What do you recall about this passage?'}
                </span>
              </div>
            )
          }

          {/* Confidence + recall — both submitted together (Research D2) */}
          <ConfidenceRating value={confidence} onChange={setConfidence} />

          <div className="rv-recall-wrap">
            <label className="rv-recall-label">Your answer (from memory)</label>
            <textarea
              ref={textareaRef}
              className="rv-recall-input"
              value={recallText}
              onChange={(e) => setRecallText(e.target.value)}
              placeholder="Write what you remember. Don't look it up."
              rows={6}
            />
            <div className="rv-recall-hint">⌘↵ to submit</div>
          </div>

          {error && <div className="rv-error">{error}</div>}

          <div className="rv-submit-row">
            {!canSubmit && !submitting && (
              <span className="rv-submit-hint">
                {confidence === 0 && recallText.trim().length === 0
                  ? 'Write your answer and set confidence'
                  : confidence === 0
                  ? 'Set a confidence rating to submit'
                  : 'Write your answer to submit'}
              </span>
            )}
            <button
              className={`rv-btn rv-btn--primary rv-submit ${!canSubmit ? 'rv-btn--disabled' : ''}`}
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {submitting ? 'Grading…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'graded' && gradeResult) {
    const g = gradeResult
    const overallColor = ['', '#e05252', '#e08c3a', '#d4c44a', '#70b86c', '#3a9e6c'][g.overall_score] || '#888'
    const nextLabel = idx + 1 < cards.length ? 'Next card →' : 'Finish session'

    return (
      <div className="rv-overlay">
        {renderHeader()}
        <div className="rv-card-wrap">
          {/* Overall grade */}
          <div className="rv-grade-banner" style={{ borderColor: overallColor }}>
            <span className="rv-grade-score" style={{ color: overallColor }}>
              {g.overall_score}/5
            </span>
            <span className="rv-grade-label">overall</span>
            <span className="rv-grade-conf rv-muted">Claude confidence: {g.claude_confidence}/5</span>
          </div>

          {/* 3 dimension scores */}
          <div className="rv-dims">
            <DimRow label="Core claim"       score={g.core_claim.score}       rationale={g.core_claim.rationale} />
            <DimRow label="Supporting detail" score={g.supporting_detail.score} rationale={g.supporting_detail.rationale} />
            <DimRow label="Faithfulness"     score={g.faithfulness.score}     rationale={g.faithfulness.rationale} />
          </div>

          {/* Feedback */}
          <div className="rv-feedback">
            <span className="rv-feedback-label">Feedback</span>
            <p>{g.feedback}</p>
          </div>

          {/* What you missed */}
          {g.missing?.length > 0 && (
            <div className="rv-chips-section">
              <span className="rv-chips-label">Concepts to strengthen</span>
              <div className="rv-chips">
                {g.missing.map((m, i) => (
                  <span key={i} className="rv-chip rv-chip--miss">{m}</span>
                ))}
              </div>
            </div>
          )}

          {/* What you got right */}
          {g.rubric_hits?.length > 0 && (
            <div className="rv-chips-section">
              <span className="rv-chips-label">What you got right</span>
              <div className="rv-chips">
                {g.rubric_hits.map((h, i) => (
                  <span key={i} className="rv-chip rv-chip--hit">{h}</span>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="rv-divider" />

          {/* Correct answer */}
          <div className="rv-correct-answer">
            <span className="rv-correct-label">Correct answer</span>
            <div className="rv-correct-text">{g.expected_answer}</div>
          </div>

          {/* Next review */}
          <div className="rv-next-review rv-muted">
            Next review: {formatDue(g.due_at)} · New stability: {g.new_stability.toFixed(1)} days
          </div>

          {/* Navigation */}
          <div className="rv-nav-row">
            <button className="rv-btn rv-btn--primary" onClick={handleNext}>
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ── Util ──────────────────────────────────────────────────────────────────────

function formatDue(dueDateStr) {
  if (!dueDateStr) return 'soon'
  const due = new Date(dueDateStr)
  const now = new Date()
  const diffMs = due - now
  const diffMin = Math.round(diffMs / 60000)
  const diffHr  = Math.round(diffMs / 3600000)
  const diffDay = Math.round(diffMs / 86400000)
  if (diffMin < 2)   return 'in a moment'
  if (diffMin < 60)  return `in ${diffMin} min`
  if (diffHr  < 24)  return `in ${diffHr}h`
  if (diffDay === 1) return 'tomorrow'
  if (diffDay <= 30) return `in ${diffDay} days`
  return due.toLocaleDateString()
}
