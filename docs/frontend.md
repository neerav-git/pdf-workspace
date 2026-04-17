# Frontend Deep-Dive

## State (Zustand — store/index.js)

```
pdfs[]              PDF library list
selectedPdf         currently open PDF {id, title, page_count, ...}
currentPage         physical page number (1-indexed)
totalPages
selectionContext    {text, pageNumber} — active text selection
pendingSelectionAction  {id, prompt, text, pageNumber} — set by PDFViewer, consumed by ChatPanel
chatHistory[]       {role, content, meta?}
sources[]           last response source pages
isLoading
highlightIndex[]    [{id, pdfId, pageNumber, highlightText, starred, qaPairs[]}]
notes[]             quick pin notes [{id, pdfId, pageNumber, highlight, note}]
indexFocus          {text, pageNumber} — drives scroll-to in HighlightIndex
```

## Component Communication Pattern

PDFViewer → ChatPanel is done via the store, not props:
```
PDFViewer.handleMenuAction()
  → useAppStore.setState({ selectionContext, pendingSelectionAction })

ChatPanel useEffect (subscribe)
  → watches pendingSelectionAction
  → handles: 'note', 'voice', 'view-index', or any action with a prompt
```

## PDFViewer — Scrolling Architecture

- Renders pages `currentPage ± RENDER_WINDOW (3)` — 7 pages max at a time
- `pageRefs`: maps pageNum → DOM element (populated via ref callback)
- `ratioMap`: maps pageNum → latest IntersectionObserver ratio (persists across callbacks)
  → always picks the page with highest visible fraction across ALL rendered pages
- `navigateToPage(n)`: sets `pendingScrollPage` ref + calls `setCurrentPage(n)`
- No-deps `useEffect` runs after every render: if `pageRefs[pendingScrollPage]` exists → scroll + clear

Why no-deps effect: the target page may not be in DOM when `setCurrentPage` fires (it's outside
the render window). The effect retries each render cycle until the page mounts.

## Persistent Highlight

`usePersistentHighlight` hook:
- On mouseup: `saveRange(range.cloneRange())` → `CSS.highlights.set('pdf-selection', new Highlight(range))`
- `::highlight(pdf-selection)` CSS rule applies the blue tint
- `clearHighlight()` called when user deselects (clicks away with no text selected)
- Intentionally NOT cleared when menu closes → highlight stays visible during chat interaction
- Falls back gracefully in browsers without CSS Custom Highlight API support

## SelectionMenu — Why onMouseDown Prevention Matters

Without `e.preventDefault()` on mousedown, clicking a button:
1. Fires mousedown → browser moves focus to the button
2. Focus change triggers selection clear
3. Click fires → but `selectionContext` is now empty

With prevention: focus never moves, selection survives, click handler gets the right context.
Applied to ALL 8 buttons in SelectionMenu and interactive buttons in HighlightIndex.

## HighlightIndex — Vite Fast Refresh Rule

Module-level components that call hooks (useState, useEffect, useAppStore) cause Vite Fast
Refresh to blank the page. Fix: all rendering is inlined in the single exported `HighlightIndex`
component. No sub-components with hooks.

## TOC Panel — Search Filter

`tocFilter` state (string). Filters `toc.items` client-side on every keystroke.
Empty string = show all. Placeholder shows total count ("Search 340 entries…").
Filter resets when selectedPdf changes.

IIFE pattern used in JSX to compute `filtered` without a separate variable:
```jsx
{showToc && toc && toc.items.length > 0 && (() => {
  const filtered = tocFilter ? toc.items.filter(...) : toc.items
  return <div className="viewer-toc">...</div>
})()}
```
