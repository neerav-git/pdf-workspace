/**
 * Manages a persistent visual highlight using the CSS Custom Highlight API.
 * Falls back gracefully in browsers that don't support it.
 *
 * Usage:
 *   const { saveRange, clearHighlight } = usePersistentHighlight()
 *   // After mouseup: saveRange(window.getSelection().getRangeAt(0))
 *   // The highlight persists even after the selection is cleared.
 */

import { useCallback, useRef } from 'react'

const HIGHLIGHT_NAME = 'pdf-selection'
const SUPPORTED = typeof CSS !== 'undefined' && typeof CSS.highlights !== 'undefined'

export function usePersistentHighlight() {
  const rangeRef = useRef(null)

  const saveRange = useCallback((range) => {
    if (!range) return
    rangeRef.current = range.cloneRange()
    if (SUPPORTED) {
      const hl = new Highlight(rangeRef.current)
      CSS.highlights.set(HIGHLIGHT_NAME, hl)
    }
  }, [])

  const clearHighlight = useCallback(() => {
    rangeRef.current = null
    if (SUPPORTED) {
      CSS.highlights.delete(HIGHLIGHT_NAME)
    }
  }, [])

  return { saveRange, clearHighlight }
}
