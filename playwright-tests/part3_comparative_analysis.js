const { chromium } = require('playwright')

async function api(page, path) {
  return page.evaluate(async (path) => {
    const res = await fetch(`http://localhost:8000${path}`)
    const data = await res.json()
    return { ok: res.ok, status: res.status, data }
  }, path)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })

  await page.locator('.session-title').filter({ hasText: 'Learning Design Research' }).waitFor({ timeout: 10000 })
  const learning = page.locator('.session-group').filter({ hasText: 'Learning Design Research' })
  await learning.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.locator('.viewer-title').filter({ hasText: /Making Medic/i }).waitFor({ timeout: 10000 })

  await page.locator('.chat-tab').filter({ hasText: 'Compare' }).click()
  await page.getByText('Comparative Analysis').waitFor({ timeout: 10000 })
  await page.getByText('Literature Review Table').waitFor({ timeout: 10000 })
  await page.getByText('Topic Coverage').waitFor({ timeout: 10000 })
  await page.getByText('Gaps & Next Questions').waitFor({ timeout: 10000 })

  const analysis = await api(page, '/api/research-sessions/1/comparative-analysis')
  if (!analysis.ok) throw new Error('Comparative analysis endpoint should succeed')
  const labels = (analysis.data.baseline_dimensions || []).map((row) => row.label)
  console.log('baseline labels:', JSON.stringify(labels))
  for (const expected of ['Core Problem', 'Method / Approach', 'Findings / Results', 'Learning Takeaways']) {
    if (!labels.includes(expected)) throw new Error(`Missing baseline dimension: ${expected}`)
  }
  if ((analysis.data.papers || []).length < 2) {
    throw new Error('Learning Design session should include multiple papers for comparison')
  }
  if (!analysis.data.gap_panel?.recommended_next_actions?.length) {
    throw new Error('Gap panel should provide next actions')
  }
  if (/generated|stale/i.test(analysis.data.ai_comparison?.status || '')) {
    if (!(analysis.data.ai_comparison?.research_gaps || []).length) {
      throw new Error('Generated AI comparison should expose research gaps')
    }
    if (!(analysis.data.ai_comparison?.reader_guidance || []).length) {
      throw new Error('Generated AI comparison should expose reader guidance')
    }
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
