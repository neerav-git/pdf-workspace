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
  } catch { console.log('No text layer') }
  await page.waitForTimeout(1000)

  // Get text content of the first page's text layer
  const textContent = await page.evaluate(() => {
    const layers = document.querySelectorAll('[data-page="1"] .textLayer, [data-page="1"] .react-pdf__Page__textContent')
    if (!layers.length) return { found: false, text: '' }
    const text = Array.from(layers[0].querySelectorAll('span')).map(s => s.textContent).join('|')
    return { found: true, spanCount: layers[0].querySelectorAll('span').length, text: text.slice(0, 1000) }
  })
  console.log('Page 1 text layer:', JSON.stringify(textContent, null, 2))

  // Check all page wrappers
  const wrapperPages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.viewer-page-wrapper')).map(w => w.dataset.page)
  })
  console.log('Rendered pages:', wrapperPages)

  await browser.close()
})()
