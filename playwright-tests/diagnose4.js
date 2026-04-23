/**
 * Dump text layer content for page 7 and test the exact stored text.
 */
const { chromium } = require('playwright')

const SEARCH_TEXT = 'A preliminary list of diseases, disorders, tests and treatments was compiled from a wide variety of sources, including professional medical guides and textbooks as well as consumer guides and encyclopedias.'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })

  // Navigate to page 7
  await page.waitForTimeout(1000)
  await page.click('.viewer-page-info.clickable')
  await page.waitForTimeout(200)
  const input = await page.$('.viewer-page-input')
  await input.click({ clickCount: 3 })
  await input.fill('7')
  await input.press('Enter')

  // Wait for text layers to populate
  await page.waitForTimeout(3000)

  // Dump ALL text layers
  const textLayerDump = await page.evaluate(() => {
    const tls = Array.from(document.querySelectorAll('.textLayer'))
    return tls.map(tl => {
      const spans = tl.querySelectorAll('span')
      const raw = Array.from(spans).map(s => s.textContent).join('')
      const normalised = raw.replace(/\s+/g, ' ').trim()
      return {
        spanCount: spans.length,
        rawSlice: raw.slice(0, 200),
        normSlice: normalised.slice(0, 200),
        hasPreliminary: normalised.toLowerCase().includes('preliminary'),
        hasDisorders: normalised.toLowerCase().includes('disorders'),
      }
    })
  })
  console.log('=== TEXT LAYER DUMP ===')
  textLayerDump.forEach((tl, i) => {
    console.log(`\n[Layer ${i}] spans=${tl.spanCount} hasPreliminary=${tl.hasPreliminary} hasDisorders=${tl.hasDisorders}`)
    console.log('  raw:', JSON.stringify(tl.rawSlice))
    console.log('  norm:', JSON.stringify(tl.normSlice))
  })

  // Now try findTextRange with the exact anchor (first 60 chars)
  const anchor = SEARCH_TEXT.slice(0, 60)
  console.log(`\n=== SEARCHING FOR ANCHOR ===\n"${anchor}"`)

  const searchResult = await page.evaluate((anchor) => {
    const tls = Array.from(document.querySelectorAll('.textLayer'))
    return tls.map((tl, i) => {
      const spans = tl.querySelectorAll('span')
      const raw = Array.from(spans).map(s => s.textContent).join('')
      const norm = raw.replace(/\s+/g, ' ').trim().toLowerCase()
      const anchorLower = anchor.toLowerCase()
      const idx = norm.indexOf(anchorLower)

      // Also try stripped
      const rawStripped = raw.replace(/\s/g, '').toLowerCase()
      const anchorStripped = anchor.replace(/\s/g, '').toLowerCase()
      const idxStripped = rawStripped.indexOf(anchorStripped)

      // Find first differing position
      let diffPos = -1
      if (idx === -1 && idxStripped === -1) {
        // Find common prefix
        const short = anchorLower.slice(0, 20)
        const pos = norm.indexOf(short)
        if (pos !== -1) {
          diffPos = pos
          const context = norm.slice(pos, pos + 80)
          return { layer: i, found: false, strippedFound: false, partialContext: context }
        }
      }

      return {
        layer: i,
        found: idx !== -1,
        strippedFound: idxStripped !== -1,
        normIdx: idx,
      }
    })
  }, anchor)
  console.log('\nSearch results:', JSON.stringify(searchResult, null, 2))

  await browser.close()
})()
