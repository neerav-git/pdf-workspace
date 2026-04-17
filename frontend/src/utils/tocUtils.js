/**
 * Given a ToC items array and a page number, return the full ancestor path
 * from the root heading down to the most specific heading that contains
 * the given page.
 *
 * Example: page 7 in a document where:
 *   Level 1: "Introduction"  (page 1)
 *   Level 2: "About the Contributors" (page 7)
 *   Level 1: "Chapter A"     (page 15)
 *
 * Returns: [{ title: "Introduction", level: 1 }, { title: "About the Contributors", level: 2 }]
 *
 * Algorithm:
 *   1. Take all headings at or before the target page.
 *   2. Sort by page descending, then by level descending (deepest first).
 *   3. Walk the sorted list: include an item only if its level is strictly
 *      less than the minimum level seen so far — this builds the ancestor
 *      chain from deepest up to the root.
 *   4. Reverse to get root → leaf order.
 *
 * @param {Array}  items      ToC items: [{ title, page, level }, ...]
 * @param {number} pageNumber Target page number
 * @returns {Array}           Path: [{title, level}, ...] root → leaf, or []
 */
export function findSectionPath(items, pageNumber) {
  if (!items || items.length === 0) return []

  const candidates = items
    .filter((item) => item.page <= pageNumber)
    .sort((a, b) => b.page - a.page || b.level - a.level)  // nearest page first, deepest level first

  const path = []
  let minLevelSeen = Infinity

  for (const item of candidates) {
    if (item.level < minLevelSeen) {
      path.push({ title: item.title, level: item.level })
      minLevelSeen = item.level
    }
  }

  // path is deepest→root; reverse to get root→leaf
  path.reverse()
  return path
}

/**
 * Convenience: return just the leaf (most specific) section title, or null.
 * Used for the chat prompt label where a single string is enough.
 */
export function findSection(items, pageNumber) {
  const path = findSectionPath(items, pageNumber)
  return path.length > 0 ? path[path.length - 1].title : null
}

/**
 * Format a section path as a breadcrumb string.
 * e.g. ["Introduction", "About the Contributors"] → "Introduction → About the Contributors"
 */
export function formatSectionPath(path) {
  return path.map((p) => p.title).join(' → ')
}
