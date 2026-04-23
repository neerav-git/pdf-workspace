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
  await page.waitForTimeout(400)
  await page.locator('.idx-view-tab').filter({ hasText: 'By Section' }).click()
  await page.waitForTimeout(400)

  const headings = await page.locator('.idx-h1-title, .idx-h2-title').allTextContents()
  const sectionLabels = await page.locator('.idx-entry-section-label').allTextContents()
  const sectionContexts = await page.locator('.idx-entry-section-context').allTextContents()

  console.log('section headings:', JSON.stringify(headings))
  console.log('section labels:', JSON.stringify(sectionLabels))
  console.log('section contexts:', JSON.stringify(sectionContexts))

  const allText = [...headings, ...sectionLabels, ...sectionContexts].join(' || ')

  if (/arXiv:/i.test(allText)) fail('Taxonomy should not expose arXiv metadata as a section label')
  if (/\bT\d/i.test(allText)) fail('Taxonomy should not expose cryptic table-like labels as section labels')
  if (/Uncategorized/i.test(allText)) fail('Taxonomy should not expose Uncategorized buckets')
  if (!/medical literature accessibility|readability barriers|medical jargon|reading comprehension/i.test(allText)) {
    fail('Taxonomy should expose conceptual cluster labels after step 4')
  }
  if (!/Implementation|Term Definitions|INTRODUCTION/i.test(allText)) {
    fail('Meaningful paper structure should remain visible alongside concept clusters')
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
