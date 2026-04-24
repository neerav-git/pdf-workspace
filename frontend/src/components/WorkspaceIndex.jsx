import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  attachQASource,
  backfillLegacyContext,
  convertQAToNote,
  reframeStudyQuestion,
  repairQAContext,
} from '../api/highlights'
import { useAppStore } from '../store'
import './WorkspacePages.css'

const INDEX_GROUP_MODES = [
  { id: 'section', label: 'By Section' },
  { id: 'concept', label: 'By Concept' },
  { id: 'intent', label: 'By Question Intent' },
  { id: 'source', label: 'By Source Type' },
  { id: 'review', label: 'By Review State' },
]

const SORT_PRESETS = [
  { id: 'foundational', label: 'Foundational first' },
  { id: 'methods', label: 'Methods first' },
  { id: 'results', label: 'Results first' },
  { id: 'most-reviewed', label: 'Most reviewed' },
  { id: 'least-grounded', label: 'Least grounded' },
]

const ORIGIN_META = {
  highlight: { label: 'From highlight', tone: 'highlight' },
  chat: { label: 'From chat', tone: 'chat' },
  concept: { label: 'From concept', tone: 'concept' },
  manual: { label: 'Manual', tone: 'manual' },
  comparison: { label: 'From compare', tone: 'comparison' },
}

const INTENT_META = {
  background: { label: 'Background', order: 1 },
  definition: { label: 'Definition', order: 2 },
  method: { label: 'Method', order: 3 },
  result: { label: 'Result', order: 4 },
  critique: { label: 'Critique', order: 5 },
  comparison: { label: 'Comparison', order: 6 },
  takeaway: { label: 'Takeaway', order: 7 },
}

const REVIEW_BUCKET_META = {
  due: { label: 'Due now', order: 1 },
  learning: { label: 'In learning', order: 2 },
  new: { label: 'New', order: 3 },
  reviewed: { label: 'Reviewed', order: 4 },
}

export default function WorkspaceIndex() {
  const {
    researchSessions,
    selectedPdf,
    selectPdf,
    highlightIndex,
    requestNav,
    setFlashHighlight,
    refreshHighlightsForPdf,
  } = useAppStore()
  const activeSession = useActiveSession(researchSessions, selectedPdf)
  const [selectedSessionId, setSelectedSessionId] = useState(activeSession?.id || null)
  const [groupMode, setGroupMode] = useState('section')
  const [sortPreset, setSortPreset] = useState('foundational')
  const [expandedEntries, setExpandedEntries] = useState({})
  const [backfillStatus, setBackfillStatus] = useState('')
  const [backfilling, setBackfilling] = useState(false)

  useEffect(() => {
    if (activeSession?.id) setSelectedSessionId(activeSession.id)
    else if (!selectedSessionId && researchSessions[0]?.id) setSelectedSessionId(researchSessions[0].id)
  }, [activeSession?.id, researchSessions, selectedSessionId])

  const selectedSession = researchSessions.find((session) => session.id === selectedSessionId) || activeSession || researchSessions[0] || null
  const pdfEntries = highlightIndex.filter((entry) => entry.pdfId === selectedPdf?.id)
  const groups = useMemo(() => buildIndexGroups(pdfEntries, groupMode, sortPreset), [pdfEntries, groupMode, sortPreset])
  const summary = useMemo(() => summarizeEntries(pdfEntries), [pdfEntries])

  const toggleEntry = (entryId) =>
    setExpandedEntries((prev) => ({ ...prev, [entryId]: !prev[entryId] }))

  const handleOpenSource = (entry) => {
    requestNav(entry.pageNumber)
    const text = (entry.highlightTexts && entry.highlightTexts[0]) || entry.highlightText
    if (text) {
      setFlashHighlight({ text, pageNumber: entry.pageNumber })
    }
  }

  const handleBackfill = async () => {
    if (!selectedPdf?.id || backfilling) return
    setBackfillStatus('')
    setBackfilling(true)
    try {
      const result = await backfillLegacyContext(selectedPdf.id)
      await refreshHighlightsForPdf(selectedPdf)
      setBackfillStatus(`Updated ${result.qas_updated} legacy cards`)
    } catch (error) {
      setBackfillStatus('Backfill failed')
    } finally {
      setBackfilling(false)
    }
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
          <span>Full-Page Index</span>
          <h1>Knowledge Map</h1>
          <p>
            Use the same saved panel material, reorganized for concept-level orientation, question provenance, grounding quality, and review planning.
          </p>
        </header>

        <div className="workspace-stat-strip">
          <Metric label="Active session" value={selectedSession?.title || 'None'} />
          <Metric label="Selected paper" value={selectedPdf?.title || 'Select a paper'} />
          <Metric label="Visible index entries" value={String(pdfEntries.length)} />
          <Metric label="Logged Q&As" value={String(summary.qaCount)} />
        </div>

        <div className="idx-stats workspace-index-compat-stats">
          <span>{pdfEntries.length} passages</span>
          <span className="idx-stats-sep">·</span>
          <span>{summary.qaCount} Q&amp;As</span>
          <span className="idx-stats-sep">·</span>
          <span>{summary.conceptCount} concepts</span>
        </div>

        {selectedPdf ? (
          <>
            <section className="workspace-index-toolbar">
              <div className="workspace-chip-row">
                {INDEX_GROUP_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`workspace-chip ${groupMode === mode.id ? 'active' : ''}`}
                    onClick={() => setGroupMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <label className="workspace-select-field">
                <span>Sort</span>
                <select value={sortPreset} onChange={(e) => setSortPreset(e.target.value)}>
                  {SORT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
              </label>
              <div className="workspace-inline-actions">
                <button type="button" onClick={handleBackfill} disabled={backfilling}>
                  {backfilling ? 'Backfilling…' : 'Backfill legacy context'}
                </button>
              </div>
            </section>
            {backfillStatus && <p className="workspace-inline-status">{backfillStatus}</p>}

            <div className="workspace-index-layout">
              <section className="workspace-content-card workspace-index-deep-card">
                <div className="workspace-card-header">
                  <h2>{INDEX_GROUP_MODES.find((mode) => mode.id === groupMode)?.label || 'Index'}</h2>
                  <span>{groups.length} group{groups.length === 1 ? '' : 's'} · {SORT_PRESETS.find((preset) => preset.id === sortPreset)?.label}</span>
                </div>
                {!pdfEntries.length ? (
                  <EmptyWorkspace
                    title="This paper has no saved index entries yet"
                    body="Use the HUD to save a highlight, question, or chat response. The full-page index will organize that same material here."
                  />
                ) : (
                  <div className="workspace-index-group-list">
                    {groups.map((group) => (
                      <section key={group.key} className="workspace-index-group">
                        <div className="workspace-index-group-header">
                          <div>
                            <h3>{group.label}</h3>
                            {group.description && <p>{group.description}</p>}
                          </div>
                          <strong>{group.entries.length} entry{group.entries.length === 1 ? '' : 'ies'}</strong>
                        </div>
                        <div className="workspace-index-entry-list">
                          {group.entries.map((entry) => (
                            <IndexKnowledgeCard
                              key={`${group.key}-${entry.id}`}
                              entry={entry}
                              selectedPdf={selectedPdf}
                              expanded={Boolean(expandedEntries[entry.id])}
                              onToggle={() => toggleEntry(entry.id)}
                              onOpenSource={() => handleOpenSource(entry)}
                              onRefresh={() => refreshHighlightsForPdf(selectedPdf)}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </section>

              <aside className="workspace-index-side">
                <section className="workspace-content-card workspace-summary-card">
                  <div className="workspace-card-header">
                    <h2>Orientation</h2>
                    <span>{selectedPdf?.page_count || 0} pages</span>
                  </div>
                  <div className="workspace-summary-grid">
                    <SummaryRow label="Concepts" value={String(summary.conceptCount)} />
                    <SummaryRow label="Sections" value={String(summary.sectionCount)} />
                    <SummaryRow label="Needs repair" value={String(summary.weakCount)} />
                    <SummaryRow label="Anchored entries" value={String(summary.anchoredCount)} />
                    <SummaryRow label="Due cards" value={String(summary.dueCount)} />
                    <SummaryRow label="Reviewed reps" value={String(summary.reviewReps)} />
                  </div>
                </section>

                <section className="workspace-content-card workspace-summary-card">
                  <div className="workspace-card-header">
                    <h2>Current Lens</h2>
                    <span>Study guidance</span>
                  </div>
                  <div className="workspace-summary-copy">
                    <p>{groupingGuidance(groupMode)}</p>
                    <p>{sortingGuidance(sortPreset)}</p>
                  </div>
                </section>

                <section className="workspace-content-card workspace-summary-card">
                  <div className="workspace-card-header">
                    <h2>Question Coverage</h2>
                    <span>{summary.intentCount} intent types</span>
                  </div>
                  <div className="workspace-pill-list">
                    {summary.intentBreakdown.map(([intent, count]) => (
                      <span key={intent} className="workspace-pill">
                        {getIntentMeta(intent).label} · {count}
                      </span>
                    ))}
                    {!summary.intentBreakdown.length && <p className="workspace-muted">No Q&A cards yet.</p>}
                  </div>
                </section>
              </aside>
            </div>
          </>
        ) : (
          <section className="workspace-content-card workspace-index-card">
            <EmptyWorkspace
              title="Select a paper to open its index"
              body="Use the session navigator to choose a PDF. The full-page index uses the same saved entries as the right HUD."
            />
          </section>
        )}
      </main>
    </div>
  )
}

function IndexKnowledgeCard({ entry, selectedPdf, expanded, onToggle, onOpenSource, onRefresh }) {
  const primaryQa = getPrimaryQA(entry)
  const stats = getEntryReviewStats(entry)
  const primaryContext = primaryQa?.questionContext || null
  const sourcePreview = ((entry.highlightTexts && entry.highlightTexts[0]) || entry.highlightText || '').trim()
  const questionTitle = getQuestionTitle(primaryQa)
  const tags = Array.from(new Set((entry.qaPairs || []).flatMap((qa) => qa.topicTags || []))).slice(0, 8)
  const provenance = getEntryOrigins(entry).map(getOriginMeta)
  const ambiguity = (entry.qaPairs || []).some((qa) => qa.questionContext?.needsDisambiguation)
  const [actionState, setActionState] = useState({})
  const [entryStatus, setEntryStatus] = useState('')
  const [expandedQAs, setExpandedQAs] = useState(() => {
    const firstQaId = entry.qaPairs?.[0]?.id
    return firstQaId ? { [firstQaId]: true } : {}
  })

  const toggleQA = (qaId) =>
    setExpandedQAs((prev) => ({ ...prev, [qaId]: !prev[qaId] }))

  const onCardToggle = () => onToggle()
  const onCardKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle()
    }
  }

  const runAction = async (qaId, action, work) => {
    setActionState((prev) => ({ ...prev, [`${qaId}:${action}`]: true }))
    setEntryStatus('')
    try {
      await work()
      await onRefresh()
      setEntryStatus(`${actionLabel(action)} completed`)
    } catch (error) {
      setEntryStatus(`${actionLabel(action)} failed`)
    } finally {
      setActionState((prev) => ({ ...prev, [`${qaId}:${action}`]: false }))
    }
  }

  return (
    <article className="workspace-index-entry-card">
      <div
        className={`workspace-index-entry-top workspace-index-entry-top--interactive ${expanded ? 'expanded' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onCardToggle}
        onKeyDown={onCardKeyDown}
      >
        <div>
          <div className="workspace-index-entry-location">
            <span className="workspace-page-token">p.{entry.pageNumber}</span>
            <span>{getSectionLabel(entry)}</span>
          </div>
          <h4>{questionTitle || 'Saved passage'}</h4>
          {primaryContext?.contextSummary && <p className="workspace-index-context">{primaryContext.contextSummary}</p>}
        </div>
        <div className="workspace-index-entry-actions">
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenSource() }}>Open in reader</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onToggle() }}>{expanded ? 'Hide details' : 'Show details'}</button>
        </div>
      </div>

      <div className="workspace-index-badge-row">
        {provenance.map((item) => (
          <span key={item.label} className={`workspace-context-badge workspace-context-badge--${item.tone}`}>{item.label}</span>
        ))}
        {getEntryIntents(entry).map((intent) => (
          <span key={intent} className="workspace-context-badge workspace-context-badge--intent">{getIntentMeta(intent).label}</span>
        ))}
        {ambiguity && <span className="workspace-context-badge workspace-context-badge--repair">Needs context</span>}
      </div>

      <div className="workspace-index-stat-row">
        <StatPill label="Q&As" value={entry.qaPairs.length} />
        <StatPill label="Due" value={stats.due} tone="due" />
        <StatPill label="Learning" value={stats.learning} tone="learning" />
        <StatPill label="Reviewed" value={stats.reviewed} tone="reviewed" />
        <StatPill label="Reps" value={stats.reps} />
      </div>

      <div className="workspace-index-concepts">
        {entry.concepts.map((concept) => (
          <span key={concept} className="workspace-pill">{concept}</span>
        ))}
        {tags.map((tag) => (
          <span key={tag} className="workspace-pill workspace-pill--muted">{tag}</span>
        ))}
      </div>

      {expanded && (
        <div className="workspace-index-entry-body">
          {entryStatus && <p className="workspace-inline-status">{entryStatus}</p>}
          <div className="workspace-index-passage">
            <div className="workspace-card-minihead">
              <span>Source anchor</span>
              <small>{formatScopeLabel(primaryContext?.questionScope)}</small>
            </div>
            <p>{sourcePreview || 'No passage preview available.'}</p>
            {primaryContext?.contextSummary && !sourcePreview && (
              <p className="workspace-index-passage-note">{primaryContext.contextSummary}</p>
            )}
          </div>

          <div className="workspace-index-history">
            <div className="workspace-card-minihead">
              <span>Linked Q&A history</span>
              <small>{entry.qaPairs.length} card{entry.qaPairs.length === 1 ? '' : 's'}</small>
            </div>
            <p className="workspace-index-history-guide">
              These are the actual saved study cards for this passage. Open a card to read the full answer, not just the entry overview above.
            </p>
            <div className="workspace-index-history-list">
              {entry.qaPairs.map((qa) => (
                <div key={qa.id} className={`workspace-index-history-item ${expandedQAs[qa.id] ? 'expanded' : ''}`}>
                  <div className="workspace-index-history-head">
                    <div className="workspace-index-history-head-copy">
                      <strong>{getQuestionTitle(qa)}</strong>
                      <div className="workspace-index-history-meta">
                        <span>{formatContextStatus(qa.questionContext?.contextStatus)}</span>
                        <span>{formatLocationLabel(qa.questionContext, entry)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="workspace-index-history-toggle"
                      onClick={() => toggleQA(qa.id)}
                    >
                      {expandedQAs[qa.id] ? 'Hide answer' : 'Read answer'}
                    </button>
                  </div>
                  {qa.originalQuestion && qa.studyQuestion && qa.originalQuestion.trim() !== qa.studyQuestion.trim() && (
                    <p className="workspace-index-history-context">
                      Study framing: {qa.studyQuestion}
                    </p>
                  )}
                  {shouldShowQaContext(qa.questionContext, primaryContext) && (
                    <p className="workspace-index-history-context">{qa.questionContext.contextSummary}</p>
                  )}
                  {!expandedQAs[qa.id] && (
                    <p className="workspace-index-answer-preview">{truncate(qa.answer, 180)}</p>
                  )}
                  {expandedQAs[qa.id] && (
                    <AnswerDetail answer={qa.answer || ''} />
                  )}
                  <div className="workspace-inline-actions workspace-inline-actions--repair">
                    <button
                      type="button"
                      onClick={() => runAction(qa.id, 'repair context', () => repairQAContext(qa.id))}
                      disabled={Boolean(actionState[`${qa.id}:repair context`])}
                    >
                      {actionState[`${qa.id}:repair context`] ? 'Repairing…' : 'Repair context'}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(qa.id, 'reframe', () => reframeStudyQuestion(qa.id))}
                      disabled={Boolean(actionState[`${qa.id}:reframe`])}
                    >
                      {actionState[`${qa.id}:reframe`] ? 'Reframing…' : 'Reframe as study question'}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(qa.id, 'attach source', () => attachQASource(qa.id, {
                        selection_text: entry.highlightText,
                        source_chunk_ids: entry.chunkId ? [entry.chunkId] : [],
                      }))}
                      disabled={Boolean(actionState[`${qa.id}:attach source`])}
                    >
                      {actionState[`${qa.id}:attach source`] ? 'Attaching…' : 'Attach source'}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(qa.id, 'convert to note', () => convertQAToNote(qa.id))}
                      disabled={Boolean(actionState[`${qa.id}:convert to note`])}
                    >
                      {actionState[`${qa.id}:convert to note`] ? 'Converting…' : 'Convert to note'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

function buildIndexGroups(entries, groupMode, sortPreset) {
  const sortedEntries = sortEntries(entries, sortPreset)

  if (groupMode === 'concept') {
    const map = {}
    for (const entry of sortedEntries) {
      const concepts = entry.concepts?.length ? entry.concepts : ['Untagged']
      for (const concept of concepts) {
        if (!map[concept]) map[concept] = []
        map[concept].push(entry)
      }
    }
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, groupEntries]) => ({ key: `concept-${key}`, label: key, description: 'Entries sharing the same concept tag.', entries: groupEntries }))
  }

  if (groupMode === 'intent') {
    const map = {}
    for (const entry of sortedEntries) {
      const intents = getEntryIntents(entry)
      const keys = intents.length ? intents : ['takeaway']
      for (const intent of keys) {
        if (!map[intent]) map[intent] = []
        map[intent].push(entry)
      }
    }
    return Object.entries(map)
      .sort((a, b) => getIntentMeta(a[0]).order - getIntentMeta(b[0]).order)
      .map(([key, groupEntries]) => ({
        key: `intent-${key}`,
        label: getIntentMeta(key).label,
        description: 'Questions grouped by what they help the reader learn.',
        entries: groupEntries,
      }))
  }

  if (groupMode === 'source') {
    const map = {}
    for (const entry of sortedEntries) {
      const origins = getEntryOrigins(entry)
      const keys = origins.length ? origins : ['manual']
      for (const origin of keys) {
        if (!map[origin]) map[origin] = []
        map[origin].push(entry)
      }
    }
    return Object.entries(map)
      .sort((a, b) => getOriginMeta(a[0]).label.localeCompare(getOriginMeta(b[0]).label))
      .map(([key, groupEntries]) => ({
        key: `source-${key}`,
        label: getOriginMeta(key).label,
        description: 'Questions grouped by how they entered the knowledge map.',
        entries: groupEntries,
      }))
  }

  if (groupMode === 'review') {
    const map = {}
    for (const entry of sortedEntries) {
      const bucket = getEntryReviewBucket(entry)
      if (!map[bucket]) map[bucket] = []
      map[bucket].push(entry)
    }
    return Object.entries(map)
      .sort((a, b) => REVIEW_BUCKET_META[a[0]].order - REVIEW_BUCKET_META[b[0]].order)
      .map(([key, groupEntries]) => ({
        key: `review-${key}`,
        label: REVIEW_BUCKET_META[key].label,
        description: 'Entries grouped by the current review burden of their linked cards.',
        entries: groupEntries,
      }))
  }

  const sectionMap = {}
  for (const entry of sortedEntries) {
    const label = getSectionLabel(entry)
    if (!sectionMap[label]) sectionMap[label] = []
    sectionMap[label].push(entry)
  }
  return Object.entries(sectionMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, groupEntries]) => ({
      key: `section-${key}`,
      label: key,
      description: 'Entries aligned to the paper’s argument structure.',
      entries: groupEntries,
    }))
}

function sortEntries(entries, sortPreset) {
  const next = [...entries]
  next.sort((a, b) => compareEntries(a, b, sortPreset))
  return next
}

function compareEntries(a, b, preset) {
  const pageDiff = (a.pageNumber || 0) - (b.pageNumber || 0)
  const aStats = getEntryReviewStats(a)
  const bStats = getEntryReviewStats(b)
  const aWeak = getWeakCount(a)
  const bWeak = getWeakCount(b)
  const aMethod = countIntent(a, 'method')
  const bMethod = countIntent(b, 'method')
  const aResult = countIntent(a, 'result')
  const bResult = countIntent(b, 'result')
  const aFoundational = Number(Boolean(a.anchored)) * 10 + countIntent(a, 'background') * 4 + countIntent(a, 'definition') * 4 + (a.concepts?.length || 0)
  const bFoundational = Number(Boolean(b.anchored)) * 10 + countIntent(b, 'background') * 4 + countIntent(b, 'definition') * 4 + (b.concepts?.length || 0)

  if (preset === 'methods') {
    if (bMethod !== aMethod) return bMethod - aMethod
    return pageDiff
  }
  if (preset === 'results') {
    if (bResult !== aResult) return bResult - aResult
    return pageDiff
  }
  if (preset === 'most-reviewed') {
    if (bStats.reps !== aStats.reps) return bStats.reps - aStats.reps
    return pageDiff
  }
  if (preset === 'least-grounded') {
    if (bWeak !== aWeak) return bWeak - aWeak
    return pageDiff
  }
  if (bFoundational !== aFoundational) return bFoundational - aFoundational
  return pageDiff
}

function summarizeEntries(entries) {
  const sections = new Set()
  const concepts = new Set()
  const intents = {}
  let qaCount = 0
  let weakCount = 0
  let dueCount = 0
  let reviewReps = 0
  let anchoredCount = 0

  for (const entry of entries) {
    qaCount += entry.qaPairs.length
    sections.add(getSectionLabel(entry))
    if (entry.anchored) anchoredCount += 1
    for (const concept of entry.concepts || []) concepts.add(concept)
    for (const qa of entry.qaPairs || []) {
      const intent = qa.questionContext?.questionIntent || 'takeaway'
      intents[intent] = (intents[intent] || 0) + 1
      if (qa.questionContext?.needsDisambiguation || qa.questionContext?.contextStatus === 'weak') weakCount += 1
      if (qa.dueAt && new Date(qa.dueAt).getTime() <= Date.now() && qa.state !== 'suspended') dueCount += 1
      reviewReps += qa.reps || 0
    }
  }

  return {
    qaCount,
    conceptCount: concepts.size,
    sectionCount: sections.size,
    intentCount: Object.keys(intents).length,
    intentBreakdown: Object.entries(intents).sort((a, b) => b[1] - a[1]).slice(0, 6),
    weakCount,
    dueCount,
    reviewReps,
    anchoredCount,
  }
}

function getPrimaryQA(entry) {
  if (!entry?.qaPairs?.length) return null
  return [...entry.qaPairs].sort((a, b) => {
    if (b.starred !== a.starred) return Number(b.starred) - Number(a.starred)
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  })[0]
}

function getQuestionTitle(qa) {
  if (!qa) return ''
  return qa.originalQuestion || qa.studyQuestion || qa.question || 'Study card'
}

function getSectionLabel(entry) {
  const deepPath = (entry.deepSectionPath || []).filter((node) => node?.title)
  const sectionPath = (entry.sectionPath || []).filter((node) => node?.title)
  const path = deepPath.length ? deepPath : sectionPath
  if (path.length) return path[path.length - 1].title
  return entry.sectionTitle || entry.clusterTag || 'Unsectioned passage'
}

function getEntryOrigins(entry) {
  return Array.from(new Set((entry.qaPairs || []).map((qa) => qa.questionContext?.questionOrigin || 'manual')))
}

function getEntryIntents(entry) {
  return Array.from(new Set((entry.qaPairs || []).map((qa) => qa.questionContext?.questionIntent || 'takeaway')))
}

function getEntryReviewBucket(entry) {
  const stats = getEntryReviewStats(entry)
  if (stats.due > 0) return 'due'
  if (stats.learning > 0) return 'learning'
  if (stats.newCount > 0) return 'new'
  return 'reviewed'
}

function getEntryReviewStats(entry) {
  const stats = { due: 0, learning: 0, newCount: 0, reviewed: 0, reps: 0 }
  for (const qa of entry.qaPairs || []) {
    stats.reps += qa.reps || 0
    if (qa.dueAt && new Date(qa.dueAt).getTime() <= Date.now() && qa.state !== 'suspended') stats.due += 1
    else if (qa.state === 'learning' || qa.state === 'relearning') stats.learning += 1
    else if (qa.state === 'new') stats.newCount += 1
    else stats.reviewed += 1
  }
  return stats
}

function getWeakCount(entry) {
  return (entry.qaPairs || []).filter((qa) => qa.questionContext?.needsDisambiguation || qa.questionContext?.contextStatus === 'weak').length
}

function countIntent(entry, intent) {
  return (entry.qaPairs || []).filter((qa) => (qa.questionContext?.questionIntent || 'takeaway') === intent).length
}

function getOriginMeta(origin) {
  return ORIGIN_META[origin] || ORIGIN_META.manual
}

function getIntentMeta(intent) {
  return INTENT_META[intent] || INTENT_META.takeaway
}

function truncate(text, limit = 180) {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

function formatScopeLabel(scope) {
  if (scope === 'passage') return 'Passage grounded'
  if (scope === 'section') return 'Section grounded'
  if (scope === 'session') return 'Session grounded'
  return 'Document grounded'
}

function formatContextStatus(status) {
  if (status === 'grounded') return 'Grounded'
  if (status === 'reconstructed') return 'Reconstructed'
  return 'Weak context'
}

function formatLocationLabel(questionContext, entry) {
  const locator = questionContext?.sourceLocator || {}
  const section = locator.sectionTitle || getSectionLabel(entry)
  const page = locator.page || entry.pageNumber
  if (section && page) return `${section} · p.${page}`
  if (section) return section
  if (page) return `p.${page}`
  return 'Location unavailable'
}

function shouldShowQaContext(questionContext, primaryContext) {
  const current = questionContext?.contextSummary?.trim()
  if (!current) return false
  const primary = primaryContext?.contextSummary?.trim()
  if (!primary) return true
  return current !== primary
}

function AnswerDetail({ answer }) {
  const parsed = parseAnswerSections(answer)

  return (
    <div className="workspace-index-answer-shell">
      {parsed.question && (
        <div className="workspace-index-answer-section workspace-index-answer-section--question">
          <div className="workspace-index-answer-label">Question</div>
          <p>{parsed.question}</p>
        </div>
      )}
      <div className="workspace-index-answer-section workspace-index-answer-section--answer">
        <div className="workspace-index-answer-label">Answer</div>
        <div className="workspace-index-answer-body">
          <ReactMarkdown>{parsed.answer}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

function parseAnswerSections(answer) {
  const raw = (answer || '').trim()
  const normalized = raw
    .replace(/^\*\*Question:\*\*\s*/im, 'Question: ')
    .replace(/^\*\*Answer:\*\*\s*/im, 'Answer: ')

  const questionMatch = normalized.match(/(?:^|\n)Question:\s*([\s\S]*?)(?=\nAnswer:|$)/i)
  const answerMatch = normalized.match(/(?:^|\n)Answer:\s*([\s\S]*)$/i)

  if (questionMatch || answerMatch) {
    return {
      question: questionMatch?.[1]?.trim() || '',
      answer: answerMatch?.[1]?.trim() || raw,
    }
  }

  return { question: '', answer: raw }
}

function actionLabel(action) {
  return action.charAt(0).toUpperCase() + action.slice(1)
}

function groupingGuidance(groupMode) {
  if (groupMode === 'concept') return 'Concept grouping helps the reader see where ideas recur across different parts of the paper.'
  if (groupMode === 'intent') return 'Question-intent grouping separates background, method, result, and critique cards so study goals are easier to target.'
  if (groupMode === 'source') return 'Source-type grouping distinguishes highlight-grounded study cards from chat-derived or concept-derived prompts.'
  if (groupMode === 'review') return 'Review-state grouping exposes where study pressure is accumulating before cards disappear into a flat due queue.'
  return 'Section grouping mirrors the paper’s argument structure so saved questions stay tied to where the paper made its claims.'
}

function sortingGuidance(sortPreset) {
  if (sortPreset === 'methods') return 'Methods-first sorting front-loads procedural understanding and design logic.'
  if (sortPreset === 'results') return 'Results-first sorting emphasizes claims, evidence, and outcomes.'
  if (sortPreset === 'most-reviewed') return 'Most-reviewed sorting surfaces what has become central in repeated study.'
  if (sortPreset === 'least-grounded') return 'Least-grounded sorting surfaces weak or ambiguous cards so they can be repaired before they pollute review.'
  return 'Foundational-first sorting prioritizes anchored and background-building material.'
}

function SessionNavigator({ sessions, selectedSession, selectedPdf, onSelectSession, onSelectPdf }) {
  return (
    <aside className="workspace-navigator">
      <div className="workspace-nav-header">
        <span>Research Sessions</span>
        <small>Session → paper → index</small>
      </div>
      <div className="workspace-session-list">
        {sessions.map((session) => {
          const active = selectedSession?.id === session.id
          return (
            <section key={session.id} className={`workspace-session-block ${active ? 'active' : ''}`}>
              <button type="button" className="workspace-session-btn" onClick={() => onSelectSession(session.id)}>
                <span>{session.title}</span>
                <small>{session.pdf_count || session.pdfs?.length || 0} PDFs</small>
              </button>
              {active && (
                <div className="workspace-paper-list">
                  {(session.pdfs || []).map((pdf) => (
                    <button
                      key={pdf.id}
                      type="button"
                      className={`workspace-paper-btn ${selectedPdf?.id === pdf.id ? 'active' : ''}`}
                      onClick={() => onSelectPdf(pdf)}
                    >
                      <span>{pdf.title}</span>
                      <small>{pdf.page_count} pages</small>
                    </button>
                  ))}
                  {(session.pdfs || []).length === 0 && <p className="workspace-empty-mini">No PDFs in this session.</p>}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}

function Metric({ label, value }) {
  return (
    <div className="workspace-metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  )
}

function EmptyWorkspace({ title, body }) {
  return (
    <div className="workspace-empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="workspace-summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function StatPill({ label, value, tone = 'neutral' }) {
  return <span className={`workspace-stat-pill workspace-stat-pill--${tone}`}>{label}: {value}</span>
}

function useActiveSession(sessions, selectedPdf) {
  return useMemo(() => {
    if (!selectedPdf?.id) return null
    return sessions.find((session) => (session.pdfs || []).some((pdf) => pdf.id === selectedPdf.id)) || null
  }, [sessions, selectedPdf?.id])
}

export { EmptyWorkspace, Metric, SessionNavigator, useActiveSession }
