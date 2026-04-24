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
  const page = await browser.newPage({ viewport: { width: 1650, height: 1000 } })
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })

  await page.locator('.session-title').filter({ hasText: 'Learning Design Research' }).waitFor({ timeout: 10000 })
  const learning = page.locator('.session-group').filter({ hasText: 'Learning Design Research' })
  await learning.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.locator('.viewer-title').filter({ hasText: /Making Medic/i }).waitFor({ timeout: 10000 })

  await page.locator('.workspace-tab').filter({ hasText: 'Compare' }).click()
  await page.getByRole('heading', { name: 'Comparative Research Desk' }).waitFor({ timeout: 10000 })
  await page.getByText(/Literature Review Matrix/).waitFor({ timeout: 10000 })
  await page.getByText('Topic Coverage').waitFor({ timeout: 10000 })
  await page.getByText('Gaps & Next Questions').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: /Generate AI Comparison|Refresh AI Comparison/ }).waitFor({ timeout: 10000 })
  await page.getByText(/Deterministic fallback active|AI PDF analysis active/).waitFor({ timeout: 10000 })

  const statusText = await page.locator('.workspace-compare-policy').innerText()
  if (/AI PDF analysis active/i.test(statusText)) {
    await page.getByText('Reader Decision Guide').waitFor({ timeout: 10000 })
  }

  const matrixHeaders = await page.locator('.workspace-compare-table thead th').allInnerTexts()
  if (!matrixHeaders.some((text) => /Making Medical Research Papers/i.test(text))) {
    throw new Error('Full-page compare should include Paper Plain as a matrix column')
  }
  if (!matrixHeaders.some((text) => /Knowledge-Aware Retrieval/i.test(text))) {
    throw new Error('Full-page compare should include Knowledge-Aware Retrieval as a matrix column')
  }

  const metrics = await page.locator('.workspace-metric').allInnerTexts()
  console.log('compare metrics:', JSON.stringify(metrics))
  if (!metrics.some((text) => /Coverage score/i.test(text))) {
    throw new Error('Compare workspace should expose coverage score')
  }

  const analysis = await api(page, '/api/research-sessions/1/comparative-analysis')
  if (!analysis.ok) throw new Error('Comparative analysis endpoint should remain available')
  if ((analysis.data.baseline_dimensions || []).length < 4) {
    throw new Error('Comparative analysis should expose baseline dimensions')
  }
  if (/generated|stale/i.test(analysis.data.ai_comparison?.status || '')) {
    if (!(analysis.data.ai_comparison?.reader_guidance || []).length) {
      throw new Error('Generated AI comparison should expose reader guidance cards')
    }
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
