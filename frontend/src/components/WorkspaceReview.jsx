import { useEffect, useMemo, useState } from 'react'
import { fetchDueCards, fetchReviewStats } from '../api/review'
import { fetchHighlights } from '../api/highlights'
import { normalizeEntry, normalizeQuestionContext, useAppStore } from '../store'
import { EmptyWorkspace, Metric, SessionNavigator, useActiveSession } from './WorkspaceIndex'
import './WorkspacePages.css'

const FACET_LABELS = {
  objective: 'Objective',
  novelty: 'Novelty',
  method: 'Method',
  result: 'Result',
  background: 'Background',
  uncategorized: 'Uncategorized',
}

const REVIEW_QUEUE_VIEWS = [
  { id: 'due', label: 'Due now' },
  { id: 'concept', label: 'By concept' },
  { id: 'section', label: 'By section' },
  { id: 'context', label: 'Context-rich only' },
  { id: 'repair', label: 'Needs repair' },
]

export default function WorkspaceReview() {
  const { researchSessions, selectedPdf, selectPdf, openReview } = useAppStore()
  const activeSession = useActiveSession(researchSessions, selectedPdf)
  const [selectedSessionId, setSelectedSessionId] = useState(activeSession?.id || null)
  const [rawDueCards, setRawDueCards] = useState([])
  const [sessionEntriesByPdf, setSessionEntriesByPdf] = useState({})
  const [stats, setStats] = useState(null)
  const [queueView, setQueueView] = useState('due')
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [scratchAnswer, setScratchAnswer] = useState({})
  const [showSourceContext, setShowSourceContext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [entryLoading, setEntryLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (activeSession?.id) setSelectedSessionId(activeSession.id)
    else if (!selectedSessionId && researchSessions[0]?.id) setSelectedSessionId(researchSessions[0].id)
  }, [activeSession?.id, researchSessions, selectedSessionId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchDueCards(null, 100), fetchReviewStats()])
      .then(([cards, reviewStats]) => {
        if (cancelled) return
        setRawDueCards(cards)
        setStats(reviewStats)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load review queues')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const selectedSession = researchSessions.find((session) => session.id === selectedSessionId) || activeSession || researchSessions[0] || null

  useEffect(() => {
    if (!selectedSession?.pdfs?.length) {
      setSessionEntriesByPdf({})
      return
    }
    let cancelled = false
    setEntryLoading(true)
    Promise.all(
      (selectedSession.pdfs || []).map(async (pdf) => {
        const rows = await fetchHighlights(pdf.id)
        return [pdf.id, rows.map((row) => normalizeEntry(row, pdf.title))]
      }),
    )
      .then((pairs) => {
        if (cancelled) return
        setSessionEntriesByPdf(Object.fromEntries(pairs))
      })
      .catch(() => {
        if (!cancelled) setSessionEntriesByPdf({})
      })
      .finally(() => {
        if (!cancelled) setEntryLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedSession?.id])

  const selectedSessionPdfIds = new Set((selectedSession?.pdfs || []).map((pdf) => pdf.id))
  const sessionCards = useMemo(
    () => rawDueCards
      .filter((card) => selectedSessionPdfIds.has(card.pdf_id))
      .map((card) => enrichDueCard(card, sessionEntriesByPdf[card.pdf_id] || [])),
    [rawDueCards, selectedSessionPdfIds, sessionEntriesByPdf],
  )

  const queueGroups = useMemo(() => buildQueueGroups(sessionCards, queueView), [sessionCards, queueView])
  const selectedCard = useMemo(
    () => sessionCards.find((card) => card.id === selectedCardId) || queueGroups[0]?.cards?.[0] || null,
    [queueGroups, selectedCardId, sessionCards],
  )

  useEffect(() => {
    if (selectedCard?.id) {
      setSelectedCardId(selectedCard.id)
    } else {
      setSelectedCardId(null)
    }
  }, [selectedCard?.id])

  useEffect(() => {
    setShowSourceContext(false)
  }, [selectedCard?.id])

  const facetCounts = countBy(sessionCards, (card) => card.rhetoricalFacet || 'uncategorized')
  const relatedEntries = useMemo(() => getRelatedEntries(selectedCard, sessionEntriesByPdf), [selectedCard, sessionEntriesByPdf])
  const conceptTrailTarget = useMemo(() => findNextTrailCard(sessionCards, selectedCard, 'concept'), [sessionCards, selectedCard])
  const sectionTrailTarget = useMemo(() => findNextTrailCard(sessionCards, selectedCard, 'section'), [sessionCards, selectedCard])

  const handleSelectCard = async (card) => {
    setSelectedCardId(card.id)
    const pdf = (selectedSession?.pdfs || []).find((item) => item.id === card.pdfId)
    if (pdf && selectedPdf?.id !== pdf.id) {
      await selectPdf(pdf)
    }
  }

  const handleTrail = async (targetCard) => {
    if (!targetCard) return
    await handleSelectCard(targetCard)
  }

  return (
    <div className="workspace-grid-page">
      <SessionNavigator
        sessions={researchSessions}
        selectedSession={selectedSession}
        selectedPdf={selectedPdf}
        onSelectSession={setSelectedSessionId}
        onSelectPdf={selectPdf}
      />

      <main className="workspace-main-surface">
        <header className="workspace-page-title">
          <span>Full-Page Review</span>
          <h1>Study Queues</h1>
          <p>
            Review due cards by session, concept, section, and grounding quality. The grading interaction remains the same recall-first review overlay.
          </p>
        </header>

        <div className="workspace-stat-strip">
          <Metric label="All due now" value={String(stats?.due_now ?? rawDueCards.length)} />
          <Metric label="Session due" value={String(sessionCards.length)} />
          <Metric label="Context-rich" value={String(sessionCards.filter((card) => card.isContextRich).length)} />
          <Metric label="Needs repair" value={String(sessionCards.filter((card) => card.needsRepair).length)} />
        </div>

        <section className="workspace-review-actions">
          <button type="button" onClick={() => openReview(null)} disabled={!rawDueCards.length}>
            Review All Due
          </button>
          <button type="button" onClick={() => openReview({ cards: sessionCards.map((card) => card.raw) })} disabled={!sessionCards.length}>
            Review This Session
          </button>
          <button
            type="button"
            onClick={() => selectedPdf && openReview({ pdfId: selectedPdf.id })}
            disabled={!selectedPdf || !sessionCards.some((card) => card.pdfId === selectedPdf.id)}
          >
            Review Selected Paper
          </button>
        </section>

        {loading && <EmptyWorkspace title="Loading review queues" body="Collecting due cards across sessions and papers." />}
        {error && <EmptyWorkspace title="Review data unavailable" body={error} />}
        {!loading && !error && (
          <>
            <section className="workspace-index-toolbar">
              <div className="workspace-chip-row">
                {REVIEW_QUEUE_VIEWS.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    className={`workspace-chip ${queueView === view.id ? 'active' : ''}`}
                    onClick={() => setQueueView(view.id)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
              <div className="workspace-review-toolbar-meta">
                <span>{selectedSession?.title || 'No session selected'}</span>
                <small>{entryLoading ? 'Refreshing related index material…' : 'Queue preview uses saved index context and the due-card contract.'}</small>
              </div>
            </section>

            <div className="workspace-review-deep-layout">
              <section className="workspace-content-card workspace-review-queue-card">
                <div className="workspace-card-header">
                  <h2>Session Queue</h2>
                  <span>{REVIEW_QUEUE_VIEWS.find((view) => view.id === queueView)?.label || 'Queue'} · {queueGroups.reduce((sum, group) => sum + group.cards.length, 0)} card{queueGroups.reduce((sum, group) => sum + group.cards.length, 0) === 1 ? '' : 's'}</span>
                </div>
                {!queueGroups.length ? (
                  <EmptyWorkspace title="No cards match this queue view" body="Try another view, or wait until more cards become due." />
                ) : (
                  <div className="workspace-review-group-list">
                    {queueGroups.map((group) => (
                      <section key={group.key} className="workspace-review-group">
                        <div className="workspace-review-group-header">
                          <div>
                            <h3>{group.label}</h3>
                            {group.description && <p>{group.description}</p>}
                          </div>
                          <strong>{group.cards.length}</strong>
                        </div>
                        <div className="workspace-review-card-list">
                          {group.cards.map((card) => (
                            <button
                              key={card.id}
                              type="button"
                              className={`workspace-review-select ${selectedCard?.id === card.id ? 'active' : ''}`}
                              onClick={() => handleSelectCard(card)}
                            >
                              <div className="workspace-review-select-meta">
                                <span>{card.locationLabel}</span>
                                <strong>{card.reviewStateLabel}</strong>
                              </div>
                              <h4>{card.displayQuestion}</h4>
                              {card.questionContext?.contextSummary && (
                                <p>{card.questionContext.contextSummary}</p>
                              )}
                              <div className="workspace-review-select-badges">
                                <span className="workspace-pill workspace-pill--muted">{FACET_LABELS[card.rhetoricalFacet || 'uncategorized']}</span>
                                <span className="workspace-pill workspace-pill--muted">{card.cardType}</span>
                                {card.primaryConcept && <span className="workspace-pill">{card.primaryConcept}</span>}
                                {card.needsRepair && <span className="workspace-pill workspace-pill--repair">Needs repair</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </section>

              <section className="workspace-content-card workspace-review-study-card">
                {selectedCard ? (
                  <div className="workspace-review-study-pane">
                    <div className="workspace-card-header">
                      <h2>Study Card</h2>
                      <span>{selectedCard.locationLabel}</span>
                    </div>

                    <div className="workspace-review-question">
                      <div className="workspace-index-badge-row">
                        <span className="workspace-context-badge workspace-context-badge--highlight">{selectedCard.cardTypeLabel}</span>
                        <span className="workspace-context-badge workspace-context-badge--intent">{selectedCard.intentLabel}</span>
                        {selectedCard.needsRepair && <span className="workspace-context-badge workspace-context-badge--repair">Needs context</span>}
                      </div>
                      <h3>{selectedCard.displayQuestion}</h3>
                      <p>{selectedCard.locationLabel}</p>
                    </div>

                    <div className="workspace-review-context-panel">
                      <div className="workspace-card-minihead">
                        <span>Question context</span>
                        <small>{selectedCard.questionContext?.contextStatus || 'weak'}</small>
                      </div>
                      <p>{selectedCard.questionContext?.contextSummary || 'No context summary was available for this card.'}</p>
                    </div>

                    <div className="workspace-review-context-panel">
                      <div className="workspace-card-minihead">
                        <span>Why this matters</span>
                        <small>{selectedCard.reviewStateLabel}</small>
                      </div>
                      <p>{buildWhyThisMatters(selectedCard)}</p>
                    </div>

                    <div className="workspace-review-context-panel">
                      <div className="workspace-card-minihead">
                        <span>Source context</span>
                        <div className="workspace-inline-actions">
                          <button type="button" onClick={() => setShowSourceContext((prev) => !prev)}>
                            {showSourceContext ? 'Hide passage' : 'Show passage'}
                          </button>
                          <button type="button" onClick={() => openReview({ cards: [selectedCard.raw] })}>
                            Start graded review
                          </button>
                        </div>
                      </div>
                      {showSourceContext ? (
                        <p>{selectedCard.sourcePreview || 'No source passage available.'}</p>
                      ) : (
                        <p className="workspace-muted">Keep this hidden for recall-first study, or reveal it when you need grounding before grading.</p>
                      )}
                    </div>

                    <div className="workspace-review-answer">
                      <div className="workspace-card-minihead">
                        <span>Answer area</span>
                        <small>Scratchpad only</small>
                      </div>
                      <textarea
                        value={scratchAnswer[selectedCard.id] || ''}
                        onChange={(e) => setScratchAnswer((prev) => ({ ...prev, [selectedCard.id]: e.target.value }))}
                        placeholder="Draft your answer, capture the gist, or note what still feels weak before starting the graded review."
                      />
                    </div>

                    <div className="workspace-review-related-grid">
                      <div className="workspace-review-related-card">
                        <div className="workspace-card-minihead">
                          <span>Related indexed items</span>
                          <small>{relatedEntries.length}</small>
                        </div>
                        {relatedEntries.length ? (
                          <div className="workspace-related-list">
                            {relatedEntries.map((entry) => (
                              <div key={entry.id} className="workspace-related-item">
                                <strong>{getReviewEntryTitle(entry)}</strong>
                                <p>{truncate(entry.highlightText, 160)}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="workspace-muted">No related indexed items were found for this card yet.</p>
                        )}
                      </div>

                      <div className="workspace-review-related-card">
                        <div className="workspace-card-minihead">
                          <span>Study trails</span>
                          <small>Stay in the same thread</small>
                        </div>
                        <div className="workspace-trail-buttons">
                          <button type="button" onClick={() => handleTrail(conceptTrailTarget)} disabled={!conceptTrailTarget}>
                            Continue in concept cluster
                          </button>
                          <button type="button" onClick={() => handleTrail(sectionTrailTarget)} disabled={!sectionTrailTarget}>
                            Continue in section
                          </button>
                        </div>
                        <p className="workspace-muted">
                          Use trails when you want chunked review by idea or argument, instead of jumping randomly across the paper.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyWorkspace
                    title="Select a card to study"
                    body="The full-page review workspace lets you inspect context, related items, and local study trails before opening the graded recall overlay."
                  />
                )}
              </section>

              <aside className="workspace-content-card workspace-review-side">
                <h2>Facet Breakdown</h2>
                {Object.keys(facetCounts).length ? (
                  <div className="facet-list">
                    {Object.entries(facetCounts).map(([facet, count]) => (
                      <div key={facet} className="facet-row">
                        <span>{FACET_LABELS[facet] || facet}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="workspace-muted">No due cards to categorize yet.</p>
                )}

                <h2>Paper Queues</h2>
                <div className="paper-queue-list">
                  {(selectedSession?.pdfs || []).map((pdf) => {
                    const count = sessionCards.filter((card) => card.pdfId === pdf.id).length
                    return (
                      <button key={pdf.id} type="button" onClick={() => selectPdf(pdf)} className={selectedPdf?.id === pdf.id ? 'active' : ''}>
                        <span>{pdf.title}</span>
                        <strong>{count} due</strong>
                      </button>
                    )
                  })}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function enrichDueCard(card, entries) {
  const questionContext = normalizeQuestionContext(card.question_context)
  const entry = entries.find((item) => item.id === card.highlight_id) || null
  const displayQuestion = card.study_question || card.original_question || card.question
  const reviewStateLabel = 'Due now'
  const concepts = entry?.concepts || []
  const locationLabel = [
    card.section_title || entry?.sectionTitle || entry?.clusterTag || 'Unsectioned passage',
    card.page_number ? `p.${card.page_number}` : null,
  ].filter(Boolean).join(' · ')

  return {
    id: card.id,
    raw: card,
    pdfId: card.pdf_id,
    highlightId: card.highlight_id,
    cardType: card.card_type || 'manual',
    cardTypeLabel: formatCardType(card.card_type || 'manual'),
    displayQuestion,
    answer: card.answer,
    rhetoricalFacet: card.rhetorical_facet || 'uncategorized',
    questionContext,
    locationLabel,
    sourcePreview: questionContext?.sourceExcerptFull || questionContext?.sourceExcerptShort || card.source_passage || card.highlight_text || '',
    reviewStateLabel,
    isContextRich: Boolean(questionContext?.contextSummary && (questionContext?.sourceExcerptFull || questionContext?.sourceExcerptShort || card.highlight_text)),
    needsRepair: Boolean(questionContext?.needsDisambiguation || questionContext?.contextStatus === 'weak'),
    primaryConcept: concepts[0] || null,
    concepts,
    entry,
    sectionKey: (card.section_title || entry?.sectionTitle || entry?.clusterTag || 'Unsectioned passage').trim(),
    intentLabel: formatIntentLabel(questionContext?.questionIntent || 'takeaway'),
  }
}

function buildQueueGroups(cards, queueView) {
  if (!cards.length) return []

  if (queueView === 'concept') {
    const map = {}
    for (const card of cards) {
      const concepts = card.concepts.length ? card.concepts : ['Unmapped concept']
      for (const concept of concepts) {
        if (!map[concept]) map[concept] = []
        map[concept].push(card)
      }
    }
    return Object.entries(map)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([key, groupCards]) => ({
        key: `concept-${key}`,
        label: key,
        description: 'Cards that support the same concept cluster.',
        cards: groupCards,
      }))
  }

  if (queueView === 'section') {
    const map = {}
    for (const card of cards) {
      if (!map[card.sectionKey]) map[card.sectionKey] = []
      map[card.sectionKey].push(card)
    }
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, groupCards]) => ({
        key: `section-${key}`,
        label: key,
        description: 'Cards that belong to the same part of the paper argument.',
        cards: groupCards,
      }))
  }

  if (queueView === 'context') {
    const contextCards = cards.filter((card) => card.isContextRich)
    return contextCards.length
      ? [{
          key: 'context-rich',
          label: 'Context-rich cards',
          description: 'Cards with enough context to be fair recall prompts.',
          cards: contextCards,
        }]
      : []
  }

  if (queueView === 'repair') {
    const repairCards = cards.filter((card) => card.needsRepair)
    return repairCards.length
      ? [{
          key: 'repair',
          label: 'Needs repair',
          description: 'Cards whose source grounding is too weak to trust without cleanup.',
          cards: repairCards,
        }]
      : []
  }

  return [{
    key: 'due',
    label: 'Due now',
    description: 'All currently due cards in this session.',
    cards: [...cards].sort((a, b) => Number(b.needsRepair) - Number(a.needsRepair) || a.locationLabel.localeCompare(b.locationLabel)),
  }]
}

function getRelatedEntries(card, sessionEntriesByPdf) {
  if (!card?.entry) return []
  const entries = sessionEntriesByPdf[card.pdfId] || []
  const conceptSet = new Set(card.entry.concepts || [])
  return entries
    .filter((entry) => {
      if (entry.id === card.entry.id) return true
      const sharesSection = (entry.sectionTitle || entry.clusterTag) === (card.entry.sectionTitle || card.entry.clusterTag)
      const sharesConcept = (entry.concepts || []).some((concept) => conceptSet.has(concept))
      return sharesSection || sharesConcept
    })
    .slice(0, 5)
}

function findNextTrailCard(cards, currentCard, mode) {
  if (!currentCard) return null
  const currentIndex = cards.findIndex((card) => card.id === currentCard.id)
  if (currentIndex === -1) return null
  const tail = [...cards.slice(currentIndex + 1), ...cards.slice(0, currentIndex)]
  if (mode === 'section') {
    return tail.find((card) => card.id !== currentCard.id && card.sectionKey === currentCard.sectionKey) || null
  }
  const conceptSet = new Set(currentCard.concepts || [])
  if (!conceptSet.size) return null
  return tail.find((card) => card.id !== currentCard.id && card.concepts.some((concept) => conceptSet.has(concept))) || null
}

function buildWhyThisMatters(card) {
  const intent = card.questionContext?.questionIntent || 'takeaway'
  if (intent === 'method') return 'This card is valuable because it helps preserve how the paper actually achieves its claims, not just what it claims.'
  if (intent === 'result') return 'This card is valuable because it stabilizes the paper’s evidence and outcome layer, which is what later comparisons will rely on.'
  if (intent === 'background') return 'This card is valuable because it restores the problem frame that later methods and results depend on.'
  if (intent === 'critique') return 'This card is valuable because it helps you remember the paper’s limits, assumptions, or tradeoffs instead of only its headline contribution.'
  return 'This card is valuable because it captures a durable takeaway that should remain intelligible outside the original reading moment.'
}

function formatCardType(type) {
  if (type === 'quiz') return 'Quiz Me'
  if (type === 'summarise') return 'Summarise'
  if (type === 'terms') return 'Key Terms'
  if (type === 'simplify') return 'Simplify'
  if (type === 'explain') return 'Explain'
  if (type === 'chat') return 'Chat'
  return 'Study question'
}

function formatIntentLabel(intent) {
  if (intent === 'method') return 'Method'
  if (intent === 'result') return 'Result'
  if (intent === 'background') return 'Background'
  if (intent === 'definition') return 'Definition'
  if (intent === 'critique') return 'Critique'
  if (intent === 'comparison') return 'Comparison'
  return 'Takeaway'
}

function getReviewEntryTitle(entry) {
  const primaryQa = entry?.qaPairs?.[0]
  return primaryQa?.originalQuestion || primaryQa?.studyQuestion || primaryQa?.question || (entry.sectionTitle || entry.clusterTag || 'Saved passage')
}

function truncate(text, limit = 180) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}
