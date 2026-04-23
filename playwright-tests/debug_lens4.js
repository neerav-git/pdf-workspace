const { chromium } = require('playwright')
const path = require('path')
const SS = path.join(__dirname, 'screenshots')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  // Capture debug logs
  page.on('console', msg => {
    if (msg.text().includes('[lens]') || msg.type() === 'error') {
      console.log('BROWSER:', msg.text())
    }
  })

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await page.locator('.pdf-item').first().click()

  // Wait for lens button (signals highlights loaded)
  await page.waitForSelector('.viewer-lens-btn', { timeout: 10000 })
  console.log('Lens button visible')

  // Wait for text layer
  try {
    await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
    console.log('Text layer ready')
  } catch { console.log('Text layer timeout') }
  await page.waitForTimeout(1000)

  // Enable lens
  await page.locator('.viewer-lens-btn').click()
  await page.waitForTimeout(2000)

  const info = await page.evaluate(() => {
    const wrappers = document.querySelectorAll('.viewer-page-wrapper')
    const lens = document.querySelectorAll('.pdf-hl-overlay')
    return { wrappers: wrappers.length, lens: lens.length }
  })
  console.log('Result:', info)
  await page.screenshot({ path: `${SS}/dbg4_result.png` })
  await browser.close()
})()
