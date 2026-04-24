import { useEffect, useMemo, useState } from 'react'
import { getComparativeAnalysis, refreshComparativeAnalysis } from '../api/researchSessions'
import { useAppStore } from '../store'
import { EmptyWorkspace, Metric, SessionNavigator, useActiveSession } from './WorkspaceIndex'
import './WorkspacePages.css'

const COVERAGE_RANK = {
  none: 0,
  thin: 1,
  moderate: 2,
  strong: 3,
}

export default function WorkspaceCompare() {
  const { researchSessions, selectedPdf, selectPdf } = useAppStore()
  const activeSession = useActiveSession(researchSessions, selectedPdf)
  const [selectedSessionId, setSelectedSessionId] = useState(activeSession?.id || null)
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (activeSession?.id) setSelectedSessionId(activeSession.id)
    else if (!selectedSessionId && researchSessions[0]?.id) setSelectedSessionId(researchSessions[0].id)
  }, [activeSession?.id, researchSessions, selectedSessionId])

  const selectedSession = researchSessions.find((session) => session.id === selectedSessionId) || activeSession || researchSessions[0] || null

  useEffect(() => {
    if (!selectedSession?.id) {
      setAnalysis(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getComparativeAnalysis(selectedSession.id)
      .then((data) => {
        if (!cancelled) setAnalysis(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || 'Could not load comparative analysis')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedSession?.id])

  const coverage = useMemo(() => summarizeCoverage(analysis), [analysis])

  const handleRefresh = async () => {
    if (!selectedSession?.id || refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      const data = await refreshComparativeAnalysis(selectedSession.id)
      setAnalysis(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not generate AI comparative analysis')
    } finally {
      setRefreshing(false)
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
          <span>Full-Page Compare</span>
          <h1>Comparative Research Desk</h1>
          <p>
            Compare papers inside a research session using saved index evidence, Q&A cards, ontology topics, review progress, and traceable page-linked sources.
          </p>
        </header>

        <div className="workspace-stat-strip">
          <Metric label="Active session" value={selectedSession?.title || 'None'} />
          <Metric label="Compared papers" value={String(analysis?.papers?.length ?? selectedSession?.pdfs?.length ?? 0)} />
          <Metric label="Coverage score" value={coverage.scoreLabel} />
          <Metric label="Open gaps" value={String(coverage.gapCount)} />
        </div>

        {!selectedSession && (
          <EmptyWorkspace
            title="Create or select a research session"
            body="Comparative analysis needs a session so related papers can be compared against the same research goal."
          />
        )}
        {loading && <EmptyWorkspace title="Building comparison" body="Reading session evidence, index entries, Q&A cards, and topic coverage." />}
        {error && <EmptyWorkspace title="Comparison unavailable" body={error} />}
        {!loading && !error && analysis && (
          <CompareWorkspaceBody
            analysis={analysis}
            coverage={coverage}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        )}
      </main>
    </div>
  )
}

function CompareWorkspaceBody({ analysis, coverage, onRefresh, refreshing }) {
  const ai = analysis.ai_comparison || {}
  const aiGenerated = ai.status === 'generated' || ai.status === 'stale'
  const aiRows = aiGenerated && Array.isArray(ai.matrix) ? ai.matrix : []
  const aiAxes = aiGenerated && Array.isArray(ai.session_axes) ? ai.session_axes : []
  const readerGuidance = aiGenerated && Array.isArray(ai.reader_guidance) ? ai.reader_guidance : []
  const matrixRows = aiRows.length ? aiRows : deterministicRowsToAiShape(analysis.baseline_dimensions)
  const paperById = Object.fromEntries((analysis.papers || []).map((paper) => [paper.pdf_id, paper]))

  return (
    <div className="workspace-compare-layout">
      <section className="workspace-content-card workspace-compare-brief">
        <div>
          <span>Session Frame</span>
          <h2>{analysis.session.title}</h2>
          <p>{analysis.session.context || analysis.session.topic || 'No research context has been added yet.'}</p>
        </div>
        <div className="workspace-compare-policy">
          <strong>{aiGenerated ? 'AI PDF analysis active' : 'Deterministic fallback active'}</strong>
          <p>{ai.method_note || analysis.data_policy}</p>
          {ai.status === 'stale' && <p>This AI comparison is stale because the session PDF membership changed.</p>}
          <button type="button" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Generating...' : aiGenerated ? 'Refresh AI Comparison' : 'Generate AI Comparison'}
          </button>
        </div>
      </section>

      {aiGenerated && (
        <section className="workspace-content-card workspace-ai-insights">
          <div className="workspace-card-header">
            <h2>Crucial Cross-Paper Differences</h2>
            <span>{ai.model || 'AI analysis'} · {formatDate(ai.generated_at)}</span>
          </div>
          <div className="workspace-insight-grid">
            {(ai.cross_paper_insights || []).map((insight) => (
              <article key={`${insight.title}-${insight.summary}`} className="workspace-insight-card">
                <h3>{insight.title}</h3>
                <p>{insight.summary}</p>
                <div className="workspace-insight-papers">
                  {(insight.papers || []).map((pdfId) => (
                    <span key={pdfId}>{paperById[pdfId]?.title || `PDF ${pdfId}`}</span>
                  ))}
                </div>
              </article>
            ))}
            {!(ai.cross_paper_insights || []).length && (
              <p className="workspace-muted">No cross-paper insight cards were generated yet.</p>
            )}
          </div>
        </section>
      )}

      {aiGenerated && aiAxes.length > 0 && (
        <section className="workspace-content-card workspace-ai-axes">
          <div className="workspace-card-header">
            <h2>Session-Specific Comparison Lenses</h2>
            <span>{aiAxes.length} custom axes</span>
          </div>
          <div className="workspace-axis-grid">
            {aiAxes.map((axis) => (
              <article key={axis.key} className="workspace-axis-card">
                <h3>{axis.label}</h3>
                <p>{axis.description}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {aiGenerated && readerGuidance.length > 0 && (
        <section className="workspace-content-card workspace-ai-guidance">
          <div className="workspace-card-header">
            <h2>Reader Decision Guide</h2>
            <span>How each paper is best used</span>
          </div>
          <div className="workspace-guidance-grid">
            {readerGuidance.map((guide) => (
              <article key={guide.pdf_id} className="workspace-guidance-card">
                <h3>{paperById[guide.pdf_id]?.title || `PDF ${guide.pdf_id}`}</h3>
                <p><strong>Best for:</strong> {guide.best_for}</p>
                <p><strong>Distinctive angle:</strong> {guide.distinctive_angle || 'Distinctive contrast still needs stronger evidence.'}</p>
                <p><strong>Use with:</strong> {guide.use_with}</p>
                <p><strong>Watch for:</strong> {guide.watch_for}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="workspace-content-card workspace-compare-papers">
        <div className="workspace-card-header">
          <h2>Source Papers</h2>
          <span>{analysis.papers.length} source{analysis.papers.length === 1 ? '' : 's'}</span>
        </div>
        <div className="workspace-paper-comparison-grid">
          {analysis.papers.map((paper) => (
            <article key={paper.pdf_id} className="workspace-paper-comparison-card">
              <h3>{paper.title}</h3>
              <div className="workspace-paper-metrics">
                <span>{paper.page_count} pages</span>
                <span>{paper.index_entry_count} index entries</span>
                <span>{paper.qa_count} Q&As</span>
                <span>{paper.due_count} due</span>
              </div>
              <ConceptList concepts={paper.top_concepts.length ? paper.top_concepts : paper.topics.map((label) => ({ label, count: 1 }))} />
            </article>
          ))}
        </div>
      </section>

      <section className="workspace-content-card workspace-compare-table-card">
        <div className="workspace-card-header">
          <h2>{aiGenerated ? 'AI Literature Review Matrix' : 'Literature Review Matrix'}</h2>
          <span>{coverage.coveredCells}/{coverage.totalCells} cells have saved evidence</span>
        </div>
        <div className="workspace-compare-table-wrap">
          <table className="workspace-compare-table">
            <thead>
              <tr>
                <th>Comparison Dimension</th>
                {analysis.papers.map((paper) => <th key={paper.pdf_id}>{paper.title}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <strong>{row.label}</strong>
                    <small>{row.description}</small>
                  </td>
                  {row.cells.map((cell) => (
                    <td key={`${row.key}-${cell.pdf_id}`}>
                      <CoverageBadge coverage={cell.coverage || confidenceToCoverage(cell.confidence)} />
                      <p>{cell.summary}</p>
                      {cell.crucial_difference && <p className="workspace-crucial-difference">{cell.crucial_difference}</p>}
                      <EvidenceList sources={cell.sources || cell.evidence_refs || []} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="workspace-compare-bottom-grid">
        <section className="workspace-content-card workspace-compare-topic-card">
          <div className="workspace-card-header">
            <h2>Topic Coverage</h2>
            <span>Session-specific facets</span>
          </div>
          {analysis.topic_dimensions.length ? (
            <div className="workspace-topic-matrix">
              {analysis.topic_dimensions.map((dimension) => (
                <div key={dimension.label} className="workspace-topic-row">
                  <span className="workspace-topic-label">{dimension.label}</span>
                  <div className="workspace-topic-cells">
                    {dimension.cells.map((cell) => (
                      <span
                        key={`${dimension.label}-${cell.pdf_id}`}
                        className={`workspace-topic-cell coverage-${cell.coverage}`}
                        title={`${cell.pdf_title}: ${cell.count}`}
                      >
                        {cell.count}
                      </span>
                    ))}
                  </div>
                  <strong>{dimension.total_count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyWorkspace title="No topic coverage yet" body="Index entries and ontology topics will populate this matrix." />
          )}
        </section>

        <section className="workspace-content-card workspace-compare-gap-card">
          <div className="workspace-card-header">
            <h2>Gaps & Next Questions</h2>
            <span>Evidence-driven</span>
          </div>
          <GapList analysis={analysis} ai={ai} />
        </section>
      </div>
    </div>
  )
}

function ConceptList({ concepts }) {
  if (!concepts?.length) return <p className="workspace-muted">No concepts indexed yet.</p>
  return (
    <div className="workspace-concept-list">
      {concepts.slice(0, 8).map((concept) => (
        <span key={concept.label}>
          {concept.label}
          {concept.count > 1 ? ` ${concept.count}` : ''}
        </span>
      ))}
    </div>
  )
}

function EvidenceList({ sources }) {
  if (!sources.length) return null
  return (
    <div className="workspace-evidence-list">
      {sources.map((source) => (
        <span key={`${source.highlight_id || source.note}-${source.qa_id || source.page}`}>
          {source.page_number || source.page ? `p.${source.page_number || source.page}` : 'indexed'}
          {source.facet ? ` · ${source.facet}` : ''}
          {source.note ? ` · ${source.note}` : ''}
        </span>
      ))}
    </div>
  )
}

function CoverageBadge({ coverage }) {
  return <span className={`workspace-coverage-badge workspace-coverage-badge-${coverage}`}>{coverage}</span>
}

function GapList({ analysis, ai }) {
  const warnings = analysis.gap_panel.coverage_warnings || []
  const sessionGaps = analysis.gap_panel.session_specific_gaps || []
  const aiGaps = ai?.research_gaps || []
  const actions = analysis.gap_panel.recommended_next_actions || []
  return (
    <div className="workspace-gap-list">
      {aiGaps.map((gap) => (
        <article key={`${gap.gap}-${gap.suggested_next_question}`} className="workspace-gap-item workspace-gap-item--ai">
          <strong>{gap.gap}</strong>
          <p>{gap.why_it_matters}</p>
          {gap.suggested_next_question && <p>Next question: {gap.suggested_next_question}</p>}
        </article>
      ))}
      {[...warnings, ...sessionGaps].map((gap) => (
        <article key={`${gap.dimension || gap.topic}-${gap.message}`} className="workspace-gap-item">
          <strong>{gap.dimension || gap.topic}</strong>
          <p>{gap.message}</p>
        </article>
      ))}
      {!warnings.length && !sessionGaps.length && (
        <p className="workspace-muted">No major evidence gaps detected for the current deterministic comparison.</p>
      )}
      {actions.length > 0 && (
        <div className="workspace-next-actions">
          <h3>Recommended Next Actions</h3>
          {actions.map((action) => <p key={action}>{action}</p>)}
        </div>
      )}
    </div>
  )
}

function summarizeCoverage(analysis) {
  const aiRows = analysis?.ai_comparison?.matrix
  if (Array.isArray(aiRows) && aiRows.length) {
    const cells = aiRows.flatMap((row) => row.cells || [])
    const totalCells = cells.length
    const coveredCells = cells.filter((cell) => cell.summary && !/no .*available|lacks evidence/i.test(cell.summary)).length
    const score = totalCells ? Math.round((coveredCells / totalCells) * 100) : 0
    const gapCount = (analysis.ai_comparison?.research_gaps?.length || 0)
    return { totalCells, coveredCells, gapCount, scoreLabel: `${score}%` }
  }
  if (!analysis?.baseline_dimensions?.length) {
    return { totalCells: 0, coveredCells: 0, gapCount: 0, scoreLabel: 'No data' }
  }
  const cells = analysis.baseline_dimensions.flatMap((row) => row.cells || [])
  const totalCells = cells.length
  const coveredCells = cells.filter((cell) => COVERAGE_RANK[cell.coverage] > 0).length
  const score = totalCells ? Math.round((coveredCells / totalCells) * 100) : 0
  const gapCount = (analysis.gap_panel?.coverage_warnings?.length || 0) + (analysis.gap_panel?.session_specific_gaps?.length || 0)
  return {
    totalCells,
    coveredCells,
    gapCount,
    scoreLabel: `${score}%`,
  }
}

function deterministicRowsToAiShape(rows = []) {
  return rows.map((row) => ({
    ...row,
    cells: (row.cells || []).map((cell) => ({
      ...cell,
      crucial_difference: '',
      evidence_refs: cell.sources || [],
    })),
  }))
}

function confidenceToCoverage(confidence) {
  if (confidence === 'high') return 'strong'
  if (confidence === 'low') return 'thin'
  return 'moderate'
}

function formatDate(value) {
  if (!value) return 'not generated'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
