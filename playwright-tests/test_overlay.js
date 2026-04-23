/**
 * End-to-end test: verify overlay divs are created after the findTextRange fix.
 * Uses the live app (Vite HMR should have picked up the change).
 */
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

  const logs = []
  page.on('console', m => { if (!m.text().includes('vite') && !m.text().includes('DevTools')) logs.push(`[${m.type()}] ${m.text()}`) })

  // Force fresh load (no cached bundle)
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await page.waitForTimeout(1000)

  // Navigate to page 7
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await page.waitForTimeout(200)
  const input = await page.$('.viewer-page-input')
  if (input) {
    await input.click({ clickCount: 3 })
    await input.fill('7')
    await input.press('Enter')
    console.log('Navigated to page 7')
  }

  // Wait for page 7 text layer
  await page.waitForTimeout(3000)

  const tlSpans = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.textLayer')).map(tl => ({
      spans: tl.querySelectorAll('span').length,
      first: tl.querySelector('span')?.textContent?.slice(0,20) || ''
    }))
  })
  console.log('Text layers:', JSON.stringify(tlSpans))

  // Enable lens
  const lensBtn = await page.$('.viewer-lens-btn')
  if (lensBtn) {
    await lensBtn.click()
    console.log('Lens enabled')
    await page.waitForTimeout(1000)
  }

  const overlaysAfterLens = await page.evaluate(() => ({
    total: document.querySelectorAll('.pdf-hl-overlay').length,
    lens: document.querySelectorAll('.pdf-hl-overlay.pdf-hl-lens').length,
  }))
  console.log('Overlays after lens enable:', JSON.stringify(overlaysAfterLens))

  // Open index tab and click the passage entry
  await page.click('button.chat-tab:last-child')
  await page.waitForTimeout(300)

  const entryBtn = await page.$('.idx-entry-text')
  if (entryBtn) {
    const txt = await entryBtn.textContent()
    console.log(`Clicking entry: "${txt?.slice(0,50)}"`)
    await entryBtn.click()
    await page.waitForTimeout(3000)
  }

  const overlaysAfterFlash = await page.evaluate(() => ({
    total: document.querySelectorAll('.pdf-hl-overlay').length,
    lens: document.querySelectorAll('.pdf-hl-overlay.pdf-hl-lens').length,
    flash: document.querySelectorAll('.pdf-hl-overlay.pdf-hl-flash').length,
  }))
  console.log('Overlays after flash click:', JSON.stringify(overlaysAfterFlash))

  // Inspect overlay dimensions if any exist
  if (overlaysAfterFlash.total > 0) {
    const overlayDetails = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.pdf-hl-overlay')).slice(0,5).map(el => ({
        class: el.className,
        style: el.getAttribute('style'),
      }))
    })
    console.log('Overlay details:', JSON.stringify(overlayDetails, null, 2))
  }

  // Verify the updated findTextRange works by running it in-browser
  const findRangeTest = await page.evaluate(() => {
    const searchText = 'A preliminary list of diseases, disorders, tests and treatments was compiled from a wide variety of sources, including professional medical guides and textbooks as well as consumer guides and encyclopedias.'
    const tls = Array.from(document.querySelectorAll('.textLayer'))

    for (const tl of tls) {
      const spans = tl.querySelectorAll('span')
      if (!spans.length) continue

      // Build flat string
      const walker = document.createTreeWalker(tl, NodeFilter.SHOW_TEXT)
      const nodes = []
      let n
      while ((n = walker.nextNode())) nodes.push(n)

      let flat = ''
      for (const nd of nodes) flat += nd.textContent

      // Check strategy 3: strip whitespace + hyphens
      const flatDehyph = flat.replace(/[\s-]/g, '').toLowerCase()
      const anchorDehyph = searchText.slice(0, 60).replace(/[\s-]/g, '').toLowerCase()
      const idx = flatDehyph.indexOf(anchorDehyph)

      if (idx !== -1) {
        return {
          found: true,
          strategy: 'strip-ws-hyphen',
          spanCount: spans.length,
          firstText: spans[0]?.textContent?.slice(0,30),
          matchPos: idx,
        }
      }

      // Check strategy 2: strip whitespace only
      const flatWs = flat.replace(/\s/g, '').toLowerCase()
      const anchorWs = searchText.slice(0, 60).replace(/\s/g, '').toLowerCase()
      const idx2 = flatWs.indexOf(anchorWs)
      if (idx2 !== -1) {
        return { found: true, strategy: 'strip-ws-only', spanCount: spans.length }
      }
    }
    return { found: false }
  })
  console.log('\nfindTextRange strategy test:', JSON.stringify(findRangeTest))

  console.log('\n── App logs ──')
  logs.forEach(l => console.log(l))

  await browser.close()
})()
