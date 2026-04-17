/**
 * Find index entries related to a selected text + page.
 * Returns entries sorted by relevance score (desc).
 */
export function findRelatedEntries(entries, selectedText, pageNumber) {
  if (!entries.length) return []

  const scored = entries.map((entry) => ({
    entry,
    score: relevanceScore(entry, selectedText, pageNumber),
  }))

  const MAX_SCORE = 3
  const threshold = 0.25

  const relevant = scored
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)

  if (relevant.length > 0) return relevant.map(({ entry }) => entry)

  // Fallback: same page
  const samePage = entries.filter((e) => e.pageNumber === pageNumber)
  return samePage.length > 0 ? samePage : []
}

function relevanceScore(entry, selectedText, pageNumber) {
  let score = 0

  // Exact match
  if (entry.highlightText === selectedText) return 3

  // Substring containment
  const a = selectedText.toLowerCase()
  const b = entry.highlightText.toLowerCase()
  if (b.includes(a) || a.includes(b)) score += 1.5

  // Word overlap (only words > 3 chars to skip stopwords)
  const wordsA = significantWords(a)
  const wordsB = significantWords(b)
  if (wordsA.size > 0 && wordsB.size > 0) {
    const shared = [...wordsA].filter((w) => wordsB.has(w)).length
    score += shared / Math.max(wordsA.size, wordsB.size)
  }

  // Same page bonus
  if (entry.pageNumber === pageNumber) score += 0.3

  return score
}

function significantWords(text) {
  return new Set(text.split(/\W+/).filter((w) => w.length > 3))
}
