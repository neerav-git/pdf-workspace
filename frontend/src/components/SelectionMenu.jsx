import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { findRelatedEntries } from '../utils/indexMatch'
import './SelectionMenu.css'

const ACTIONS = [
  { id: 'explain',    icon: '❓', label: 'Explain',      prompt: (t) => `Explain this passage in detail:\n\n"${t}"` },
  { id: 'simplify',  icon: '✨', label: 'Simplify',     prompt: (t) => `Explain this in simple, plain language:\n\n"${t}"` },
  { id: 'terms',     icon: '📖', label: 'Key Terms',    prompt: (t) => `Identify and define the key terms and concepts in:\n\n"${t}"` },
  { id: 'quiz',      icon: '🧠', label: 'Quiz Me',      prompt: (t) => `Create a quiz question (with answer) to help me remember:\n\n"${t}"` },
  { id: 'summarise', icon: '📋', label: 'Summarise',    prompt: (t) => `Summarise this passage in 2–3 sentences:\n\n"${t}"` },
  { id: 'voice',     icon: '🎤', label: 'Ask by voice', prompt: null },
  { id: 'note',      icon: '📌', label: 'Save note',    prompt: null },
]

export default function SelectionMenu({ position, text, pageNumber, onAction, onClose }) {
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
    const flipped = spaceAbove < menuH + MARGIN   // not enough room above → go below

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
    onAction({ id: action.id, prompt: action.prompt ? action.prompt(text) : null, text, pageNumber })
    onClose()
  }

  return (
    <div className="sel-menu" ref={ref} style={style}>
      <div className="sel-menu-arrow" />
      <div className="sel-menu-preview" title={text}>"{preview}"</div>

      <div className="sel-menu-actions">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            className="sel-menu-btn"
            title={action.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fire(action)}
          >
            <span className="sel-menu-btn-icon">{action.icon}</span>
            <span className="sel-menu-btn-label">{action.label}</span>
          </button>
        ))}

        {/* Index button — full width, state-aware */}
        <button
          className={`sel-menu-btn sel-menu-btn-index ${hasIndex ? 'has-entries' : 'no-entries'}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => fire({ id: 'view-index', prompt: null })}
          title={hasIndex ? `View ${qaCount} Q&A${qaCount !== 1 ? 's' : ''} in index` : 'No index entries yet for this passage'}
        >
          <span className="sel-menu-btn-icon">{hasIndex ? '📚' : '📭'}</span>
          <span className="sel-menu-btn-label">
            {hasIndex ? `Index · ${qaCount} Q&A${qaCount !== 1 ? 's' : ''}` : 'Index (empty)'}
          </span>
          {hasIndex && <span className="sel-menu-index-badge">{related.length}</span>}
        </button>
      </div>
    </div>
  )
}
