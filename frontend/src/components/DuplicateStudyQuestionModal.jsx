import { useEffect } from 'react'
import './DuplicateStudyQuestionModal.css'

/**
 * 3-choice modal that appears when POST /qa returns 409 (deep-fix step 2).
 *
 * Scope contract (SCIM D1 — augment, don't replace):
 *  - One click dismisses (Open existing).
 *  - No Anki-style friction; never blocks the save flow beyond this dialog.
 *  - Logs the choice to session_events for research export.
 */
export default function DuplicateStudyQuestionModal({ duplicate, attempted, onChoose, onDismiss }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onDismiss() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onDismiss])

  if (!duplicate) return null

  const pct = Math.round((duplicate.similarity || 0) * 100)

  return (
    <div className="dup-modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onDismiss}>
      <div className="dup-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dup-modal-header">
          <div className="dup-modal-title">Similar study card already exists</div>
          <div className="dup-modal-subtitle">{pct}% match on this highlight</div>
        </div>

        <div className="dup-modal-body">
          <div className="dup-modal-row">
            <div className="dup-modal-label">You asked</div>
            <div className="dup-modal-text">{attempted?.studyQuestion || attempted?.question || '—'}</div>
          </div>
          <div className="dup-modal-row">
            <div className="dup-modal-label">Existing card</div>
            <div className="dup-modal-text">{duplicate.existingStudyQuestion || '—'}</div>
          </div>
        </div>

        <div className="dup-modal-actions">
          <button className="dup-btn dup-btn-primary" onClick={() => onChoose('open_existing')}>
            Open existing
          </button>
          <button className="dup-btn" onClick={() => onChoose('merge')}>
            Merge this answer in
          </button>
          <button className="dup-btn dup-btn-ghost" onClick={() => onChoose('force_save')}>
            Save as new anyway
          </button>
        </div>

        <button className="dup-modal-close" onClick={onDismiss} aria-label="Dismiss">×</button>
      </div>
    </div>
  )
}
