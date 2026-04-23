const { chromium } = require('playwright')

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

async function runJson(page, fn) {
  return page.evaluate(fn)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1550, height: 940 } })

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })

  const recompute = await runJson(page, async () => {
    const res = await fetch('http://localhost:8000/api/pdfs/5/recompute-facets-and-concepts', { method: 'POST' })
    return res.json()
  })
  console.log('recompute:', JSON.stringify(recompute))
  if (!Array.isArray(recompute.ontology_topics) || recompute.ontology_topics.length < 5) {
    fail('Backfill did not produce a usable ontology for Paper Plain')
  }

  const summary = await runJson(page, async () => {
    const highlightsRes = await fetch('http://localhost:8000/api/pdfs/5/highlights')
    const entries = await highlightsRes.json()
    const dueRes = await fetch('http://localhost:8000/api/pdfs/5/review/due')
    const due = await dueRes.json()
    return {
      entryCount: entries.length,
      qaCount: entries.reduce((n, e) => n + (e.qa_pairs || []).length, 0),
      missingCluster: entries.filter((e) => !(e.cluster_tag || '').trim()).length,
      missingFacet: entries.flatMap((e) => e.qa_pairs || []).filter((q) => !(q.rhetorical_facet || '').trim()).length,
      emptyTopics: entries.flatMap((e) => e.qa_pairs || []).filter((q) => !Array.isArray(q.topic_tags) || q.topic_tags.length === 0).length,
      clusterTags: [...new Set(entries.map((e) => e.cluster_tag).filter(Boolean))],
      facets: [...new Set(entries.flatMap((e) => (e.qa_pairs || []).map((q) => q.rhetorical_facet)).filter(Boolean))],
      dueClusters: due.slice(0, 5).map((q) => q.cluster_tag || q.section_title || 'none'),
    }
  })
  console.log('summary:', JSON.stringify(summary))

  if (summary.entryCount === 0 || summary.qaCount === 0) fail('Paper Plain should already contain saved study material')
  if (summary.missingCluster !== 0) fail('Every Paper Plain entry should have a cluster_tag after backfill')
  if (summary.missingFacet !== 0) fail('Every Paper Plain QA should have a rhetorical facet after backfill')
  if (summary.emptyTopics !== 0) fail('Every Paper Plain QA should have ontology topic tags after backfill')
  if (summary.facets.length < 2) fail('Paper Plain should expose more than one rhetorical facet after backfill')

  await page.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.waitForTimeout(1200)
  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(700)

  const tabsText = await page.locator('.idx-view-tabs').textContent()
  console.log('tabs:', tabsText)
  if (!/Facets\s+\d+\s+·\s+Topics\s+\d+/i.test(tabsText || '')) {
    fail('Index tab should expose the new Facets N · Topics M label')
  }

  await page.locator('.idx-view-tab').filter({ hasText: /^By Section$/ }).click()
  await page.waitForTimeout(500)

  const sectionHeaders = await page.locator('.idx-h1-title, .idx-section-title').allTextContents()
  console.log('section headers:', JSON.stringify(sectionHeaders))
  if (sectionHeaders.some((text) => /Other Passages/i.test(text))) {
    fail('By Section view should not show Other Passages after cluster backfill')
  }
  if (!sectionHeaders.some((text) => /medical literature accessibility|reading comprehension|medical jargon|readability barriers/i.test(text))) {
    fail('By Section view should expose concept clusters, not only structural headings')
  }

  await page.locator('.idx-entry-header').first().click()
  await page.waitForTimeout(400)
  const firstFacetBadge = page.locator('.idx-facet-badge').first()
  const firstFacetText = await firstFacetBadge.textContent().catch(() => '')
  console.log('index facet badge:', firstFacetText)
  if (!/Objective|Novelty|Method|Result|Background|Uncategorized/i.test(firstFacetText || '')) {
    fail('Index Q&A cards should render rhetorical facet badges')
  }

  await page.locator('.idx-review-btn').first().click()
  await page.waitForTimeout(1000)
  const scopeLabel = await page.locator('.rv-scope-label').textContent().catch(() => '')
  const reviewBadges = await page.locator('.rv-question-badges').first().textContent().catch(() => '')
  console.log('review scope:', scopeLabel)
  console.log('review badges:', reviewBadges)
  if (!/Due Cards for This PDF/i.test(scopeLabel || '')) {
    fail('PDF-scoped review should still open correctly')
  }
  if (!/Objective|Novelty|Method|Result|Background|Uncategorized/i.test(reviewBadges || '')) {
    fail('Review Phase 1 should render the rhetorical facet badge')
  }

  const dueClusters = summary.dueClusters.filter(Boolean)
  if (dueClusters.length >= 2 && new Set(dueClusters.slice(0, 2)).size === 1) {
    fail('Due ordering should diversify the first cards instead of repeating the same cluster immediately')
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
