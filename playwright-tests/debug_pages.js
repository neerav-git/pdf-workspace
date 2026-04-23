const { chromium } = require('playwright')
const path = require('path')
const SS = path.join(__dirname, 'screenshots')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.locator('.pdf-item').first().click()

  try {
    await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
  } catch {}
  await page.waitForTimeout(1000)

  // Check each rendered page's text layer span count and content
  const pageInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.viewer-page-wrapper')).map(w => {
      const pageNum = w.dataset.page
      const textLayer = w.querySelector('.textLayer, .react-pdf__Page__textContent')
      const spans = textLayer ? textLayer.querySelectorAll('span') : []
      const text = Array.from(spans).slice(0, 5).map(s => s.textContent?.trim()).filter(Boolean)
      return { page: pageNum, spanCount: spans.length, sampleText: text }
    })
  })
  console.log('Page span counts:')
  pageInfo.forEach(p => console.log(`  Page ${p.page}: ${p.spanCount} spans — ${JSON.stringify(p.sampleText.join(' ')).slice(0, 80)}`))

  // Also navigate to page 7 (where the second highlight lives) and check
  await page.evaluate(() => {
    // Find page input
    const info = document.querySelector('.viewer-page-info.clickable')
    if (info) info.click()
  })
  await page.waitForTimeout(200)
  const input = page.locator('.viewer-page-input')
  if (await input.count() > 0) {
    await input.fill('7')
    await input.press('Enter')
    await page.waitForTimeout(2000)
  }

  const page7 = await page.evaluate(() => {
    const w = document.querySelector('[data-page="7"]')
    if (!w) return { found: false }
    const spans = w.querySelectorAll('.textLayer span, .react-pdf__Page__textContent span')
    const text = Array.from(spans).slice(0, 10).map(s => s.textContent?.trim()).filter(Boolean)
    return { found: true, spanCount: spans.length, sample: text.join(' ').slice(0, 200) }
  })
  console.log('\nPage 7:', JSON.stringify(page7, null, 2))

  await browser.close()
})()
