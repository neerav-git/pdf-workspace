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
  await page.waitForSelector('.viewer-lens-btn', { timeout: 10000 })
  await page.waitForTimeout(500)

  // Try clicking page info to get the input
  await page.screenshot({ path: `${SS}/nav_01_before.png` })

  const info = await page.evaluate(() => {
    const el = document.querySelector('.viewer-page-info')
    return { found: !!el, classes: el?.className, text: el?.textContent }
  })
  console.log('Page info el:', info)

  // Try clicking it
  const pageInfo = page.locator('.viewer-page-info')
  if (await pageInfo.count() > 0) {
    await pageInfo.click()
    await page.waitForTimeout(500)
    const input = await page.locator('.viewer-page-input').count()
    console.log('Page input visible:', input)
    if (input > 0) {
      await page.locator('.viewer-page-input').fill('7')
      await page.locator('.viewer-page-input').press('Enter')
      await page.waitForTimeout(3000)
    }
  }

  await page.screenshot({ path: `${SS}/nav_02_after.png` })

  // Check what's rendered
  const state = await page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('.viewer-page-wrapper')).map(w => ({
      page: w.dataset.page,
      spans: w.querySelectorAll('.textLayer span, .react-pdf__Page__textContent span').length
    }))
    return wrappers
  })
  console.log('Rendered pages:', state)

  await browser.close()
})()
