const { chromium } = require('playwright')
const path = require('path')
const SS = path.join(__dirname, 'screenshots')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  // Capture all console logs
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERR:', msg.text())
  })

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await page.locator('.pdf-item').first().click()
  await page.waitForTimeout(1000)

  // Enable lens before PDF finishes loading
  const lensBtn = page.locator('.viewer-lens-btn')
  if (await lensBtn.count() > 0) {
    await lensBtn.click()
    console.log('Lens enabled early')
  }

  // Wait for text layer
  try {
    await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
    console.log('Text layer appeared')
  } catch {
    console.log('Text layer timeout')
  }
  await page.waitForTimeout(2000)

  await page.screenshot({ path: `${SS}/dbg3_01.png` })

  // Check state via JS injection into the React context
  const info = await page.evaluate(() => {
    const wrappers = document.querySelectorAll('.viewer-page-wrapper')
    const overlays = document.querySelectorAll('.pdf-hl-overlay')
    const textSpans = document.querySelectorAll('.react-pdf__Page__textContent span')
    const lens = document.querySelectorAll('.pdf-hl-overlay.pdf-hl-lens, .pdf-hl-overlay.pdf-hl-lens-flagged, .pdf-hl-overlay.pdf-hl-lens-anchored, .pdf-hl-overlay.pdf-hl-lens-reviewed')
    return {
      wrappers: wrappers.length,
      overlays: overlays.length,
      lensOverlays: lens.length,
      textSpans: textSpans.length,
      // Sample text span content
      sampleText: textSpans[0]?.textContent?.slice(0, 60) || 'none',
    }
  })
  console.log('DOM state:', JSON.stringify(info, null, 2))

  // If no overlays, toggle lens off/on to retrigger
  if (info.lensOverlays === 0 && info.wrappers > 0) {
    console.log('Toggling lens to retrigger...')
    await page.locator('.viewer-lens-btn').click()
    await page.waitForTimeout(300)
    await page.locator('.viewer-lens-btn').click()
    await page.waitForTimeout(1500)

    const info2 = await page.evaluate(() => {
      const overlays = document.querySelectorAll('.pdf-hl-overlay.pdf-hl-lens, .pdf-hl-overlay.pdf-hl-lens-flagged, .pdf-hl-overlay.pdf-hl-lens-anchored, .pdf-hl-overlay.pdf-hl-lens-reviewed')
      return { lensOverlays: overlays.length }
    })
    console.log('After toggle:', info2)
  }

  await page.screenshot({ path: `${SS}/dbg3_02_final.png` })
  await browser.close()
})()
