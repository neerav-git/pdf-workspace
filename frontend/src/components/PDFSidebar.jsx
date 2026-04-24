import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { listPdfs, uploadPdf, deletePdf } from '../api/pdfs'
import {
  assignPdfToResearchSession,
  createResearchSession,
  listResearchSessions,
  removePdfFromResearchSession,
  suggestPdfPlacement,
  suggestResearchSession,
  updateResearchSession,
} from '../api/researchSessions'
import './PDFSidebar.css'

export default function PDFSidebar() {
  const {
    pdfs,
    researchSessions,
    suggestPlacementAfterUpload,
    setPdfs,
    setResearchSessions,
    setSuggestPlacementAfterUpload,
    selectedPdf,
    selectPdf,
  } = useAppStore()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState(null)
  const [expandedSessions, setExpandedSessions] = useState({})
  const [sessionModal, setSessionModal] = useState(null)
  const [placementPrompt, setPlacementPrompt] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    refreshSessions()
      .catch(() => setError('Failed to load PDFs'))
  }, [])

  const refreshSessions = async () => {
    try {
      const sessions = await listResearchSessions()
      setResearchSessions(sessions)
      setExpandedSessions((prev) => {
        const next = { ...prev }
        for (const session of sessions) {
          if (next[session.id] === undefined) next[session.id] = true
        }
        return next
      })
      return sessions
    } catch (err) {
      // Keep legacy PDF loading as a compatibility fallback if the new endpoint fails.
      const fallbackPdfs = await listPdfs()
      setResearchSessions([])
      setPdfs(fallbackPdfs)
      throw err
    }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setUploadProgress(0)
    setError(null)
    try {
      const pdf = await uploadPdf(file, (evt) => {
        if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100))
      })
      const sessions = await refreshSessions()
      const refreshedPdf = sessions
        .flatMap((session) => session.pdfs || [])
        .find((candidate) => candidate.id === pdf.id)
      selectPdf(refreshedPdf || pdf)
      if (suggestPlacementAfterUpload) {
        const placement = await suggestPdfPlacement(pdf.id)
        setPlacementPrompt({ pdf: refreshedPdf || pdf, placement })
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    await deletePdf(id)
    await refreshSessions()
    if (selectedPdf?.id === id) selectPdf(null)
  }

  const toggleSession = (sessionId) => {
    setExpandedSessions((prev) => ({ ...prev, [sessionId]: !prev[sessionId] }))
  }

  const openCreateSession = () => {
    setSessionModal({ mode: 'create', session: null })
  }

  const openEditSession = (e, session) => {
    e.stopPropagation()
    setSessionModal({ mode: 'edit', session })
  }

  const unsortedSession = researchSessions.find((session) => session.title === 'Unsorted Research')

  const handleSaveSession = async ({ mode, session, title, topic, context, selectedPdfIds }) => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) throw new Error('Session name is required')

    const savedSession = mode === 'edit'
      ? await updateResearchSession(session.id, { title: trimmedTitle, topic, context })
      : await createResearchSession({ title: trimmedTitle, topic, context })

    const targetId = savedSession.id
    const selectedIds = new Set(selectedPdfIds)
    const currentSessionPdfIds = new Set((session?.pdfs || []).map((pdf) => pdf.id))

    for (const pdfId of selectedIds) {
      await assignPdfToResearchSession(targetId, pdfId, false)
      if (unsortedSession && targetId !== unsortedSession.id) {
        await removePdfFromResearchSession(unsortedSession.id, pdfId).catch(() => null)
      }
    }

    if (mode === 'edit') {
      for (const pdfId of currentSessionPdfIds) {
        if (!selectedIds.has(pdfId)) {
          await removePdfFromResearchSession(targetId, pdfId)
        }
      }
    }

    await refreshSessions()
    setSessionModal(null)
  }

  const handleAcceptPlacement = async (sessionId) => {
    if (!placementPrompt?.pdf?.id) return
    setError(null)
    try {
      await assignPdfToResearchSession(sessionId, placementPrompt.pdf.id, true)
      await refreshSessions()
      setPlacementPrompt(null)
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not place PDF')
    }
  }

  const hasSessions = researchSessions.length > 0
  const hasPdfs = pdfs.length > 0

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-group">
          <span className="sidebar-title">Research Sessions</span>
          <span className="sidebar-subtitle">PDFs grouped by research goal</span>
        </div>
        <button
          className="session-add-btn"
          onClick={openCreateSession}
          title="Create research session"
          type="button"
        >
          + Session
        </button>
        <button
          className="upload-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload PDF"
        >
          {uploading ? `${uploadProgress}%` : '+ Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {error && <p className="sidebar-error">{error}</p>}

      <label className="placement-toggle">
        <input
          type="checkbox"
          checked={suggestPlacementAfterUpload}
          onChange={(e) => setSuggestPlacementAfterUpload(e.target.checked)}
        />
        <span>
          <strong>Suggest placement after upload</strong>
          <small>Uploads still start in Unsorted until you confirm.</small>
        </span>
      </label>

      <div className="session-list">
        {!hasPdfs && !uploading && (
          <div className="pdf-list-empty">No PDFs yet</div>
        )}

        {hasSessions ? (
          researchSessions.map((session) => {
            const isExpanded = expandedSessions[session.id] !== false
            const pdfCount = session.pdf_count ?? session.pdfs?.length ?? 0
            return (
              <section className="session-group" key={session.id}>
                <div
                  className="session-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSession(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleSession(session.id)
                  }}
                  aria-expanded={isExpanded}
                >
                  <span className="session-caret">{isExpanded ? '▾' : '▸'}</span>
                  <span className="session-folder">▣</span>
                  <span className="session-info">
                    <span className="session-title">{session.title}</span>
                    {session.context && (
                      <span className="session-context">{session.context}</span>
                    )}
                  </span>
                  <span className="session-count">{pdfCount}</span>
                  <button
                    className="session-edit"
                    type="button"
                    title="Edit session"
                    onClick={(e) => openEditSession(e, session)}
                  >
                    Edit
                  </button>
                </div>

                {isExpanded && (
                  <ul className="pdf-list">
                    {pdfCount === 0 && (
                      <li className="pdf-list-empty session-empty">No PDFs in this session</li>
                    )}
                    {(session.pdfs || []).map((pdf) => (
                      <PdfItem
                        key={pdf.id}
                        pdf={pdf}
                        selected={selectedPdf?.id === pdf.id}
                        onSelect={() => selectPdf(pdf)}
                        onDelete={handleDelete}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })
        ) : (
          <ul className="pdf-list">
            {pdfs.map((pdf) => (
              <PdfItem
                key={pdf.id}
                pdf={pdf}
                selected={selectedPdf?.id === pdf.id}
                onSelect={() => selectPdf(pdf)}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>
      {sessionModal && (
        <ResearchSessionModal
          mode={sessionModal.mode}
          session={sessionModal.session}
          sessions={researchSessions}
          pdfs={pdfs}
          onClose={() => setSessionModal(null)}
          onSave={handleSaveSession}
        />
      )}
      {placementPrompt && (
        <PlacementSuggestionModal
          prompt={placementPrompt}
          onAccept={handleAcceptPlacement}
          onClose={() => setPlacementPrompt(null)}
        />
      )}
    </aside>
  )
}

function PlacementSuggestionModal({ prompt, onAccept, onClose }) {
  const suggestions = prompt.placement?.suggestions || []
  const pdfTitle = prompt.placement?.pdf_title || prompt.pdf?.title || 'Uploaded PDF'

  return (
    <div className="session-modal-backdrop" onMouseDown={onClose}>
      <div className="session-modal placement-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="session-modal-header">
          <div>
            <h2>Place Uploaded PDF?</h2>
            <p>{pdfTitle} was uploaded to Unsorted. Choose a suggested session only if it fits.</p>
          </div>
          <button type="button" className="session-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="placement-suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.session_id}
              type="button"
              className="placement-suggestion"
              onClick={() => onAccept(suggestion.session_id)}
            >
              <span className="placement-suggestion-head">
                <strong>{suggestion.session_title}</strong>
                <span>{suggestion.confidence}%</span>
              </span>
              <small>{suggestion.rationale}</small>
            </button>
          ))}
        </div>

        <div className="session-modal-actions">
          <button type="button" className="session-modal-secondary" onClick={onClose}>
            Keep in Unsorted
          </button>
        </div>
      </div>
    </div>
  )
}

function ResearchSessionModal({ mode, session, sessions, pdfs, onClose, onSave }) {
  const [title, setTitle] = useState(session?.title || '')
  const [topic, setTopic] = useState(session?.topic || '')
  const [context, setContext] = useState(session?.context || '')
  const [selectedPdfIds, setSelectedPdfIds] = useState(() => new Set((session?.pdfs || []).map((pdf) => pdf.id)))
  const [suggestion, setSuggestion] = useState(null)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState(null)

  const sessionByPdfId = new Map()
  for (const existingSession of sessions) {
    for (const pdf of existingSession.pdfs || []) {
      const titles = sessionByPdfId.get(pdf.id) || []
      sessionByPdfId.set(pdf.id, [...titles, existingSession.title])
    }
  }

  const togglePdf = (pdfId) => {
    setSelectedPdfIds((prev) => {
      const next = new Set(prev)
      if (next.has(pdfId)) next.delete(pdfId)
      else next.add(pdfId)
      return next
    })
  }

  const handleSuggest = async () => {
    setSuggesting(true)
    setError(null)
    try {
      const selected = Array.from(selectedPdfIds)
      const result = await suggestResearchSession(selected)
      setSuggestion(result)
      setTitle(result.title || '')
      setTopic(result.topic || '')
      setContext(result.context || '')
      setSelectedPdfIds(new Set(result.candidate_pdf_ids || []))
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not generate a suggestion')
    } finally {
      setSuggesting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({
        mode,
        session,
        title,
        topic,
        context,
        selectedPdfIds: Array.from(selectedPdfIds),
      })
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Could not save session')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="session-modal-backdrop" onMouseDown={onClose}>
      <form className="session-modal" onSubmit={handleSubmit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="session-modal-header">
          <div>
            <h2>{mode === 'edit' ? 'Edit Research Session' : 'Add Research Session'}</h2>
            <p>Describe the research goal so future summaries, takeaways, and comparisons have a stable frame.</p>
          </div>
          <button type="button" className="session-modal-close" onClick={onClose}>×</button>
        </div>

        <label className="session-field">
          <span>Session name</span>
          <small>
            Short sidebar and report label. Use a project or reading-cluster name, not just one PDF title.
          </small>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Learning Design Research" />
        </label>

        <label className="session-field">
          <span>Topic</span>
          <small>
            Broad subject area for concept tagging, recommendations, and future gap analysis.
          </small>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Learning interface design" />
        </label>

        <label className="session-field">
          <span>Research context</span>
          <small>
            Your goal, scope, questions, assumptions, or what you want to compare and remember from this session.
          </small>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="What are you trying to learn, compare, retain, or build from these PDFs?"
            rows={4}
          />
        </label>

        <div className="session-pdf-picker">
          <div className="session-pdf-picker-head">
            <span>PDFs in this session</span>
            <button type="button" onClick={handleSuggest} disabled={suggesting || pdfs.length === 0}>
              {suggesting ? 'Suggesting...' : 'Suggest from PDFs'}
            </button>
          </div>
          <p className="session-pdf-hint">
            Checked PDFs join this session when you save. A PDF can belong to multiple sessions.
          </p>
          <div className="session-pdf-options">
            {pdfs.map((pdf) => (
              <label key={pdf.id} className="session-pdf-option">
                <input
                  type="checkbox"
                  checked={selectedPdfIds.has(pdf.id)}
                  onChange={() => togglePdf(pdf.id)}
                />
                <span className="session-pdf-option-text">
                  <span>{pdf.title}</span>
                  <small>{(sessionByPdfId.get(pdf.id) || ['Unassigned']).join(', ')} · {pdf.page_count} pages</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        {suggestion?.rationale && (
          <div className="session-suggestion-note">
            <strong>Suggestion rationale:</strong> {suggestion.rationale}
          </div>
        )}

        {error && <div className="session-modal-error">{error}</div>}

        <div className="session-modal-actions">
          <button type="button" className="session-modal-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="session-modal-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save session'}
          </button>
        </div>
      </form>
    </div>
  )
}

function PdfItem({ pdf, selected, onSelect, onDelete }) {
  return (
    <li
      className={`pdf-item ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="pdf-icon">□</div>
      <div className="pdf-info">
        <span className="pdf-title">{pdf.title}</span>
        <span className="pdf-meta">{pdf.page_count} pages</span>
      </div>
      <button
        className="pdf-delete"
        onClick={(e) => onDelete(e, pdf.id)}
        title="Delete"
      >
        ×
      </button>
    </li>
  )
}
