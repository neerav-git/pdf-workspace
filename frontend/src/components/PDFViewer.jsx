import { useState, useCallback, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useAppStore } from '../store'
import { getPdfFileUrl, getToc } from '../api/pdfs'
import { findSection, findSectionPath } from '../utils/tocUtils'
import { usePersistentHighlight } from '../hooks/usePersistentHighlight'
import SelectionMenu from './SelectionMenu'
import './PDFViewer.css'

// ── Highlight Popover ─────────────────────────────────────────────────────────
// Shown when user clicks a lens overlay. Two actions:
//   → View in Index — scrolls the Index tab to this entry and shows its Q&A history
//   ▶ Review now   — launches a single-card review session for all Q&As on this entry
// Positioning: fixed, flipped left/up if too close to viewport edges.

function HighlightPopover({ entryId, x, y, onClose }) {
  const { highlightIndex, openReview } = useAppStore()
  const ref = useRef(null)

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const handleKey   = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Flip position after mount so popover stays inside viewport
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const MARGIN = 10
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - MARGIN)
      el.style.left = `${x - rect.width - MARGIN}px`
    if (rect.bottom > window.innerHeight - MARGIN)
      el.style.top = `${y - rect.height - MARGIN}px`
    el.style.visibility = 'visible'
  }, [x, y])

  const entry = highlightIndex.find((e) => e.id === entryId)
  if (!entry) return null

  const qaCount  = entry.qaPairs?.length ?? 0
  const excerpt  = (entry.highlightText || '').replace(/\s+/g, ' ').trim()
  const preview  = excerpt.length > 72 ? excerpt.slice(0, 72).trimEnd() + '…' : excerpt
  const section  = entry.sectionTitle || null

  const handleViewIndex = () => {
    useAppStore.setState({
      pendingSelectionAction: {
        id: 'view-index',
        text: entry.highlightText,
        pageNumber: entry.pageNumber,
      },
    })
    onClose()
  }

  const handleReview = () => {
    const cards = entry.qaPairs.map((qa) => ({
      ...qa,
      highlight_text: entry.highlightText,
      section_title:  entry.sectionTitle,
      page_number:    entry.pageNumber,
    }))
    openReview({ cards })
    onClose()
  }

  return (
    <div
      ref={ref}
      className="hl-popover"
      style={{ position: 'fixed', left: x, top: y, visibility: 'hidden' }}
    >
      {/* Passage excerpt */}
      <div className="hl-popover-excerpt">"{preview}"</div>
      {section && <div className="hl-popover-section">{section}{entry.pageNumber ? ` · p. ${entry.pageNumber}` : ''}</div>}

      {/* Stats row */}
      <div className="hl-popover-meta">
        <span className="hl-popover-qa-count">{qaCount} Q&amp;A{qaCount !== 1 ? 's' : ''}</span>
        {entry.flagged  && <span className="hl-popover-badge hl-badge-flagged">Flagged</span>}
        {entry.anchored && <span className="hl-popover-badge hl-badge-anchored">Anchored</span>}
        {entry.starred  && <span className="hl-popover-badge hl-badge-starred">★</span>}
      </div>

      {/* Actions */}
      <div className="hl-popover-actions">
        <button className="hl-popover-btn hl-popover-btn--index" onClick={handleViewIndex}>
          Open Index
        </button>
        {qaCount > 0 && (
          <button className="hl-popover-btn hl-popover-btn--review" onClick={handleReview}>
            Review This Passage
          </button>
        )}
      </div>
    </div>
  )
}

// ── Highlight overlay approach ────────────────────────────────────────────────
// We create absolutely-positioned <div> overlays inside the page wrapper.
// range.getClientRects() gives exact pixel positions; we convert to page-relative
// coordinates.  This is browser-agnostic: no CSS Custom Highlight API, no span
// class trickery — just plain divs positioned on top of the canvas.

const HL_OVERLAY = 'pdf-hl-overlay'
const LENS_CLASS          = 'pdf-hl-lens'
const LENS_CLASS_FLAGGED  = 'pdf-hl-lens-flagged'
const LENS_CLASS_ANCHORED = 'pdf-hl-lens-anchored'
const LENS_CLASS_REVIEWED = 'pdf-hl-lens-reviewed'
const FLASH_CLASS         = 'pdf-hl-flash'
const LENS_CLASSES        = [LENS_CLASS, LENS_CLASS_FLAGGED, LENS_CLASS_ANCHORED, LENS_CLASS_REVIEWED]

function lensClassForEntry(entry) {
  if (entry.flagged)  return LENS_CLASS_FLAGGED
  if (entry.anchored) return LENS_CLASS_ANCHORED
  if (entry.reviewed) return LENS_CLASS_REVIEWED
  return LENS_CLASS
}

/**
 * Create overlay <div> elements inside `pageWrapper` that cover `range`.
 * Returns the array of created divs (caller can remove them on timeout).
 * pageWrapper must be `position: relative`.
 */
function addOverlaysForRange(pageWrapper, range, className, onClick = null) {
  if (!pageWrapper || !range) return []
  const wrapperRect = pageWrapper.getBoundingClientRect()
  const rects = range.getClientRects()
  const created = []
  for (const rect of rects) {
    if (rect.width < 1 || rect.height < 1) continue
    const div = document.createElement('div')
    div.className = `${HL_OVERLAY} ${className}`
    const interactive = onClick !== null
    div.style.cssText =
      `position:absolute;` +
      `left:${rect.left - wrapperRect.left}px;` +
      `top:${rect.top - wrapperRect.top}px;` +
      `width:${rect.width}px;` +
      `height:${rect.height}px;` +
      `pointer-events:${interactive ? 'auto' : 'none'};` +
      `cursor:${interactive ? 'pointer' : 'default'};` +
      `z-index:2;border-radius:2px;`
    if (onClick) div.addEventListener('click', onClick)
    pageWrapper.appendChild(div)
    created.push(div)
  }
  return created
}

/** Remove overlay divs for the given class from a specific page wrapper. */
function clearPageOverlays(pageWrapper, className) {
  if (!pageWrapper) return
  const sel = className ? `.${HL_OVERLAY}.${className}` : `.${HL_OVERLAY}`
  pageWrapper.querySelectorAll(sel).forEach((el) => el.remove())
}

/** Remove ALL lens overlays from the entire document. */
function clearLens() {
  const sel = LENS_CLASSES.map((c) => `.${HL_OVERLAY}.${c}`).join(',')
  document.querySelectorAll(sel).forEach((el) => el.remove())
}

/**
 * Find a DOM Range for `searchText` within a text-layer container.
 *
 * Strategy:
 * 1. Walk all text nodes; build a flat character string and a char→{node,offset} map.
 * 2. Build a normalized (whitespace-collapsed) version + normIdx→flatIdx mapping.
 * 3. Search normalized string for the first 60 chars of searchText.
 * 4. Map the match back to exact node+offset positions and create a Range.
 *
 * Returns null on no-match or error (caller silently skips).
 */
function findTextRange(container, searchText) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes = []
  let n
  while ((n = walker.nextNode())) nodes.push(n)
  if (!nodes.length) return null

  // Build flat string + per-char source map
  let flat = ''
  const src = []   // src[i] = { node, offset } for flat[i]
  for (const nd of nodes) {
    for (let ci = 0; ci < nd.textContent.length; ci++) {
      src.push({ node: nd, offset: ci })
      flat += nd.textContent[ci]
    }
  }

  // Build normalized string + normIdx→flatIdx map
  let norm = ''
  const n2f = []   // n2f[normIdx] = flatIdx
  let inSpace = false
  for (let fi = 0; fi < flat.length; fi++) {
    if (/\s/.test(flat[fi])) {
      if (!inSpace) { norm += ' '; n2f.push(fi); inSpace = true }
    } else {
      norm += flat[fi]; n2f.push(fi); inSpace = false
    }
  }

  // De-hyphenate PDF line-break artifacts before building anchor.
  // PyMuPDF extracts hyphenated words as "treat-\nments" — strip the hyphen+newline
  // so the anchor can match "treatments" in the PDF text layer.
  const dehyphenated = searchText.replace(/-\r?\n/g, '').replace(/-\n/g, '')

  // Anchor = first 60 chars of normalized, de-hyphenated search text
  const anchor = dehyphenated.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!anchor) return null

  let si = norm.toLowerCase().indexOf(anchor.toLowerCase())

  // Helper: try a stripped search using a given strip-chars regex, return range or null.
  function tryStripped(stripRe, fullText) {
    // Use split/join to remove ALL matching chars (avoids missing-g-flag pitfall)
    const stripAll = (s) => s.split(stripRe).join('')
    let stripped = ''
    const i2f = []
    for (let fi = 0; fi < flat.length; fi++) {
      if (!stripRe.test(flat[fi])) { stripped += flat[fi]; i2f.push(fi) }
    }
    const anchorS = stripAll(anchor)
    const fullS   = stripAll(fullText).slice(0, 300)
    const si2 = stripped.toLowerCase().indexOf(anchorS.toLowerCase())
    if (si2 === -1) return null
    const flatStart = i2f[si2]
    const flatEnd   = i2f[Math.min(si2 + fullS.length - 1, i2f.length - 1)]
    if (flatStart === undefined || flatEnd === undefined) return null
    const s2 = src[flatStart]
    const e2 = src[flatEnd]
    if (!s2 || !e2) return null
    try {
      const r = document.createRange()
      r.setStart(s2.node, s2.offset)
      r.setEnd(e2.node, Math.min(e2.offset + 1, e2.node.textContent.length))
      return r
    } catch { return null }
  }

  if (si === -1) {
    // Strategy 2: strip whitespace — handles spans with no inter-span spaces.
    const r2 = tryStripped(/\s/, searchText)
    if (r2) return r2

    // Strategy 3: strip whitespace AND hyphens — handles pdf.js line-break hyphens
    // (e.g. pdf.js renders "treat-ments" across two spans; PyMuPDF stored "treatments").
    const r3 = tryStripped(/[\s-]/, searchText)
    if (r3) return r3

    return null
  }

  // Extend from anchor match to cover the full stored text.
  // Don't re-search for fullNorm — when spaces differ (DOM vs selection.toString)
  // a second indexOf returns -1 and the fallback truncates to 60 chars.
  // The anchor already pinned the start; extending by fullNorm.length is correct.
  const fullNorm = dehyphenated.replace(/\s+/g, ' ').trim()
  const ei = si + Math.min(fullNorm.length, norm.length - si)

  const flatStart = n2f[si]
  const flatEnd   = n2f[Math.min(ei - 1, n2f.length - 1)]
  if (flatStart === undefined || flatEnd === undefined) return null

  const s = src[flatStart]
  const e = src[flatEnd]
  if (!s || !e) return null

  try {
    const range = document.createRange()
    range.setStart(s.node, s.offset)
    range.setEnd(e.node, Math.min(e.offset + 1, e.node.textContent.length))
    return range
  } catch {
    return null
  }
}

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

const RENDER_WINDOW = 3

export default function PDFViewer() {
  const {
    selectedPdf,
    currentPage,
    setCurrentPage,
    setTotalPages,
    totalPages,
    setSelectionContext,
    clearSelectionContext,
    navRequest,
    consumeNavRequest,
    highlightIndex,
    flashHighlight,
    consumeFlashHighlight,
    openReview,
  } = useAppStore()

  const [highlightPopover, setHighlightPopover] = useState(null) // { entryId, x, y }
  const [scale, setScale]           = useState(1.0)
  const [lensEnabled, setLensEnabled] = useState(
    () => localStorage.getItem('lens-enabled') === 'true'
  )
  const [loadError, setLoadError] = useState(null)
  const [selectionMenu, setSelectionMenu] = useState(null)
  const [pageInputVal, setPageInputVal] = useState('')
  const [editingPage, setEditingPage] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [toc, setToc] = useState(null)           // { items, generated } | null
  const [tocBannerDismissed, setTocBannerDismissed] = useState(false)
  const [tocFilter, setTocFilter] = useState('')

  const scrollRef = useRef(null)
  const pageRefs = useRef({})           // pageNum → DOM element
  const observerRef = useRef(null)
  const ratioMap = useRef({})           // pageNum → latest intersection ratio (persists across callbacks)
  const scrollingToRef = useRef(false)  // true while programmatic scroll is in progress
  const pendingScrollPage = useRef(null) // set when we need to scroll after the target page renders

  const { saveRange, clearHighlight } = usePersistentHighlight()

  // ── Flash highlight ────────────────────────────────────────────────────────
  // When navigating to a passage from the index, briefly highlight the exact text.

  const pendingFlashRef = useRef(null)  // { text, pageNumber } waiting for text layer

  // Refs kept current every render so stable per-page handlers can read latest values
  // without capturing stale closures (prevents TextLayer from re-rendering on every
  // PDFViewer state change — a new inline function would trigger the effect dep chain).
  const lensEnabledRef       = useRef(false)
  const applyLensToPageRef   = useRef(null)
  const textLayerHandlerCache = useRef({})

  // Returns true if the highlight was applied; false if text not found or API unavailable.
  // Callers use the return value to decide whether to store a pending flash for retry.
  const applyFlash = useCallback((pageNum, text) => {
    const wrapper = pageRefs.current[pageNum]
    if (!wrapper) return false
    const textLayer = wrapper.querySelector('.textLayer')
    if (!textLayer) return false
    try {
      const range = findTextRange(textLayer, text)
      if (!range) return false
      clearPageOverlays(wrapper, FLASH_CLASS)
      const created = addOverlaysForRange(wrapper, range, FLASH_CLASS)
      if (created.length === 0) return false
      setTimeout(() => created.forEach((el) => el.remove()), 3500)
      return true
    } catch {
      return false
    }
  }, [])

  // Fires when flashHighlight is set (from index passage click)
  useEffect(() => {
    if (!flashHighlight) return
    const { text, pageNumber } = flashHighlight
    consumeFlashHighlight()

    // If text layer is already rendered, try immediately.
    // If applyFlash returns false (text not found or CSS Highlight API threw), still
    // store as pending — the text layer may be in mid-render and will stabilize shortly.
    const wrapper = pageRefs.current[pageNumber]
    const textLayer = wrapper?.querySelector('.textLayer')
    if (textLayer) {
      const ok = applyFlash(pageNumber, text)
      if (!ok) {
        // findTextRange failed on an existing text layer — text nodes may still be
        // populating (react-pdf renders spans asynchronously).  Retry after 300ms.
        setTimeout(() => {
          if (!applyFlash(pageNumber, text)) {
            // Second attempt at 600ms
            setTimeout(() => applyFlash(pageNumber, text), 300)
          }
        }, 300)
      }
    } else {
      // Text layer not rendered yet — store for onRenderTextLayerSuccess
      pendingFlashRef.current = { text, pageNumber }
    }
  }, [flashHighlight, consumeFlashHighlight, applyFlash])

  // ── Highlight Lens ─────────────────────────────────────────────────────────

  const applyLensToPage = useCallback((pageNum) => {
    if (!selectedPdf) return
    const wrapper = pageRefs.current[pageNum]
    if (!wrapper) return
    const textLayer = wrapper.querySelector('.textLayer')
    if (!textLayer) return

    // Clear stale lens overlays for this page before redrawing
    LENS_CLASSES.forEach((c) => clearPageOverlays(wrapper, c))

    const entries = highlightIndex.filter(
      (e) => e.pdfId === selectedPdf.id && e.pageNumber === pageNum,
    )
    if (!entries.length) return

    for (const entry of entries) {
      // highlightTexts[] holds all distinct selections for this chunk entry.
      // Fall back to [highlightText] for entries saved before multi-select support.
      const texts = entry.highlightTexts?.length > 0 ? entry.highlightTexts : [entry.highlightText]
      const cls = lensClassForEntry(entry)
      // Click handler — stable closure capturing entry.id; opens the popover
      const handleClick = (e) => {
        e.stopPropagation()
        setHighlightPopover({ entryId: entry.id, x: e.clientX, y: e.clientY + 12 })
      }
      for (const text of texts) {
        const range = findTextRange(textLayer, text)
        if (!range) continue
        addOverlaysForRange(wrapper, range, cls, handleClick)
      }
    }
  }, [selectedPdf, highlightIndex])

  // Keep refs current so the stable per-page handlers always call the latest version
  lensEnabledRef.current     = lensEnabled
  applyLensToPageRef.current = applyLensToPage

  // Turn lens on/off
  useEffect(() => {
    if (!lensEnabled) { clearLens(); return }
    // Apply to all currently-rendered pages
    Object.keys(pageRefs.current).forEach((p) => applyLensToPage(Number(p)))
  }, [lensEnabled, applyLensToPage])

  // Re-apply when index entries change (curation state updates etc.)
  useEffect(() => {
    if (!lensEnabled) return
    clearLens()
    Object.keys(pageRefs.current).forEach((p) => applyLensToPage(Number(p)))
  }, [highlightIndex, lensEnabled, applyLensToPage])

  // Clear lens when PDF changes
  useEffect(() => { clearLens() }, [selectedPdf?.id])

  // ── Stable per-page text-layer handler ────────────────────────────────────
  // Returns a cached, stable function for each pageNum.  Because the same object
  // reference is passed to <Page onRenderTextLayerSuccess> on every render, react-pdf's
  // TextLayer never sees a changed dep and never clears + rebuilds its text nodes.
  // The handler reads lensEnabledRef / applyLensToPageRef at call time, so it always
  // operates on the current values without needing to be recreated.
  function getTextLayerHandler(pageNum) {
    if (!textLayerHandlerCache.current[pageNum]) {
      textLayerHandlerCache.current[pageNum] = () => {
        if (lensEnabledRef.current) applyLensToPageRef.current?.(pageNum)
        if (pendingFlashRef.current?.pageNumber === pageNum) {
          const { text } = pendingFlashRef.current
          pendingFlashRef.current = null
          applyFlash(pageNum, text)
        }
      }
    }
    return textLayerHandlerCache.current[pageNum]
  }

  // ── Reset banner + filter when PDF changes ────────────────────────────────
  useEffect(() => {
    setTocBannerDismissed(false)
    setTocFilter('')
  }, [selectedPdf?.id])

  // ── Load ToC when PDF changes ──────────────────────────────────────────────
  useEffect(() => {
    if (!selectedPdf) { setToc(null); return }
    setToc(null)
    getToc(selectedPdf.id)
      .then((data) => setToc(data))
      .catch(() => setToc({ items: [], generated: false }))
  }, [selectedPdf?.id])

  // ── Navigate to page (public helper used by ToC, input, arrows) ───────────
  // Sets the render window AND ensures a scroll after the page mounts.
  const navigateToPage = useCallback((page) => {
    if (!page || page < 1 || page > totalPages) return
    pendingScrollPage.current = page
    setCurrentPage(page)
  }, [totalPages, setCurrentPage])

  // ── External nav request (from index panel or anywhere else) ──────────────
  useEffect(() => {
    if (!navRequest) return
    consumeNavRequest()
    navigateToPage(navRequest)
  }, [navRequest, consumeNavRequest, navigateToPage])

  // ── After every render: scroll to pending page if it is now mounted ────────
  useEffect(() => {
    const target = pendingScrollPage.current
    if (!target) return
    const el = pageRefs.current[target]
    if (!el) return          // page not rendered yet; wait for next render
    pendingScrollPage.current = null
    scrollingToRef.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => { scrollingToRef.current = false }, 800)
  })   // intentionally no deps — runs after every render until the page is found

  // ── IntersectionObserver: track MOST-VISIBLE page as user scrolls ──────────
  // Key fix: we keep `ratioMap` across multiple observer callbacks so we always
  // compare ALL currently-rendered pages, not just the subset in each batch.
  const setupObserver = useCallback(() => {
    observerRef.current?.disconnect()
    ratioMap.current = {}
    const container = scrollRef.current
    if (!container || !totalPages) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Update our running ratio map
        for (const entry of entries) {
          const pg = Number(entry.target.dataset.page)
          if (pg) ratioMap.current[pg] = entry.intersectionRatio
        }

        if (scrollingToRef.current) return

        // Find page with highest visible fraction across ALL tracked pages
        let bestPage = null
        let bestRatio = 0
        for (const [pg, ratio] of Object.entries(ratioMap.current)) {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestPage = Number(pg)
          }
        }
        if (bestPage && bestPage !== useAppStore.getState().currentPage) {
          setCurrentPage(bestPage)
        }
      },
      {
        root: container,
        // Fine-grained thresholds so small pages (last page) still register
        threshold: Array.from({ length: 21 }, (_, i) => i * 0.05),
      },
    )

    Object.values(pageRefs.current).forEach((el) => {
      if (el) observerRef.current.observe(el)
    })
  }, [totalPages, setCurrentPage])

  useEffect(() => {
    setupObserver()
    return () => observerRef.current?.disconnect()
  }, [setupObserver])

  // ── Document load ──────────────────────────────────────────────────────────
  const onDocumentLoadSuccess = useCallback(
    ({ numPages }) => {
      setTotalPages(numPages)
      setCurrentPage(1)
      setLoadError(null)
    },
    [setTotalPages, setCurrentPage],
  )

  const onDocumentLoadError = useCallback((err) => {
    setLoadError(err.message || 'Failed to load PDF')
  }, [])

  // ── Page ref: register / unregister pages with the observer ───────────────
  const setPageRef = useCallback((el, pageNum) => {
    if (el) {
      pageRefs.current[pageNum] = el
      observerRef.current?.observe(el)
    } else {
      if (pageRefs.current[pageNum]) {
        observerRef.current?.unobserve(pageRefs.current[pageNum])
        delete pageRefs.current[pageNum]
        delete ratioMap.current[pageNum]
      }
    }
  }, [])

  // ── Text selection ─────────────────────────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    setTimeout(() => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      if (!text || text.length < 3) {
        setSelectionMenu(null)
        clearSelectionContext()
        clearHighlight()
        return
      }
      const range = selection.getRangeAt(0)
      saveRange(range)
      const rect = range.getBoundingClientRect()
      const sectionPath  = findSectionPath(toc?.items, currentPage)
      const sectionTitle = sectionPath.length > 0 ? sectionPath[sectionPath.length - 1].title : null
      setSelectionMenu({
        x: rect.left + rect.width / 2,
        y: rect.top,
        text,
        pageNumber: currentPage,
        sectionTitle,
        sectionPath,
      })
      setSelectionContext({ text, pageNumber: currentPage, sectionTitle, sectionPath })
    }, 10)
  }, [currentPage, setSelectionContext, clearSelectionContext, saveRange, clearHighlight])

  const handleMenuClose = useCallback(() => {
    setSelectionMenu(null)
    window.getSelection()?.removeAllRanges()
    // CSS highlight intentionally kept alive so the highlight stays visible
  }, [])

  const handleMenuAction = useCallback(({ id, prompt, text, pageNumber, sectionTitle, sectionPath }) => {
    useAppStore.setState({
      selectionContext: { text, pageNumber, sectionTitle, sectionPath },
      pendingSelectionAction: { id, prompt, text, pageNumber, sectionTitle, sectionPath },
    })
  }, [])

  // ── Editable page number ───────────────────────────────────────────────────
  const commitPageInput = () => {
    const n = parseInt(pageInputVal, 10)
    if (!isNaN(n)) navigateToPage(n)
    setEditingPage(false)
  }

  const handlePageKeyDown = (e) => {
    if (e.key === 'Enter') commitPageInput()
    else if (e.key === 'Escape') setEditingPage(false)
  }

  // ── Render window ──────────────────────────────────────────────────────────
  const pagesToRender = []
  if (totalPages) {
    const start = Math.max(1, currentPage - RENDER_WINDOW)
    const end = Math.min(totalPages, currentPage + RENDER_WINDOW)
    for (let i = start; i <= end; i++) pagesToRender.push(i)
  }

  // ── ToC banner logic ───────────────────────────────────────────────────────
  // Show when toc is loaded AND it was generated (no native outline)
  const showTocBanner = toc && toc.generated && !tocBannerDismissed && totalPages > 0

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!selectedPdf) {
    return (
      <div className="viewer viewer-empty">
        <div className="viewer-placeholder">
          <span className="viewer-placeholder-icon">📄</span>
          <p>Select a PDF to start reading</p>
          <p className="viewer-placeholder-hint">← Upload a PDF from the sidebar, then select it to begin</p>
        </div>
      </div>
    )
  }

  const fileUrl = getPdfFileUrl(selectedPdf.id)

  return (
    <div className="viewer">
      {/* Toolbar */}
      <div className="viewer-toolbar">
        <span className="viewer-title">{selectedPdf.title}</span>
        <div className="viewer-controls">
          {toc && toc.items.length > 0 && (
            <button
              className={`viewer-btn viewer-toc-btn ${showToc ? 'active' : ''}`}
              onClick={() => setShowToc((v) => !v)}
              title="Table of Contents"
            >
              ☰
            </button>
          )}

          {highlightIndex.some((e) => e.pdfId === selectedPdf?.id) && (
            <button
              className={`viewer-btn viewer-lens-btn ${lensEnabled ? 'active' : ''}`}
              onClick={() => setLensEnabled((v) => {
                const next = !v
                localStorage.setItem('lens-enabled', next)
                return next
              })}
              title={lensEnabled ? 'Hide indexed passage highlights' : 'Show indexed passages in PDF'}
            >
              {lensEnabled ? '◉' : '◎'}
            </button>
          )}

          <button
            className="viewer-btn"
            onClick={() => navigateToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            ‹
          </button>

          {editingPage ? (
            <input
              className="viewer-page-input"
              type="number"
              min={1}
              max={totalPages}
              value={pageInputVal}
              autoFocus
              onChange={(e) => setPageInputVal(e.target.value)}
              onBlur={commitPageInput}
              onKeyDown={handlePageKeyDown}
            />
          ) : (
            <span
              className="viewer-page-info clickable"
              title="Click to jump to a page"
              onClick={() => { setPageInputVal(String(currentPage)); setEditingPage(true) }}
            >
              {currentPage} / {totalPages || '—'}
            </span>
          )}

          <button
            className="viewer-btn"
            onClick={() => navigateToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            ›
          </button>
          <span className="viewer-sep" />
          <button className="viewer-btn" onClick={() => setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)))}>−</button>
          <span className="viewer-scale">{Math.round(scale * 100)}%</span>
          <button className="viewer-btn" onClick={() => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)))}>+</button>
        </div>
      </div>

      <div className="viewer-body">
        {/* ToC side panel */}
        {showToc && toc && toc.items.length > 0 && (() => {
          const q = tocFilter.trim().toLowerCase()
          const filtered = q
            ? toc.items.filter((it) => it.title.toLowerCase().includes(q))
            : toc.items
          return (
            <div className="viewer-toc">
              <div className="viewer-toc-header">
                <span>Contents</span>
                {toc.generated && (
                  <span
                    className="viewer-toc-generated"
                    title={toc.mode === 'fine'
                      ? 'Auto-generated — headings + subheadings (short PDF)'
                      : 'Auto-generated — chapter headings only (long PDF)'}
                  >
                    ✦ {toc.mode === 'fine' ? 'auto · detailed' : 'auto · chapters'}
                  </span>
                )}
                <button className="viewer-toc-close" onClick={() => setShowToc(false)}>✕</button>
              </div>
              <div className="viewer-toc-search-wrap">
                <input
                  className="viewer-toc-search"
                  type="text"
                  placeholder={`Search ${toc.items.length} entries…`}
                  value={tocFilter}
                  onChange={(e) => setTocFilter(e.target.value)}
                />
                {tocFilter && (
                  <button className="viewer-toc-search-clear" onClick={() => setTocFilter('')}>✕</button>
                )}
              </div>
              {filtered.length === 0 ? (
                <p className="viewer-toc-no-results">No entries match "{tocFilter}"</p>
              ) : (
                <ul className="viewer-toc-list">
                  {filtered.map((item, i) => (
                    <li key={i} className={`viewer-toc-item level-${item.level}`}>
                      <button
                        className="viewer-toc-link"
                        onClick={() => navigateToPage(item.page)}
                        title={`Page ${item.page}`}
                      >
                        <span className="viewer-toc-title">{item.title}</span>
                        <span className="viewer-toc-page">{item.page}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })()}

        {/* PDF scroll area */}
        <div className="viewer-canvas-wrap" ref={scrollRef} onMouseUp={handleMouseUp}>
          {/* ToC banner — shown above page 1 when no native outline exists */}
          {showTocBanner && (
            <div className="viewer-toc-banner">
              <span className="viewer-toc-banner-icon">📋</span>
              <div className="viewer-toc-banner-text">
                {toc.items.length > 0
                  ? toc.mode === 'fine'
                    ? <>No built-in contents found. Detected <strong>{toc.items.length} headings &amp; subheadings</strong> — want a navigable panel?</>
                    : <>No built-in contents found. Detected <strong>{toc.items.length} chapter headings</strong> — want a navigable panel?</>
                  : <>This PDF has no table of contents and no headings were detected.</>
                }
              </div>
              <div className="viewer-toc-banner-actions">
                {toc.items.length > 0 && (
                  <button
                    className="viewer-toc-banner-yes"
                    onClick={() => { setShowToc(true); setTocBannerDismissed(true); }}
                  >
                    Yes, show me
                  </button>
                )}
                <button
                  className="viewer-toc-banner-dismiss"
                  onClick={() => setTocBannerDismissed(true)}
                >
                  {toc.items.length > 0 ? 'No thanks' : 'Dismiss'}
                </button>
              </div>
            </div>
          )}

          {loadError ? (
            <p className="viewer-error">{loadError}</p>
          ) : (
            <Document
              file={fileUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={<div className="viewer-loading">Loading PDF…</div>}
            >
              {pagesToRender.map((pageNum) => (
                <div
                  key={pageNum}
                  ref={(el) => setPageRef(el, pageNum)}
                  data-page={pageNum}
                  className="viewer-page-wrapper"
                >
                  <Page
                    pageNumber={pageNum}
                    scale={scale}
                    renderTextLayer
                    renderAnnotationLayer
                    loading={<div className="viewer-page-placeholder" style={{ height: 800 }} />}
                    onRenderTextLayerSuccess={getTextLayerHandler(pageNum)}
                  />
                </div>
              ))}
            </Document>
          )}
        </div>
      </div>

      {selectionMenu && (
        <SelectionMenu
          position={{ x: selectionMenu.x, y: selectionMenu.y }}
          text={selectionMenu.text}
          pageNumber={selectionMenu.pageNumber}
          sectionTitle={selectionMenu.sectionTitle}
          sectionPath={selectionMenu.sectionPath}
          onAction={handleMenuAction}
          onClose={handleMenuClose}
        />
      )}

      {highlightPopover && (
        <HighlightPopover
          entryId={highlightPopover.entryId}
          x={highlightPopover.x}
          y={highlightPopover.y}
          onClose={() => setHighlightPopover(null)}
        />
      )}
    </div>
  )
}
