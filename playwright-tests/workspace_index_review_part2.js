const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })

  await page.locator('.session-title').filter({ hasText: 'Learning Design Research' }).waitFor({ timeout: 10000 })
  const learning = page.locator('.session-group').filter({ hasText: 'Learning Design Research' })
  await learning.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.locator('.viewer-title').filter({ hasText: /Making Medic/i }).waitFor({ timeout: 10000 })

  await page.locator('.workspace-tab').filter({ hasText: 'Index' }).click()
  await page.getByRole('heading', { name: 'Knowledge Map' }).waitFor({ timeout: 10000 })
  await page.getByText('Session → paper → index').waitFor({ timeout: 10000 })
  await page.locator('.idx-stats').filter({ hasText: /passages/i }).waitFor({ timeout: 10000 })
  const indexMetric = await page.locator('.workspace-metric').filter({ hasText: 'Visible index entries' }).textContent()
  console.log('index metric:', indexMetric)
  const firstIndexCard = page.locator('.workspace-index-entry-card').first()
  await firstIndexCard.locator('button').filter({ hasText: 'Show details' }).click()
  const answerToggle = firstIndexCard.locator('.workspace-index-history-toggle').first()
  await answerToggle.waitFor({ timeout: 10000 })
  if (/Read answer/i.test((await answerToggle.textContent()) || '')) {
    await answerToggle.click()
  }
  await firstIndexCard.locator('.workspace-index-answer-body').first().waitFor({ timeout: 10000 })
  await firstIndexCard.getByText('Answer').first().waitFor({ timeout: 10000 })
  console.log('index answer visibility:', await firstIndexCard.locator('.workspace-index-answer-body').first().textContent())

  await page.locator('.workspace-tab').filter({ hasText: 'Review' }).click()
  await page.getByRole('heading', { name: 'Study Queues' }).waitFor({ timeout: 10000 })
  await page.getByText('Session Queue').waitFor({ timeout: 10000 })
  await page.getByText('Facet Breakdown').waitFor({ timeout: 10000 })
  await page.getByText('Paper Queues').waitFor({ timeout: 10000 })
  const reviewButtons = await page.locator('.workspace-review-actions button').allTextContents()
  console.log('review actions:', JSON.stringify(reviewButtons))
  if (!reviewButtons.some((text) => /Review This Session/.test(text))) {
    throw new Error('Full-page review actions should include session review')
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
