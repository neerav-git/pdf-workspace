import { useEffect, useState } from 'react'
import { getComparativeAnalysis } from '../api/researchSessions'
import { useAppStore } from '../store'
import './ComparativeAnalysis.css'

export default function ComparativeAnalysis() {
  const { selectedPdf, researchSessions } = useAppStore()
  const activeSession = findActiveSession(selectedPdf, researchSessions)
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!activeSession?.id) {
      setAnalysis(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getComparativeAnalysis(activeSession.id)
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
  }, [activeSession?.id])

  if (!selectedPdf) {
    return <div className="compare-empty">Select a PDF to view its research-session comparison.</div>
  }

  if (!activeSession) {
    return <div className="compare-empty">This PDF is not assigned to a research session yet.</div>
  }

  if (loading) {
    return <div className="compare-empty">Building comparative analysis...</div>
  }

  if (error) {
    return <div className="compare-empty compare-error">{error}</div>
  }

  if (!analysis) {
    return null
  }

  return (
    <div className="compare-panel">
      <header className="compare-hero">
        <span className="compare-kicker">Comparative Analysis</span>
        <h2>{analysis.session.title}</h2>
        <p>{analysis.session.context || analysis.session.topic || 'Session-level synthesis from indexed evidence.'}</p>
        <div className="compare-policy">{analysis.data_policy}</div>
      </header>

      <section className="compare-section">
        <div className="compare-section-head">
          <h3>Session Papers</h3>
          <span>{analysis.papers.length} source{analysis.papers.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="paper-grid">
          {analysis.papers.map((paper) => (
            <article key={paper.pdf_id} className="paper-card">
              <h4>{paper.title}</h4>
              <div className="paper-stats">
                <span>{paper.page_count} pages</span>
                <span>{paper.index_entry_count} index entries</span>
                <span>{paper.qa_count} Q&As</span>
                <span>{paper.reviewed_count} reviewed</span>
              </div>
              <div className="topic-chips">
                {(paper.top_concepts.length ? paper.top_concepts : paper.topics.map((label) => ({ label, count: 1 }))).slice(0, 5).map((topic) => (
                  <span key={topic.label}>{topic.label}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="compare-section">
        <div className="compare-section-head">
          <h3>Literature Review Table</h3>
          <span>Traceable to saved index and Q&A evidence</span>
        </div>
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Dimension</th>
                {analysis.papers.map((paper) => <th key={paper.pdf_id}>{paper.title}</th>)}
              </tr>
            </thead>
            <tbody>
              {analysis.baseline_dimensions.map((row) => (
                <tr key={row.key}>
                  <td>
                    <strong>{row.label}</strong>
                    <small>{row.description}</small>
                  </td>
                  {row.cells.map((cell) => (
                    <td key={`${row.key}-${cell.pdf_id}`}>
                      <CoverageBadge coverage={cell.coverage} />
                      <p>{cell.summary}</p>
                      {cell.sources.length > 0 && (
                        <div className="compare-sources">
                          {cell.sources.map((source) => (
                            <span key={`${source.highlight_id}-${source.qa_id}`}>
                              {source.page_number ? `p.${source.page_number}` : 'indexed'} · {source.facet}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="compare-section">
        <div className="compare-section-head">
          <h3>Topic Coverage</h3>
          <span>From ontology, index concepts, and Q&A tags</span>
        </div>
        {analysis.topic_dimensions.length === 0 ? (
          <p className="compare-muted">No topic coverage yet. Generate ontology or save index entries to populate this view.</p>
        ) : (
          <div className="coverage-list">
            {analysis.topic_dimensions.map((dimension) => (
              <div key={dimension.label} className="coverage-row">
                <span className="coverage-label">{dimension.label}</span>
                <div className="coverage-bars">
                  {dimension.cells.map((cell) => (
                    <span
                      key={`${dimension.label}-${cell.pdf_id}`}
                      className={`coverage-bar coverage-${cell.coverage}`}
                      title={`${cell.pdf_title}: ${cell.count}`}
                    />
                  ))}
                </div>
                <span className="coverage-total">{dimension.total_count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="compare-section gap-panel">
        <div className="compare-section-head">
          <h3>Gaps & Next Questions</h3>
          <span>Based on missing indexed evidence</span>
        </div>
        {analysis.gap_panel.coverage_warnings.map((gap) => (
          <div key={`${gap.dimension}-${gap.message}`} className="gap-item">
            <strong>{gap.dimension}</strong>
            <p>{gap.message}</p>
          </div>
        ))}
        {analysis.gap_panel.session_specific_gaps.map((gap) => (
          <div key={gap.topic} className="gap-item">
            <strong>{gap.topic}</strong>
            <p>{gap.message}</p>
          </div>
        ))}
        <ul className="next-actions">
          {analysis.gap_panel.recommended_next_actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function CoverageBadge({ coverage }) {
  return <span className={`coverage-badge coverage-badge-${coverage}`}>{coverage}</span>
}

function findActiveSession(selectedPdf, sessions) {
  if (!selectedPdf?.id) return null
  return sessions.find((session) => (session.pdfs || []).some((pdf) => pdf.id === selectedPdf.id)) || null
}
