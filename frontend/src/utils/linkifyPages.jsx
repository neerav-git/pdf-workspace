import React from 'react'

// Match an inline page citation. Handles common forms Claude returns:
//   "p. 9", "p.9", "p 9", "page 9", "pages 9"
// We intentionally DO NOT match multi-page ranges ("pp. 9-12", "pages 9, 12") —
// those would need ambiguous multi-jump UX; the colored source-badge row below
// the message still surfaces every cited page.
const PAGE_TOKEN = /\b(pages?|pp?)\.?\s*(\d{1,4})\b/gi

function linkifyString(text, onJump, keyPrefix) {
  const out = []
  let lastIdx = 0
  let match
  const regex = new RegExp(PAGE_TOKEN.source, 'gi')
  while ((match = regex.exec(text)) !== null) {
    const [full, prefixRaw, pageStr] = match
    const pageNum = parseInt(pageStr, 10)
    if (!Number.isFinite(pageNum)) continue
    if (match.index > lastIdx) out.push(text.slice(lastIdx, match.index))
    // Keep the user's original phrasing; just wrap the full match in a button.
    out.push(
      <button
        key={`${keyPrefix}-${match.index}`}
        type="button"
        className="inline-page-link"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onJump(pageNum)}
        title={`Jump to page ${pageNum}`}
      >
        {full}
      </button>,
    )
    lastIdx = regex.lastIndex
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx))
  return out.length > 0 ? out : [text]
}

/**
 * Recursively walk React children and replace any inline page-citation tokens
 * (e.g. "p. 9", "page 16") with clickable buttons that jump the viewer.
 *
 * Safe to call on any ReactMarkdown children — preserves nested elements like
 * <strong>, <em>, <code> by cloning them with linkified children.
 */
export function linkifyPageCitations(children, onJump, keyPrefix = 'pg') {
  return React.Children.map(children, (child, i) => {
    if (typeof child === 'string') {
      const parts = linkifyString(child, onJump, `${keyPrefix}-${i}`)
      return parts.length === 1 ? parts[0] : <>{parts}</>
    }
    if (React.isValidElement(child) && child.props && child.props.children != null) {
      return React.cloneElement(
        child,
        child.props,
        linkifyPageCitations(child.props.children, onJump, `${keyPrefix}-${i}`),
      )
    }
    return child
  })
}
