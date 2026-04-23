const { chromium } = require('playwright')

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1550, height: 920 } })

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
  await page.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(500)

  const reviewBar = await page.locator('.idx-review-bar').textContent()
  console.log('review bar:', reviewBar)
  if (!/Review This PDF/i.test(reviewBar || '')) fail('Primary review CTA should be PDF-scoped')
  if (!/Review All Due/i.test(reviewBar || '')) fail('Secondary review CTA should be global')

  const stats = await page.locator('.idx-stats').textContent()
  console.log('stats:', stats)
  if (!/due in this PDF/i.test(stats || '')) fail('Stats bar should expose per-PDF due count')

  const focusTitles = await page.locator('.idx-entry-focus-title').allTextContents()
  const focusSubtitles = await page.locator('.idx-entry-focus-subtitle').allTextContents()
  console.log('focus titles:', JSON.stringify(focusTitles))
  console.log('focus subtitles:', JSON.stringify(focusSubtitles))
  if (focusTitles.length === 0) fail('Entries should show learning-oriented focus titles')
  if (focusTitles.some((t) => ['Explain', 'Simplify', 'Quiz Me', 'Summarise'].includes((t || '').trim()))) {
    fail('Entry focus titles should not be raw action labels')
  }

  const dueBadges = await page.locator('.idx-due-badge').allTextContents()
  console.log('due badges:', JSON.stringify(dueBadges))
  if (dueBadges.length === 0) fail('Entries should show due-state badges')

  await page.locator('.idx-entry').first().click()
  await page.waitForTimeout(250)

  const qaTitles = await page.locator('.idx-qa-q-text').allTextContents()
  const qaContexts = await page.locator('.idx-qa-context').allTextContents()
  console.log('qa titles:', JSON.stringify(qaTitles))
  console.log('qa contexts:', JSON.stringify(qaContexts))

  if (qaTitles.some((t) => ['Explain', 'Simplify', 'Quiz Me', 'Summarise'].includes((t || '').trim()))) {
    fail('Expanded Q&A labels should not use raw action names as the primary title')
  }
  if (!qaContexts.some((t) => /Abstract|Build understanding|Simplify the idea|Retrieval practice|High-level summary|Study question/i.test(t))) {
    fail('Expanded Q&A cards should show study-oriented context text')
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
