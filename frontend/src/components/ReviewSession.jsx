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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { fetchDueCards, submitReview } from '../api/review'
import './ReviewSession.css'

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
      {value > 0 && (
        <span className="rv-confidence-hint">{labels[value]}</span>
      )}
    </div>
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
    return (
      <div className="rv-overlay">
        {renderHeader()}
        <div className="rv-card-wrap" onKeyDown={handleKeyDown}>
          {/* Source passage context */}
          {card.highlight_text && (
            <div className="rv-source">
              <span className="rv-source-label">Source passage</span>
              <p className="rv-source-text">{card.highlight_text}</p>
              {card.section_title && (
                <span className="rv-source-meta">{card.section_title}{card.page_number ? ` · p. ${card.page_number}` : ''}</span>
              )}
            </div>
          )}

          {/* Question */}
          <div className="rv-question">{card.question}</div>

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

          <button
            className={`rv-btn rv-btn--primary rv-submit ${!canSubmit ? 'rv-btn--disabled' : ''}`}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? 'Grading…' : 'Submit'}
          </button>
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
