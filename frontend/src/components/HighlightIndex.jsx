import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { useAppStore } from '../store'
import { findRelatedEntries } from '../utils/indexMatch'
import { getRelatedChunks, synthesizeEntry } from '../api/pdfs'
import { fetchReviewStats, fetchCardReviewData } from '../api/review'
import './HighlightIndex.css'

// Card-type → UI metadata. Drives badges, subtitles, and whether the card is
// treated as an action card (explain/simplify/terms/summarise/quiz) vs a
// user-authored study question (manual/chat). Server owns the `card_type`
// column; this is pure display glue.

const CARD_TYPE_META = {
  manual:    { isAction: false, label: null,         subtitle: 'Study question' },
  chat:      { isAction: false, label: null,         subtitle: 'Study question' },
  explain:   { isAction: true,  label: 'Explain',    subtitle: 'Build understanding' },
  simplify:  { isAction: true,  label: 'Simplify',   subtitle: 'Simplify the idea' },
  terms:     { isAction: true,  label: 'Key Terms',  subtitle: 'Vocabulary and concepts' },
  summarise: { isAction: true,  label: 'Summarise',  subtitle: 'High-level summary' },
  quiz:      { isAction: true,  label: 'Quiz Me',    subtitle: 'Retrieval practice' },
}

function cardMeta(cardType) {
  return CARD_TYPE_META[cardType] || CARD_TYPE_META.manual
}

const FACET_META = {
  objective:     { label: 'Objective', tone: 'objective' },
  novelty:       { label: 'Novelty', tone: 'novelty' },
  method:        { label: 'Method', tone: 'method' },
  result:        { label: 'Result', tone: 'result' },
  background:    { label: 'Background', tone: 'background' },
  uncategorized: { label: 'Uncategorized', tone: 'uncategorized' },
}

function facetMeta(facet) {
  return FACET_META[facet] || FACET_META.uncategorized
}

// Display question for a card.
//
// For user-authored cards (manual/chat), we prefer the user's RAW input
// (originalQuestion) — that's what they typed, and it's what they'll remember
// typing when searching the index. The Haiku-rewritten studyQuestion appears
// as the "Saved as:" caption beneath so both are visible (generation effect).
//
// For action cards (explain/simplify/terms/summarise/quiz), the user never
// authored a question — the canonical studyQuestion IS the authoritative
// phrasing and should be the title.
function resolveDisplayQuestion(qa) {
  const type = qa.cardType || 'manual'
  if (type === 'manual' || type === 'chat') {
    return qa.originalQuestion || qa.studyQuestion || qa.question || ''
  }
  return qa.studyQuestion || qa.question || qa.originalQuestion || ''
}

function normalizeQuestionText(text) {
  return (text || '').replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '').toLowerCase()
}

function isMeaningfulSectionTitle(title) {
  if (!title) return false
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean) return false
  if (/^arxiv:/i.test(clean)) return false
  if (/^\[?[a-z]{2}\.[A-Z]{2}\]?/i.test(clean)) return false
  if (/^T\d/i.test(clean)) return false
  if (/^fig\.?\s*\d+/i.test(clean)) return false
  if (/^table\s*\d+/i.test(clean)) return false
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return false
  if (/\b\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\b/.test(clean)) return false
  if (clean.length > 90) return false
  return true
}

function normalizeSectionPath(entry) {
  const deepPath = (entry.deepSectionPath || []).filter((node) => isMeaningfulSectionTitle(node?.title))
  const sectionPath = (entry.sectionPath || []).filter((node) => isMeaningfulSectionTitle(node?.title))

  if (deepPath.length > 0) return deepPath
  if (sectionPath.length > 0) return sectionPath

  if (isMeaningfulSectionTitle(entry.sectionTitle)) {
    return [{ level: 1, title: entry.sectionTitle }]
  }

  return []
}

function getEntrySectionLabel(entry) {
  const path = normalizeSectionPath(entry)
  if (path.length > 0) return path[path.length - 1].title
  return entry.clusterTag || null
}

function getEntrySectionContext(entry) {
  const path = normalizeSectionPath(entry)
  if (path.length <= 1) return null
  return path.map((p) => p.title).join(' → ')
}

function getLearningCardLabel(qa, entry) {
  const type = qa.cardType || 'manual'
  const meta = cardMeta(type)
  const section = getEntrySectionLabel(entry)
  const sectionContext = getEntrySectionContext(entry)
  const sectionText = sectionContext || section
  const subtitle = sectionText ? `${meta.subtitle} · ${sectionText}` : meta.subtitle

  const title = resolveDisplayQuestion(qa) || meta.label || 'Study card'

  // For user-authored cards (manual/chat), if the server canonicalized a
  // different phrasing than what the user typed, surface both — the raw
  // input stays visible (generation effect) and the canonical shows as the
  // "Saved as" caption.
  let derivedQuestion = null
  if (!meta.isAction) {
    const original = qa.originalQuestion?.trim() || null
    const study = qa.studyQuestion?.trim() || null
    if (original && study && normalizeQuestionText(original) !== normalizeQuestionText(study)) {
      derivedQuestion = study
    }
  }

  return { title, subtitle, type, isAction: meta.isAction, derivedQuestion }
}

function getEntryFocusLabel(entry) {
  if (!entry.qaPairs?.length) return null
  const primary = [...entry.qaPairs].sort((a, b) => {
    if (b.starred !== a.starred) return Number(b.starred) - Number(a.starred)
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  })[0]
  return getLearningCardLabel(primary, entry)
}

function getDueStatus(entry) {
  const now = Date.now()
  const qas = entry.qaPairs || []
  const due = qas.filter((qa) => qa.dueAt && new Date(qa.dueAt).getTime() <= now && qa.state !== 'suspended')
  const learning = qas.filter((qa) => qa.state === 'learning' || qa.state === 'relearning')
  const fresh = qas.filter((qa) => qa.state === 'new')

  if (due.length > 0) return { tone: 'due', label: due.length === 1 ? '1 due now' : `${due.length} due now` }
  if (learning.length > 0) return { tone: 'learning', label: learning.length === 1 ? '1 in learning' : `${learning.length} in learning` }
  if (fresh.length > 0) return { tone: 'new', label: fresh.length === 1 ? '1 new card' : `${fresh.length} new cards` }
  return { tone: 'reviewed', label: qas.length === 1 ? '1 reviewed card' : `${qas.length} reviewed cards` }
}

// ── Concept helpers ───────────────────────────────────────────────────────────

/**
 * Build concept → entries map for the By Concept view.
 * An entry appears once per concept it carries.
 * Returns [{concept, entries[]}] sorted by entry count descending.
 */
function groupByConcept(entries) {
  const map = {}
  for (const entry of entries) {
    for (const concept of (entry.concepts || [])) {
      if (!map[concept]) map[concept] = []
      map[concept].push(entry)
    }
  }
  return Object.entries(map)
    .map(([concept, items]) => ({ concept, entries: items }))
    .sort((a, b) => b.entries.length - a.entries.length)
}

// ── Grouping ──────────────────────────────────────────────────────────────────

function groupByPage(entries) {
  const map = {}
  for (const entry of entries) {
    if (!map[entry.pageNumber]) map[entry.pageNumber] = []
    map[entry.pageNumber].push(entry)
  }
  return Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([page, items]) => ({ page: Number(page), items }))
}

/**
 * Build a two-level hierarchy from sectionPath data:
 *   [ { h1Title, minPage, subsections: [ { h2Title, entries[] }, ... ] }, ... ]
 *
 * Entries with no sectionPath land under "— Uncategorized —" with no subsection.
 * Entries with only an H1 appear directly under that H1 with subsection title null.
 */
function groupByHierarchy(entries) {
  const h1Map = {}   // h1Title → { h1Title, minPage, subsections: { h2Key → {h2Title, minPage, entries[]} } }

  for (const entry of entries) {
    const path = normalizeSectionPath(entry)
    const h1Node = path.find((p) => p.level === 1)
    // Use L2 when present; fall back to L3 for PDFs where subheadings are bold
    // body-size text (no distinct L2 font tier) — e.g. "Description", "Precautions"
    const h2Node = path.find((p) => p.level === 2) || path.find((p) => p.level === 3)

    const h1Key = h1Node?.title || entry.clusterTag || 'Other Passages'
    const h2Key = h2Node?.title || null

    if (!h1Map[h1Key]) {
      h1Map[h1Key] = { h1Title: h1Key, minPage: entry.pageNumber, subsections: {} }
    }
    const h1 = h1Map[h1Key]
    if (entry.pageNumber < h1.minPage) h1.minPage = entry.pageNumber

    const subKey = h2Key || '__root__'
    if (!h1.subsections[subKey]) {
      h1.subsections[subKey] = { h2Title: h2Key, minPage: entry.pageNumber, entries: [] }
    }
    const sub = h1.subsections[subKey]
    sub.entries.push(entry)
    if (entry.pageNumber < sub.minPage) sub.minPage = entry.pageNumber
  }

  // Sort h1 by first page; within each h1 sort subsections by first page
  return Object.values(h1Map)
    .sort((a, b) => a.minPage - b.minPage)
    .map((h1) => ({
      ...h1,
      subsections: Object.values(h1.subsections).sort((a, b) => a.minPage - b.minPage),
    }))
}

// ── Q&A display helpers ───────────────────────────────────────────────────────

/**
 * Return the first complete sentence of `text`, capped at `maxLen` chars.
 * Scans for the first `.` / `!` / `?` followed by whitespace or end-of-string
 * within the window [minLen, maxLen].  Falls back to hard-truncation with `…`.
 */
function firstSentence(text, minLen = 30, maxLen = 130) {
  const src = text.replace(/\s+/g, ' ').trim()
  for (let i = minLen; i < Math.min(src.length, maxLen + 10); i++) {
    const ch = src[i]
    if (['.', '!', '?'].includes(ch)) {
      const next = src[i + 1]
      if (!next || next === ' ' || next === '\n') {
        const sentence = src.slice(0, i + 1)
        return sentence.length <= maxLen ? sentence : sentence.slice(0, maxLen).trimEnd() + '…'
      }
    }
  }
  return src.length <= maxLen ? src : src.slice(0, maxLen).trimEnd() + '…'
}

/**
 * Convert an ISO timestamp to a compact relative string: "now", "5m", "3h", "2d", "1w", "3mo".
 */
function relativeTime(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2)   return 'now'
  if (mins < 60)  return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)  return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5)  return `${weeks}w`
  return `${Math.floor(days / 30)}mo`
}

// ── SynthesisDisplay — collapsible synthesis block ───────────────────────────

function SynthesisDisplay({ entry, runSynthesis, runDeepSynthesis, clearDeepSynthesis, deepSynthesis, deepLoading }) {
  // Default collapsed so the entry body stays compact — synthesis is a
  // large block and dominates the layout when expanded by default.
  const [collapsed, setCollapsed] = useState(true)
  return (
    <div className="idx-synthesis-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="idx-synthesis-block">
        <div className="idx-synthesis-header">
          <span className="idx-synthesis-label">✦ Synthesis</span>
          <div className="idx-synthesis-actions">
            <button
              className="idx-synthesis-collapse"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v) }}
              title={collapsed ? 'Expand synthesis' : 'Collapse synthesis'}
            >
              {collapsed ? '▸' : '▾'}
            </button>
            <button
              className="idx-synthesis-regen"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); runSynthesis() }}
              title="Regenerate synthesis from current Q&As"
            >
              ↺
            </button>
          </div>
        </div>
        {!collapsed && <p className="idx-synthesis-text">{entry.synthesis}</p>}
      </div>
      <div className="idx-synthesis-deep-actions">
        {!deepSynthesis && (
          <button
            className="idx-synthesis-deep-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); runDeepSynthesis() }}
            disabled={deepLoading}
            title="Expand this into a deeper study synthesis"
          >
            {deepLoading ? 'Building deep dive…' : 'Dive deeper'}
          </button>
        )}
        {deepSynthesis && (
          <button
            className="idx-synthesis-deep-btn idx-synthesis-deep-btn--secondary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); clearDeepSynthesis() }}
            title="Hide deep synthesis"
          >
            Hide deep dive
          </button>
        )}
      </div>
      {deepSynthesis && (
        <div className="idx-synthesis-deep-block">
          <div className="idx-synthesis-deep-label">Deep synthesis</div>
          <p className="idx-synthesis-deep-text">{deepSynthesis}</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HighlightIndex() {
  const {
    highlightIndex, selectedPdf,
    requestNav, setFlashHighlight,
    indexFocus, clearIndexFocus,
    toggleStarEntry, toggleStarQA,
    toggleFlagEntry, toggleAnchorEntry, toggleReviewedEntry,
    deleteIndexEntry, deleteIndexQA,
    setEntryNote,
    setSynthesis,
    setDeepSynthesis,
    openReview,
  } = useAppStore()

  // ── Review stats (global due count for review bar badge) ───────────────────
  const [globalDueCount, setGlobalDueCount] = useState(null)
  useEffect(() => {
    if (!selectedPdf?.id) return
    fetchReviewStats()
      .then((s) => setGlobalDueCount(s.due_now))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPdf?.id, highlightIndex.length])

  const [view, setView]                     = useState('page') // 'page'|'section'|'concept'|'starred'
  const [activeConcept, setActiveConcept]   = useState(null)
  const [starredFilter, setStarredFilter]   = useState('stars') // 'stars'|'anchored'|'flagged'
  const [focusedEntryId, setFocusedEntryId] = useState(null)
  const [openEntries, setOpenEntries]       = useState({})    // entryId → bool
  const [expandedQAs, setExpandedQAs]       = useState({})    // qaId → bool
  const [editingNote, setEditingNote]       = useState({})    // entryId → bool
  const [synthesizing, setSynthesizing]     = useState({})    // entryId → bool
  const [deepSynthesizing, setDeepSynthesizing] = useState({}) // entryId → bool
  const [expandedChips, setExpandedChips]   = useState({})    // entryId → bool (show all chips)
  const [chipBarExpanded, setChipBarExpanded] = useState(false) // Concepts tab chip bar
  const [relatedMap, setRelatedMap]         = useState({})    // entryId → related[] | 'loading' | 'done'
  const entryRefs = useRef({})

  const pdfEntries = highlightIndex.filter((e) => e.pdfId === selectedPdf?.id)

  // Default entries collapsed — an index with 20+ passages is unreadable when
  // everything is expanded. Click an entry to open it; focused-from-chat flow
  // still auto-opens its target (see indexFocus effect below).
  useEffect(() => {
    setOpenEntries((prev) => {
      const next = { ...prev }
      for (const e of pdfEntries) if (!(e.id in next)) next[e.id] = false
      return next
    })
  }, [pdfEntries.length])

  // Resolve indexFocus scroll
  useEffect(() => {
    if (!indexFocus || !pdfEntries.length) return
    const focusedById = indexFocus.entryId
      ? pdfEntries.find((entry) => entry.id === indexFocus.entryId)
      : null
    const related = focusedById
      ? [focusedById]
      : findRelatedEntries(pdfEntries, indexFocus.text, indexFocus.pageNumber)

    if (related.length > 0) {
      const id = related[0].id
      setFocusedEntryId(id)
      setOpenEntries((prev) => ({ ...prev, [id]: true }))
      if (indexFocus.qaId) {
        setExpandedQAs((prev) => ({ ...prev, [indexFocus.qaId]: true }))
      }
      setView('page')
      setTimeout(() => {
        entryRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
    clearIndexFocus()
  }, [indexFocus, pdfEntries.length])

  // Lazy-load related passages for an entry the first time it's expanded
  const loadRelated = useCallback((entry) => {
    if (!entry.chunkId || relatedMap[entry.id]) return
    setRelatedMap((prev) => ({ ...prev, [entry.id]: 'loading' }))
    getRelatedChunks(entry.pdfId, entry.chunkId, 3).then((related) => {
      setRelatedMap((prev) => ({ ...prev, [entry.id]: related }))
    })
  }, [relatedMap])

  // ── empty states ───────────────────────────────────────────────────────────

  if (!selectedPdf) {
    return <div className="idx-empty"><span>Select a PDF to view its index.</span></div>
  }

  if (pdfEntries.length === 0) {
    return (
      <div className="idx-empty">
        <span className="idx-empty-icon">📭</span>
        <p>Your index is empty.</p>
        <p className="idx-empty-hint">
          Highlight text → ask a question → save it to the index.
          Come back via the 📚 button in the hover menu.
        </p>
      </div>
    )
  }

  // ── derived data ───────────────────────────────────────────────────────────

  const totalQA        = pdfEntries.reduce((n, e) => n + e.qaPairs.length, 0)
  const totalStarred   = pdfEntries.reduce((n, e) => n + e.qaPairs.filter((q) => q.starred).length, 0)
  const totalAnchored  = pdfEntries.filter((e) => e.anchored).length
  const totalFlagged   = pdfEntries.filter((e) => e.flagged).length
  const totalCurated   = totalStarred + totalAnchored + totalFlagged
  const pdfDueCount    = pdfEntries.reduce(
    (n, entry) => n + entry.qaPairs.filter((qa) => qa.dueAt && new Date(qa.dueAt).getTime() <= Date.now() && qa.state !== 'suspended').length,
    0,
  )
  const pages          = groupByPage(pdfEntries)
  const hierarchy      = groupByHierarchy(pdfEntries)
  const conceptGroups  = groupByConcept(pdfEntries)
  const facetCount     = new Set(
    pdfEntries.flatMap((e) => e.qaPairs.map((q) => q.rhetoricalFacet || 'uncategorized')),
  ).size
  const totalConcepts  = conceptGroups.length

  const starredQAs = pdfEntries
    .flatMap((e) => e.qaPairs.filter((q) => q.starred).map((q) => ({ ...q, entry: e })))
    .sort((a, b) => a.entry.pageNumber - b.entry.pageNumber)

  const toggleExpand = (qaId) =>
    setExpandedQAs((prev) => ({ ...prev, [qaId]: !prev[qaId] }))

  // ── Chip row renderer ─────────────────────────────────────────────────────
  // Shows up to MAX_VISIBLE_CHIPS concept chips; a "+N" overflow button expands
  // in place to reveal the rest.  `navigable` controls whether clicking a chip
  // switches to the Concepts view (true in By Page / By Section headers;
  // false in Curated cards where chips are display-only).

  const MAX_VISIBLE_CHIPS = 5

  function ConceptChips({ entry, navigable = true, stopProp = true }) {
    if (!entry.concepts?.length) return null
    const allExpanded  = !!expandedChips[entry.id]
    const visible      = allExpanded ? entry.concepts : entry.concepts.slice(0, MAX_VISIBLE_CHIPS)
    const overflowCount = entry.concepts.length - MAX_VISIBLE_CHIPS

    return (
      <div className="idx-concept-row">
        {visible.map((c) => (
          navigable
            ? (
              <button
                key={c}
                className="idx-concept-tag"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  if (stopProp) e.stopPropagation()
                  setView('concept')
                  setActiveConcept(c)
                }}
                title={`Browse all passages tagged "${c}"`}
              >
                {c}
              </button>
            )
            : <span key={c} className="idx-concept-tag static">{c}</span>
        ))}
        {overflowCount > 0 && (
          <button
            className="idx-concept-overflow"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              setExpandedChips((p) => ({ ...p, [entry.id]: !p[entry.id] }))
            }}
            title={allExpanded ? 'Show fewer' : `${overflowCount} more concept${overflowCount !== 1 ? 's' : ''}`}
          >
            {allExpanded ? '−' : `+${overflowCount}`}
          </button>
        )}
      </div>
    )
  }

  // ── Curation toggle bar ───────────────────────────────────────────────────
  // Shown in every entry header right-side, before chevron/delete.

  function CurationBar({ entry }) {
    return (
      <div className="idx-curation-bar" onClick={(e) => e.stopPropagation()}>
        <button
          className={`idx-curation-btn ${entry.flagged ? 'on flag' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleFlagEntry(entry.id)}
          title={entry.flagged ? 'Unflag' : 'Flag — needs attention'}
        >🚩</button>
        <button
          className={`idx-curation-btn ${entry.anchored ? 'on anchor' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleAnchorEntry(entry.id)}
          title={entry.anchored ? 'Remove anchor' : 'Anchor — foundational concept'}
        >⚓</button>
        <button
          className={`idx-curation-btn ${entry.reviewed ? 'on reviewed' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleReviewedEntry(entry.id)}
          title={entry.reviewed ? 'Mark unreviewed' : 'Mark as reviewed'}
        >✓</button>
      </div>
    )
  }

  // ── Related passages section ──────────────────────────────────────────────
  // Lazy-loaded when entry is expanded and has a chunkId.

  function RelatedPassages({ entry }) {
    if (!entry.chunkId) return null
    const state = relatedMap[entry.id]

    if (!state) {
      return (
        <div className="idx-related-trigger">
          <button
            className="idx-related-load-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => loadRelated(entry)}
          >
            ↗ Find related passages
          </button>
        </div>
      )
    }
    if (state === 'loading') {
      return <div className="idx-related-loading">Finding related passages…</div>
    }
    if (!Array.isArray(state) || state.length === 0) return null

    return (
      <div className="idx-related">
        <div className="idx-related-header">Related passages</div>
        {state.map((r) => (
          <button
            key={r.chunk_id}
            className="idx-related-item"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => requestNav(r.page_number)}
            title={`Jump to page ${r.page_number}`}
          >
            <span className="idx-related-page">p.{r.page_number}</span>
            <span className="idx-related-text">{r.text_preview}</span>
          </button>
        ))}
      </div>
    )
  }

  // ── QA card renderer (shared between all views) ──────────────────────────

  function QACard({ qa, entryId, entry, isFocused }) {
    const { title, subtitle, type, isAction, derivedQuestion } = getLearningCardLabel(qa, entry)
    const isExpanded = !!expandedQAs[qa.id]
    const [reviewLoading, setReviewLoading] = useState(false)
    const facet = facetMeta(qa.rhetoricalFacet || 'uncategorized')

    // Manual question display: truncate in header; show full text above answer when expanded
    const shortQuestion = title.length > 82 ? title.slice(0, 80) + '…' : title
    const questionTruncated = title.length > 82

    async function handleReviewThis(e) {
      e.stopPropagation()
      if (reviewLoading) return
      setReviewLoading(true)
      try {
        const card = await fetchCardReviewData(qa.id)
        openReview({ cards: [card] })
      } catch (err) {
        console.error('Failed to load card for review:', err)
      } finally {
        setReviewLoading(false)
      }
    }

    return (
      <li className={`idx-qa ${qa.starred ? 'starred' : ''} ${isFocused ? 'focused' : ''}`}>

        {/* Header row — click anywhere to expand/collapse (star/del use stopPropagation) */}
        <div
          className="idx-qa-row"
          role="button"
          tabIndex={0}
          onClick={() => toggleExpand(qa.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(qa.id) } }}
        >
          <button
            className={`idx-star ${qa.starred ? 'on' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); toggleStarQA(entryId, qa.id) }}
            title={qa.starred ? 'Unstar' : 'Star this Q&A'}
          >
            {qa.starred ? '★' : '☆'}
          </button>

          <div className="idx-qa-label">
            <div className="idx-qa-label-stack">
              <span className="idx-qa-q-text">{shortQuestion}</span>
              <div className="idx-qa-meta-row">
                <span className={`idx-qa-context idx-qa-context-${type}`}>{subtitle}</span>
                <span className={`idx-facet-badge idx-facet-badge--${facet.tone}`}>
                  {facet.label}
                </span>
              </div>
              {derivedQuestion && (
                <span className="idx-qa-derived-question" title={derivedQuestion}>
                  Saved as: {derivedQuestion}
                </span>
              )}
            </div>
          </div>

          {/* Inline answer preview — first complete sentence, collapsed only */}
          {!isExpanded && (
            <span className="idx-qa-inline-preview" title={qa.answer}>
              {firstSentence(qa.answer)}
            </span>
          )}

          <span className="idx-qa-time" title={qa.createdAt ? new Date(qa.createdAt).toLocaleString() : ''}>
            {relativeTime(qa.createdAt)}
          </span>

          <button
            className="idx-review-this"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleReviewThis}
            title="Review this card now"
          >{reviewLoading ? '…' : 'Review Card'}</button>

          <button
            className="idx-del"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); deleteIndexQA(entryId, qa.id) }}
            title="Remove"
          >✕</button>
        </div>

        {/* Full answer — only when expanded */}
        {isExpanded && (
          <div className="idx-qa-answer-wrap">
            {/* For truncated manual questions, show full question text above the answer */}
            {questionTruncated && (
              <p className="idx-qa-full-question">{title}</p>
            )}
            {isAction && <p className="idx-qa-full-subtitle">{subtitle}</p>}
            <div className="idx-qa-facet-line">
              <span className={`idx-facet-badge idx-facet-badge--${facet.tone}`}>
                {facet.label}
              </span>
            </div>
            {derivedQuestion && (
              <p className="idx-qa-derived-full">Saved as study question: {derivedQuestion}</p>
            )}
            <div className="idx-qa-a idx-qa-a-markdown">
              <ReactMarkdown>{qa.answer}</ReactMarkdown>
            </div>
            <button
              className="idx-expand-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); toggleExpand(qa.id) }}
            >
              ▴ Collapse
            </button>
          </div>
        )}
      </li>
    )
  }

  // ── Annotation field ──────────────────────────────────────────────────────
  // Your own free-text note on a passage — separate from AI Q&As.
  // Empty → ghost prompt; editing → inline textarea; saved → styled block.

  function AnnotationField({ entry }) {
    const isEditing = !!editingNote[entry.id]
    const hasNote   = entry.note && entry.note.trim()

    if (isEditing) {
      return (
        <div className="idx-note-wrap" onClick={(e) => e.stopPropagation()}>
          <textarea
            className="idx-note-input"
            defaultValue={entry.note || ''}
            autoFocus
            placeholder="Your thoughts, connections, questions to revisit…"
            rows={3}
            onBlur={(e) => {
              setEntryNote(entry.id, e.target.value)
              setEditingNote((p) => ({ ...p, [entry.id]: false }))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditingNote((p) => ({ ...p, [entry.id]: false }))
              }
            }}
          />
        </div>
      )
    }

    if (hasNote) {
      return (
        <div className="idx-note-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            className="idx-note-display"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              setEditingNote((p) => ({ ...p, [entry.id]: true }))
            }}
            title="Click to edit note"
          >
            <span className="idx-note-icon">✎</span>
            {entry.note}
          </button>
        </div>
      )
    }

    return (
      <div className="idx-note-wrap" onClick={(e) => e.stopPropagation()}>
        <button
          className="idx-note-add"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            setEditingNote((p) => ({ ...p, [entry.id]: true }))
          }}
        >
          ✎ Add a note…
        </button>
      </div>
    )
  }

  // ── Synthesis section ─────────────────────────────────────────────────────
  // Distils all Q&A exchanges about a passage into a 2–3 sentence synthesis of
  // what the learner now understands.  Generated on demand via Haiku.
  //
  // States:
  //   entry.synthesis === null && not loading  → "✦ Synthesize" button
  //   synthesizing[entry.id] === true          → loading state
  //   entry.synthesis is a string              → synthesis text + ↺ button

  function SynthesisSection({ entry }) {
    if (entry.qaPairs.length === 0) return null

    const isLoading = !!synthesizing[entry.id]
    const isDeepLoading = !!deepSynthesizing[entry.id]
    const deepSynthesis = entry.deepSynthesis || null

    async function runSynthesis(mode = 'summary') {
      const setLoading = mode === 'deep' ? setDeepSynthesizing : setSynthesizing
      setLoading((p) => ({ ...p, [entry.id]: true }))
      try {
        const pairs = entry.qaPairs.map((q) => ({ question: q.question, answer: q.answer }))
        const { synthesis } = await synthesizeEntry(
          entry.highlightText,
          pairs,
          entry.note || '',
          mode,
        )
        if (mode === 'deep') {
          await setDeepSynthesis(entry.id, synthesis)
        } else {
          await setSynthesis(entry.id, synthesis)
        }
      } catch {
        // silently fail — button remains available to retry
      } finally {
        setLoading((p) => ({ ...p, [entry.id]: false }))
      }
    }

    function clearDeepSynthesis() {
      setDeepSynthesis(entry.id, '')
    }

    if (isLoading || isDeepLoading) {
      return (
        <div className="idx-synthesis-wrap">
          <div className="idx-synthesis-loading">
            <span className="idx-synthesis-spinner" />
            {isDeepLoading ? 'Building deep synthesis…' : 'Synthesizing…'}
          </div>
        </div>
      )
    }

    if (entry.synthesis) {
      return (
        <SynthesisDisplay
          entry={entry}
          runSynthesis={() => runSynthesis('summary')}
          runDeepSynthesis={() => runSynthesis('deep')}
          clearDeepSynthesis={clearDeepSynthesis}
          deepSynthesis={deepSynthesis}
          deepLoading={isDeepLoading}
        />
      )
    }

    return (
      <div className="idx-synthesis-wrap" onClick={(e) => e.stopPropagation()}>
        <button
          className="idx-synthesis-trigger"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); runSynthesis('summary') }}
          title={`Synthesize learning from ${entry.qaPairs.length} Q&A${entry.qaPairs.length !== 1 ? 's' : ''}`}
        >
          ✦ Synthesize learning
        </button>
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="highlight-index">

      {/* Stats bar */}
      <div className="idx-stats">
        <span>{pdfEntries.length} passage{pdfEntries.length !== 1 ? 's' : ''}</span>
        <span className="idx-stats-sep">·</span>
        <span>{totalQA} Q&amp;A{totalQA !== 1 ? 's' : ''}</span>
        <span className="idx-stats-sep">·</span>
        <span className="idx-stats-due">{pdfDueCount} due in this PDF</span>
        {totalConcepts > 0 && <>
          <span className="idx-stats-sep">·</span>
          <span className="idx-stats-concept">{totalConcepts} concept{totalConcepts !== 1 ? 's' : ''}</span>
        </>}
        {totalStarred > 0 && <>
          <span className="idx-stats-sep">·</span>
          <span className="idx-stats-star">★ {totalStarred} starred</span>
        </>}
      </div>

      {/* Review button */}
      {totalQA > 0 && (
        <div className="idx-review-bar">
          <button
            className="idx-review-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openReview(selectedPdf ? { pdfId: selectedPdf.id } : null)}
            title="Start spaced-repetition review for this document"
          >
            Review This PDF
            <span className="idx-review-due-badge">{pdfDueCount} due</span>
          </button>
          <button
            className="idx-review-btn idx-review-btn--secondary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openReview(null)}
            title="Review all due cards across all documents"
          >
            Review All Due
            {globalDueCount != null && (
              <span className="idx-review-due-badge idx-review-due-badge--global">{globalDueCount}</span>
            )}
          </button>
        </div>
      )}

      {/* View tabs */}
      <div className="idx-view-tabs">
        <button
          className={`idx-view-tab ${view === 'page' ? 'active' : ''}`}
          onClick={() => setView('page')}
        >
          By Page
        </button>
        <button
          className={`idx-view-tab ${view === 'section' ? 'active' : ''}`}
          onClick={() => setView('section')}
        >
          By Section
        </button>
        <button
          className={`idx-view-tab ${view === 'concept' ? 'active' : ''}`}
          onClick={() => { setView('concept'); setActiveConcept(null) }}
        >
          Facets {facetCount} · Topics {totalConcepts}
        </button>
        <button
          className={`idx-view-tab ${view === 'starred' ? 'active' : ''}`}
          onClick={() => setView('starred')}
        >
          Curated
          {totalCurated > 0 && <span className="idx-tab-count">{totalCurated}</span>}
        </button>
      </div>

      {/* ── BY PAGE view ─────────────────────────────────────────────────── */}
      {view === 'page' && (
        <div className="idx-body">
          {pages.map(({ page, items }) => (
            <section key={page} className="idx-page-section">

              {/* Sticky page header */}
              <div className="idx-page-heading">
                <button
                  className="idx-page-num"
                  onClick={() => requestNav(page)}
                  title={`Jump to page ${page}`}
                >
                  p.{page}
                </button>
                <span className="idx-page-count">
                  {items.length} highlight{items.length !== 1 ? 's' : ''}
                  {' · '}
                  {items.reduce((n, e) => n + e.qaPairs.length, 0)} Q&amp;As
                </span>
              </div>

              {/* Highlight entries */}
              {items.map((entry) => {
                const isOpen   = openEntries[entry.id] === true
                const isFocused = entry.id === focusedEntryId
                const qaCount  = entry.qaPairs.length
                const sectionLabel = getEntrySectionLabel(entry)
                const sectionContext = getEntrySectionContext(entry)
                const focusLabel = getEntryFocusLabel(entry)
                const dueStatus = getDueStatus(entry)

                return (
                  <div
                    key={entry.id}
                    ref={(el) => { if (el) entryRefs.current[entry.id] = el }}
                    className={`idx-entry ${entry.starred ? 'starred' : ''} ${isFocused ? 'focused' : ''}`}
                  >
                    {/* Highlight header row */}
                    <div
                      className="idx-entry-header"
                      onClick={() => setOpenEntries((prev) => ({ ...prev, [entry.id]: !isOpen }))}
                    >
                      <button
                        className={`idx-star ${entry.starred ? 'on' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => { e.stopPropagation(); toggleStarEntry(entry.id) }}
                        title={entry.starred ? 'Unstar' : 'Star this highlight'}
                      >
                        {entry.starred ? '★' : '☆'}
                      </button>

                      <div className="idx-entry-text-wrap">
                        <div className="idx-entry-section-row">
                          <button
                            className="idx-page-num small"
                            title={`Jump to page ${entry.pageNumber}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); requestNav(entry.pageNumber) }}
                          >
                            p.{entry.pageNumber}
                          </button>
                          {sectionLabel && <span className="idx-entry-section-label">{sectionLabel}</span>}
                          <span className={`idx-due-badge idx-due-badge--${dueStatus.tone}`}>{dueStatus.label}</span>
                        </div>
                        {sectionContext && (
                          <div className="idx-entry-section-context">{sectionContext}</div>
                        )}
                        {focusLabel && (
                          <div className="idx-entry-focus">
                            <span className="idx-entry-focus-title">{focusLabel.title}</span>
                            <span className="idx-entry-focus-subtitle">{focusLabel.subtitle}</span>
                          </div>
                        )}
                        {/* One button per distinct selection — click to jump + flash highlight */}
                        {(entry.highlightTexts || [entry.highlightText]).map((text, ti) => (
                          <button
                            key={ti}
                            className={`idx-entry-text${text.includes('\n') ? ' idx-entry-text--table' : ''}`}
                            title={text.includes('\n') ? 'Jump to page (table — exact location not highlighted)' : 'Jump to this passage in the PDF'}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation()
                              requestNav(entry.pageNumber)
                              setFlashHighlight({ text, pageNumber: entry.pageNumber })
                            }}
                          >
                            {text.slice(0, 80)}{text.length > 80 ? '…' : ''}
                          </button>
                        ))}
                        <span className="idx-entry-meta">
                          <span className="idx-entry-meta-count">{qaCount} Q&amp;A{qaCount !== 1 ? 's' : ''}</span>
                          {entry.qaPairs.some((q) => q.starred) && (
                            <span className="idx-has-stars">· ★ {entry.qaPairs.filter((q) => q.starred).length}</span>
                          )}
                          {entry.note   && <span className="idx-meta-flag">✎</span>}
                          {entry.flagged && <span className="idx-meta-flag">🚩</span>}
                          {entry.anchored && <span className="idx-meta-flag">⚓</span>}
                        </span>
                      </div>

                      <div className="idx-entry-right">
                        <span className="idx-chevron">{isOpen ? '▾' : '▸'}</span>
                        <button
                          className="idx-del"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => { e.stopPropagation(); deleteIndexEntry(entry.id) }}
                          title="Delete highlight"
                        >✕</button>
                      </div>
                    </div>

                    {/* Expanded body: concepts + curation + annotation + Q&As + related */}
                    {isOpen && (
                      <>
                        {/* Concept chips + curation toggles — only shown when expanded */}
                        <div className="idx-entry-expanded-header">
                          <ConceptChips entry={entry} navigable={true} />
                          <CurationBar entry={entry} />
                        </div>
                        <AnnotationField entry={entry} />
                        <SynthesisSection entry={entry} />
                        <ul className="idx-qa-list">
                          {entry.qaPairs.length === 0 && (
                            <li className="idx-qa-empty">No Q&amp;As saved yet.</li>
                          )}
                          {[...entry.qaPairs]
                            .sort((a, b) => (Number(b.starred) - Number(a.starred)) || (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)))
                            .map((qa) => (
                              <QACard
                                key={qa.id}
                                qa={qa}
                                entryId={entry.id}
                                entry={entry}
                                isFocused={false}
                              />
                            ))
                          }
                        </ul>
                        <RelatedPassages entry={entry} />
                      </>
                    )}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      )}

      {/* ── BY SECTION view (hierarchical) ───────────────────────────────── */}
      {view === 'section' && (
        <div className="idx-body">
          {hierarchy.map(({ h1Title, subsections }) => {
            const h1TotalEntries  = subsections.reduce((n, s) => n + s.entries.length, 0)
            const h1TotalQAs      = subsections.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.qaPairs.length, 0), 0)

            return (
              <section key={h1Title} className="idx-h1-section">

                {/* H1 sticky heading */}
                <div className="idx-h1-heading">
                  <span className="idx-h1-title">{h1Title}</span>
                  <span className="idx-page-count">
                    {h1TotalEntries} highlight{h1TotalEntries !== 1 ? 's' : ''}
                    {' · '}{h1TotalQAs} Q&amp;As
                  </span>
                </div>

                {/* H2 subsections */}
                {subsections.map(({ h2Title, entries: subEntries }) => (
                  <div key={h2Title || '__root__'} className="idx-h2-block">

                    {/* H2 subheading (only when it exists) */}
                    {h2Title && (
                      <div className="idx-h2-heading">
                        <span className="idx-h2-icon">↳</span>
                        <span className="idx-h2-title">{h2Title}</span>
                        <span className="idx-page-count">
                          {subEntries.length} highlight{subEntries.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}

                    {/* Highlight entries under this subsection */}
                    {subEntries
                      .slice()
                      .sort((a, b) => a.pageNumber - b.pageNumber)
                      .map((entry) => {
                        const isOpen    = openEntries[entry.id] === true
                        const isFocused = entry.id === focusedEntryId
                        const qaCount   = entry.qaPairs.length
                        const sectionLabel = getEntrySectionLabel(entry)
                        const sectionContext = getEntrySectionContext(entry)
                        const dueStatus = getDueStatus(entry)
                        const focusLabel = getEntryFocusLabel(entry)

                        return (
                          <div
                            key={entry.id}
                            ref={(el) => { if (el) entryRefs.current[entry.id] = el }}
                            className={`idx-entry ${entry.starred ? 'starred' : ''} ${isFocused ? 'focused' : ''}`}
                          >
                            <div
                              className="idx-entry-header"
                              onClick={() => setOpenEntries((prev) => ({ ...prev, [entry.id]: !isOpen }))}
                            >
                              <button
                                className={`idx-star ${entry.starred ? 'on' : ''}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => { e.stopPropagation(); toggleStarEntry(entry.id) }}
                              >
                                {entry.starred ? '★' : '☆'}
                              </button>

                              <div className="idx-entry-text-wrap">
                                <div className="idx-entry-section-row">
                                  <button
                                    className="idx-page-num small"
                                    title={`Jump to page ${entry.pageNumber}`}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => { e.stopPropagation(); requestNav(entry.pageNumber) }}
                                  >
                                    p.{entry.pageNumber}
                                  </button>
                                  {sectionLabel && <span className="idx-entry-section-label">{sectionLabel}</span>}
                                  <span className={`idx-due-badge idx-due-badge--${dueStatus.tone}`}>{dueStatus.label}</span>
                                </div>
                                {sectionContext && (
                                  <div className="idx-entry-section-context">{sectionContext}</div>
                                )}
                                {focusLabel && (
                                  <div className="idx-entry-focus">
                                    <span className="idx-entry-focus-title">{focusLabel.title}</span>
                                    <span className="idx-entry-focus-subtitle">{focusLabel.subtitle}</span>
                                  </div>
                                )}
                                <span className="idx-entry-source-label">Highlight</span>
                                {(entry.highlightTexts || [entry.highlightText]).map((text, ti) => (
                                  <button
                                    key={ti}
                                    className="idx-entry-text"
                                    title="Jump to this passage in the PDF"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      requestNav(entry.pageNumber)
                                      setFlashHighlight({ text, pageNumber: entry.pageNumber })
                                    }}
                                  >
                                    {text.slice(0, 80)}{text.length > 80 ? '…' : ''}
                                  </button>
                                ))}
                                <span className="idx-entry-meta">
                                  <span className="idx-entry-meta-count">{qaCount} Q&amp;A{qaCount !== 1 ? 's' : ''}</span>
                                  {entry.qaPairs.some((q) => q.starred) && (
                                    <span className="idx-has-stars">· ★ {entry.qaPairs.filter((q) => q.starred).length}</span>
                                  )}
                                  {entry.note    && <span className="idx-meta-flag">✎</span>}
                                  {entry.flagged && <span className="idx-meta-flag">🚩</span>}
                                  {entry.anchored && <span className="idx-meta-flag">⚓</span>}
                                </span>
                              </div>

                              <div className="idx-entry-right">
                                <span className="idx-chevron">{isOpen ? '▾' : '▸'}</span>
                                <button
                                  className="idx-del"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => { e.stopPropagation(); deleteIndexEntry(entry.id) }}
                                  title="Delete"
                                >✕</button>
                              </div>
                            </div>

                            {isOpen && (
                              <>
                                <div className="idx-entry-expanded-header">
                                  <ConceptChips entry={entry} navigable={true} />
                                  <CurationBar entry={entry} />
                                </div>
                                <AnnotationField entry={entry} />
                                <SynthesisSection entry={entry} />
                                <ul className="idx-qa-list">
                                  {entry.qaPairs.length === 0 && (
                                    <li className="idx-qa-empty">No Q&amp;As saved yet.</li>
                                  )}
                                  {[...entry.qaPairs]
                                    .sort((a, b) => (Number(b.starred) - Number(a.starred)) || (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)))
                                    .map((qa) => (
                                      <QACard key={qa.id} qa={qa} entryId={entry.id} entry={entry} isFocused={false} />
                                    ))
                                  }
                                </ul>
                                <RelatedPassages entry={entry} />
                              </>
                            )}
                          </div>
                        )
                      })
                    }
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      )}

      {/* ── BY CONCEPT view ──────────────────────────────────────────────── */}
      {view === 'concept' && (
        <div className="idx-body">
          {conceptGroups.length === 0 ? (
            <div className="idx-empty idx-empty-inline">
              <span>No concepts tagged yet.</span>
              <span className="idx-empty-hint">
                Concepts are extracted automatically when you save a highlight to the index.
              </span>
            </div>
          ) : (
            <>
              {/* Concept chip bar — overflow after 12; always show active concept */}
              {(() => {
                const BAR_LIMIT = 12
                const needsTrunc = conceptGroups.length > BAR_LIMIT && !chipBarExpanded
                const visibleGroups = needsTrunc
                  ? conceptGroups.slice(0, BAR_LIMIT)
                  : conceptGroups
                // Always include active concept even if it falls past the cutoff
                const activeHidden = needsTrunc && activeConcept &&
                  !visibleGroups.find((g) => g.concept === activeConcept)
                return (
                  <div className="idx-concept-bar">
                    <button
                      className={`idx-concept-chip ${activeConcept === null ? 'active' : ''}`}
                      onClick={() => setActiveConcept(null)}
                    >
                      All <span className="idx-concept-chip-count">{pdfEntries.length}</span>
                    </button>
                    {visibleGroups.map(({ concept, entries: cEntries }) => (
                      <button
                        key={concept}
                        className={`idx-concept-chip ${activeConcept === concept ? 'active' : ''}`}
                        onClick={() => setActiveConcept(activeConcept === concept ? null : concept)}
                      >
                        {concept}
                        <span className="idx-concept-chip-count">{cEntries.length}</span>
                      </button>
                    ))}
                    {activeHidden && (
                      <button
                        className="idx-concept-chip active"
                        onClick={() => setActiveConcept(activeConcept)}
                      >
                        {activeConcept}
                      </button>
                    )}
                    {conceptGroups.length > BAR_LIMIT && (
                      <button
                        className="idx-concept-bar-toggle"
                        onClick={() => setChipBarExpanded((v) => !v)}
                      >
                        {chipBarExpanded
                          ? '− Less'
                          : `+${conceptGroups.length - BAR_LIMIT} more`}
                      </button>
                    )}
                  </div>
                )
              })()}

              {/* Filtered entries */}
              {(activeConcept
                ? conceptGroups.filter((g) => g.concept === activeConcept)
                : conceptGroups
              ).map(({ concept, entries: cEntries }) => (
                <section key={concept} className="idx-concept-section">
                  <div className="idx-concept-heading">
                    <span className="idx-concept-heading-tag">{concept}</span>
                    <span className="idx-page-count">
                      {cEntries.length} passage{cEntries.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {cEntries
                    .slice()
                    .sort((a, b) => a.pageNumber - b.pageNumber)
                    .map((entry) => {
                      const isOpen    = openEntries[entry.id] === true
                      const isFocused = entry.id === focusedEntryId
                      const qaCount   = entry.qaPairs.length
                      const sectionLabel = getEntrySectionLabel(entry)
                      const sectionContext = getEntrySectionContext(entry)
                      const dueStatus = getDueStatus(entry)
                      const focusLabel = getEntryFocusLabel(entry)

                      return (
                        <div
                          key={`${concept}-${entry.id}`}
                          ref={(el) => { if (el) entryRefs.current[entry.id] = el }}
                          className={`idx-entry ${entry.starred ? 'starred' : ''} ${isFocused ? 'focused' : ''}`}
                        >
                          <div
                            className="idx-entry-header"
                            onClick={() => setOpenEntries((prev) => ({ ...prev, [entry.id]: !isOpen }))}
                          >
                            <button
                              className={`idx-star ${entry.starred ? 'on' : ''}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => { e.stopPropagation(); toggleStarEntry(entry.id) }}
                            >
                              {entry.starred ? '★' : '☆'}
                            </button>

                              <div className="idx-entry-text-wrap">
                                <div className="idx-entry-section-row">
                                  <button
                                  className="idx-page-num small"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => { e.stopPropagation(); requestNav(entry.pageNumber) }}
                                  title={`Jump to page ${entry.pageNumber}`}
                                  >
                                    p.{entry.pageNumber}
                                  </button>
                                {sectionLabel && (
                                  <span className="idx-entry-section-label">{sectionLabel}</span>
                                )}
                                <span className={`idx-due-badge idx-due-badge--${dueStatus.tone}`}>{dueStatus.label}</span>
                              </div>
                              {sectionContext && (
                                <div className="idx-entry-section-context">{sectionContext}</div>
                              )}
                              {focusLabel && (
                                <div className="idx-entry-focus">
                                  <span className="idx-entry-focus-title">{focusLabel.title}</span>
                                  <span className="idx-entry-focus-subtitle">{focusLabel.subtitle}</span>
                                </div>
                              )}
                              {(entry.highlightTexts || [entry.highlightText]).map((text, ti) => (
                                <button
                                  key={ti}
                                  className="idx-entry-text"
                                  title="Jump to this passage in the PDF"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    requestNav(entry.pageNumber)
                                    setFlashHighlight({ text, pageNumber: entry.pageNumber })
                                  }}
                                >
                                  {text.slice(0, 80)}{text.length > 80 ? '…' : ''}
                                </button>
                              ))}
                              <span className="idx-entry-meta">
                                <span className="idx-entry-meta-count">{qaCount} Q&amp;A{qaCount !== 1 ? 's' : ''}</span>
                                {entry.note    && <span className="idx-meta-flag">✎</span>}
                                {entry.flagged && <span className="idx-meta-flag">🚩</span>}
                              </span>
                            </div>

                            <div className="idx-entry-right">
                              <span className="idx-chevron">{isOpen ? '▾' : '▸'}</span>
                            </div>
                          </div>

                          {isOpen && (
                            <>
                              {/* Other concepts (not the one being browsed) + curation in expanded body */}
                              <div className="idx-entry-expanded-header">
                                <ConceptChips
                                  entry={{ ...entry, concepts: entry.concepts.filter((c) => c !== activeConcept) }}
                                  navigable={true}
                                />
                                <CurationBar entry={entry} />
                              </div>
                              <AnnotationField entry={entry} />
                              <SynthesisSection entry={entry} />
                              <ul className="idx-qa-list">
                                {[...entry.qaPairs]
                                  .sort((a, b) => (Number(b.starred) - Number(a.starred)) || (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)))
                                  .map((qa) => (
                                  <QACard key={qa.id} qa={qa} entryId={entry.id} entry={entry} isFocused={false} />
                                  ))
                                }
                              </ul>
                              <RelatedPassages entry={entry} />
                            </>
                          )}
                        </div>
                      )
                    })
                  }
                </section>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── CURATED view ─────────────────────────────────────────────────── */}
      {view === 'starred' && (
        <div className="idx-body">
          {/* Sub-filter tabs */}
          <div className="idx-curated-tabs">
            <button
              className={`idx-curated-tab ${starredFilter === 'stars' ? 'active' : ''}`}
              onClick={() => setStarredFilter('stars')}
            >
              ★ Stars {starredQAs.length > 0 && <span className="idx-tab-count">{starredQAs.length}</span>}
            </button>
            <button
              className={`idx-curated-tab ${starredFilter === 'anchored' ? 'active' : ''}`}
              onClick={() => setStarredFilter('anchored')}
            >
              ⚓ Anchored {totalAnchored > 0 && <span className="idx-tab-count">{totalAnchored}</span>}
            </button>
            <button
              className={`idx-curated-tab ${starredFilter === 'flagged' ? 'active' : ''}`}
              onClick={() => setStarredFilter('flagged')}
            >
              🚩 Flagged {totalFlagged > 0 && <span className="idx-tab-count">{totalFlagged}</span>}
            </button>
          </div>

          {/* Stars sub-view */}
          {starredFilter === 'stars' && (
            starredQAs.length === 0 ? (
              <div className="idx-empty idx-empty-inline">
                <span>No starred Q&amp;As yet.</span>
                <span className="idx-empty-hint">Star key answers with ☆ to surface them here.</span>
              </div>
            ) : (
              starredQAs.map((qa) => {
                const { title, subtitle, type, isAction } = getLearningCardLabel(qa, qa.entry)
                const isExpanded = !!expandedQAs[qa.id]
                const shortQuestion = title.length > 82 ? title.slice(0, 80) + '…' : title
                const questionTruncated = title.length > 82

                return (
                  <div key={qa.id} className="idx-starred-item">
                    <div className="idx-starred-meta">
                      <button
                        className="idx-page-num small"
                        onClick={() => requestNav(qa.entry.pageNumber)}
                      >
                        p.{qa.entry.pageNumber}
                      </button>
                      <span className="idx-starred-highlight" title={qa.entry.highlightText}>
                        {qa.entry.highlightText.slice(0, 70)}{qa.entry.highlightText.length > 70 ? '…' : ''}
                      </span>
                    </div>

                    <div className="idx-starred-qa">
                      <div
                        className="idx-qa-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpand(qa.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(qa.id) } }}
                      >
                        <span className="idx-star on">★</span>
                        <div className="idx-qa-label">
                          <div className="idx-qa-label-stack">
                            <span className="idx-qa-q-text">{shortQuestion}</span>
                            <span className={`idx-qa-context idx-qa-context-${type}`}>{subtitle}</span>
                          </div>
                        </div>
                        {!isExpanded && (
                          <span className="idx-qa-inline-preview" title={qa.answer}>
                            {firstSentence(qa.answer)}
                          </span>
                        )}
                        <span className="idx-qa-time" title={qa.createdAt ? new Date(qa.createdAt).toLocaleString() : ''}>
                          {relativeTime(qa.createdAt)}
                        </span>
                      </div>

                      {isExpanded && (
                      <div className="idx-qa-answer-wrap">
                        {questionTruncated && <p className="idx-qa-full-question">{title}</p>}
                        {isAction && <p className="idx-qa-full-subtitle">{subtitle}</p>}
                        <div className="idx-qa-a idx-qa-a-markdown"><ReactMarkdown>{qa.answer}</ReactMarkdown></div>
                        <button
                          className="idx-expand-btn"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => { e.stopPropagation(); toggleExpand(qa.id) }}
                        >
                          ▴ Collapse
                        </button>
                      </div>
                      )}
                    </div>
                  </div>
                )
              })
            )
          )}

          {/* Anchored sub-view */}
          {starredFilter === 'anchored' && (
            pdfEntries.filter((e) => e.anchored).length === 0 ? (
              <div className="idx-empty idx-empty-inline">
                <span>No anchored passages yet.</span>
                <span className="idx-empty-hint">Mark foundational concepts with ⚓ to collect them here.</span>
              </div>
            ) : (
              pdfEntries
                .filter((e) => e.anchored)
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((entry) => (
                  <div key={entry.id} className="idx-curated-entry-card anchored">
                    <div className="idx-curated-card-header">
                      <span className="idx-curated-icon">⚓</span>
                      <button
                        className="idx-page-num small"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => requestNav(entry.pageNumber)}
                      >
                        p.{entry.pageNumber}
                      </button>
                      <ConceptChips entry={entry} navigable={false} />
                    </div>
                    {(entry.highlightTexts || [entry.highlightText]).map((text, ti) => (
                      <p key={ti} className="idx-curated-card-text">{text}</p>
                    ))}
                  </div>
                ))
            )
          )}

          {/* Flagged sub-view */}
          {starredFilter === 'flagged' && (
            pdfEntries.filter((e) => e.flagged).length === 0 ? (
              <div className="idx-empty idx-empty-inline">
                <span>No flagged passages yet.</span>
                <span className="idx-empty-hint">Flag passages that need attention with 🚩.</span>
              </div>
            ) : (
              pdfEntries
                .filter((e) => e.flagged)
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((entry) => (
                  <div key={entry.id} className="idx-curated-entry-card flagged">
                    <div className="idx-curated-card-header">
                      <span className="idx-curated-icon">🚩</span>
                      <button
                        className="idx-page-num small"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => requestNav(entry.pageNumber)}
                      >
                        p.{entry.pageNumber}
                      </button>
                      <ConceptChips entry={entry} navigable={false} />
                    </div>
                    {(entry.highlightTexts || [entry.highlightText]).map((text, ti) => (
                      <p key={ti} className="idx-curated-card-text">{text}</p>
                    ))}
                  </div>
                ))
            )
          )}
        </div>
      )}
    </div>
  )
}
