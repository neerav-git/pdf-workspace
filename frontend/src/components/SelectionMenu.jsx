import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { findRelatedEntries } from '../utils/indexMatch'
import './SelectionMenu.css'

const ACTIONS = [
  { id: 'explain', group: 'ask', icon: '❓', label: 'Explain', prompt: (t) => `Explain this passage in detail:\n\n"${t}"` },
  { id: 'simplify', group: 'ask', icon: '✨', label: 'Simplify', prompt: (t) => `Explain this in simple, plain language:\n\n"${t}"` },
  { id: 'terms', group: 'ask', icon: '📖', label: 'Key Terms', prompt: (t) => `Identify and define the key terms and concepts in:\n\n"${t}"` },
  { id: 'summarise', group: 'ask', icon: '📋', label: 'Summarise', prompt: (t) => `Summarise this passage in 2–3 sentences:\n\n"${t}"` },
  { id: 'voice', group: 'ask', icon: '🎤', label: 'Ask by Voice', prompt: null },
  { id: 'quiz', group: 'practice', icon: '🧠', label: 'Quiz Me', prompt: (t) => `Create a quiz question to help me remember this passage:\n\n"${t}"\n\nWrite your response in this exact format:\n**Question:** <your question here>\n\n**Answer:** <your answer here>` },
  { id: 'note', group: 'save', icon: '📌', label: 'Save Note', prompt: null, tooltip: 'Saves text as an annotation only — no study card created' },
]

const ACTION_GROUPS = [
  { id: 'ask', label: 'Ask Now' },
  { id: 'practice', label: 'Practice Now' },
  { id: 'save', label: 'Save Only' },
]

export default function SelectionMenu({ position, text, pageNumber, sectionTitle, sectionPath, onAction, onClose }) {
  const ref = useRef(null)
  const { highlightIndex, selectedPdf } = useAppStore()

  // Find related index entries for this selection
  const pdfEntries = highlightIndex.filter((e) => e.pdfId === selectedPdf?.id)
  const related = findRelatedEntries(pdfEntries, text, pageNumber)
  const qaCount = related.reduce((n, e) => n + e.qaPairs.length, 0)
  const hasIndex = related.length > 0

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // After mount: measure rendered size and flip/clamp to stay inside the viewport.
  // Done imperatively to avoid a state-triggered re-render that would cause flicker.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const menuW = el.offsetWidth
    const menuH = el.offsetHeight
    const vw = window.innerWidth
    const MARGIN = 8   // minimum gap from viewport edge
    const GAP = 10     // gap between selection point and menu edge

    // ── Vertical ──────────────────────────────────────────────────────────────
    const spaceAbove = position.y - GAP
    // Flip if not enough room above, or if Y is too close to top (e.g. under toolbar)
    const flipped = spaceAbove < menuH + MARGIN || position.y < 120

    if (flipped) {
      el.style.transform = `translate(-50%, ${GAP}px)`
      // Flip the arrow to point upward toward the selection
      const arrow = el.querySelector('.sel-menu-arrow')
      if (arrow) {
        arrow.style.bottom = 'auto'
        arrow.style.top = '-6px'
        arrow.style.transform = 'translateX(-50%) scaleY(-1)'
      }
    }
    // else keep the default transform (already set via React style prop)

    // ── Horizontal clamp ──────────────────────────────────────────────────────
    const rawLeft = position.x - menuW / 2
    if (rawLeft < MARGIN) {
      el.style.left = `${menuW / 2 + MARGIN}px`
    } else if (rawLeft + menuW > vw - MARGIN) {
      el.style.left = `${vw - menuW / 2 - MARGIN}px`
    }

    // Reveal now that position is correct
    el.style.visibility = 'visible'
  }, [position.x, position.y])

  // Initial style: hidden above the selection point. After mount we measure and
  // flip/clamp so the menu is always fully inside the viewport.
  const style = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    transform: 'translate(-50%, calc(-100% - 10px))',
    visibility: 'hidden',
  }

  const preview = text.length > 60 ? text.slice(0, 60).trimEnd() + '…' : text

  const fire = (action) => {
    onAction({
      id: action.id,
      prompt: action.prompt ? action.prompt(text) : null,
      text,
      pageNumber,
      sectionTitle: sectionTitle || null,
      sectionPath: sectionPath || [],
    })
    onClose()
  }

  return (
    <div className="sel-menu" ref={ref} style={style}>
      <div className="sel-menu-arrow" />
      <div className="sel-menu-preview" title={text}>"{preview}"</div>
      {sectionTitle && <div className="sel-menu-context">{sectionTitle} · p.{pageNumber}</div>}

      <div className="sel-menu-actions">
        {ACTION_GROUPS.map((group) => (
          <div key={group.id} className="sel-menu-group">
            <div className="sel-menu-group-title">{group.label}</div>
            <div className="sel-menu-group-buttons">
              {ACTIONS.filter((action) => action.group === group.id).map((action) => (
                <button
                  key={action.id}
                  className={`sel-menu-btn sel-menu-btn-${action.group}`}
                  title={action.tooltip || action.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => fire(action)}
                >
                  <span className="sel-menu-btn-icon">{action.icon}</span>
                  <span className="sel-menu-btn-label">{action.label}</span>
                </button>
              ))}

              {group.id === 'save' && (
                <button
                  className={`sel-menu-btn sel-menu-btn-index ${hasIndex ? 'has-entries' : 'no-entries'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => fire({ id: 'view-index', prompt: null })}
                  title={hasIndex ? `Open ${qaCount} study card${qaCount !== 1 ? 's' : ''} in the index` : 'Open the index for this PDF'}
                >
                  <span className="sel-menu-btn-icon">{hasIndex ? '📚' : '🗂️'}</span>
                  <span className="sel-menu-btn-label">
                    {hasIndex ? `Open ${qaCount} Study Card${qaCount !== 1 ? 's' : ''}` : 'Open Index'}
                  </span>
                  {hasIndex && <span className="sel-menu-index-badge">{related.length}</span>}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
