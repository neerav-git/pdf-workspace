/**
 * Targeted test: navigate to page 7, wait for text layer, test overlay creation.
 * Also tests findTextRange for the exact stored text.
 */
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

  const logs = []
  page.on('console', m => { if (!m.text().includes('vite') && !m.text().includes('DevTools')) logs.push(`[${m.type()}] ${m.text()}`) })
  page.on('pageerror', e => logs.push(`[ERR] ${e.message}`))

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await page.waitForTimeout(1000)
  console.log('PDF loaded')

  // Click Index tab
  await page.click('button.chat-tab:last-child')
  await page.waitForTimeout(300)
  console.log('Index tab open')

  // Get what the entry says
  const entry = await page.evaluate(() => {
    const btn = document.querySelector('.idx-entry-text')
    return btn ? { text: btn.textContent, fullText: btn.title } : null
  })
  console.log('Entry found:', JSON.stringify(entry))

  // Get stored highlight data from the API (since we know PDF id=1)
  const hlData = await page.evaluate(async () => {
    const r = await fetch('http://localhost:8000/api/pdfs/1/highlights')
    const data = await r.json()
    return data.map(h => ({ id: h.id, page: h.page_number, text: h.highlight_text.slice(0,60) }))
  })
  console.log('DB entries:', JSON.stringify(hlData))

  // Navigate to page 7 via the page input
  // First enable lens
  const lensBtn = await page.$('.viewer-lens-btn')
  if (lensBtn) { await lensBtn.click(); console.log('Lens enabled') }

  // Navigate to page 7 using the toolbar page navigation
  // Find the page number display and click to edit
  console.log('\n── Navigating to page 7 ──')

  // Click the page number indicator to enter edit mode
  const pageInfo = await page.$('.viewer-page-info.clickable')
  if (pageInfo) {
    await pageInfo.click()
    await page.waitForTimeout(200)
    const input = await page.$('.viewer-page-input')
    if (input) {
      await input.triple_click?.() || await input.click({ clickCount: 3 })
      await input.fill('7')
      await input.press('Enter')
      console.log('Navigated to page 7 via input')
    }
  } else {
    console.log('Page input not found, trying alternative nav')
  }

  // Wait for page 7 text layer to appear with content
  let p7spansCount = 0
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(500)
    p7spansCount = await page.evaluate(() => {
      // Find ALL text layers and count spans
      const tls = document.querySelectorAll('.textLayer')
      let maxSpans = 0
      tls.forEach(tl => { maxSpans = Math.max(maxSpans, tl.querySelectorAll('span').length) })
      return maxSpans
    })
    console.log(`Attempt ${attempt+1}: max spans in any text layer = ${p7spansCount}`)
    if (p7spansCount > 50) break  // page 7 has lots of text
  }

  // Check overlays now
  const overlaysAfterNav = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay').length)
  console.log(`\nOverlays after navigating to page 7: ${overlaysAfterNav}`)

  // Deep test: inject findTextRange function and test it on the actual text
  const searchText = 'A preliminary list of diseases, disorders, tests and treatments'
  const findResult = await page.evaluate((searchText) => {
    // Find the text layer most likely to contain our text
    const tls = Array.from(document.querySelectorAll('.textLayer'))
    for (const tl of tls) {
      const spans = tl.querySelectorAll('span')
      const combined = Array.from(spans).map(s => s.textContent).join(' ').toLowerCase()
      if (combined.includes('preliminary') || combined.includes('disorders')) {
        const pageWrapper = tl.closest('.viewer-page-wrapper')
        const wRect = pageWrapper?.getBoundingClientRect()
        return {
          found: true,
          spanCount: spans.length,
          textSample: combined.slice(0, 100),
          wrapperRect: wRect ? { l: Math.round(wRect.left), t: Math.round(wRect.top), w: Math.round(wRect.width), h: Math.round(wRect.height) } : null,
          wrapperPosition: pageWrapper ? getComputedStyle(pageWrapper).position : null,
        }
      }
    }
    // Not found — return all text layers
    return {
      found: false,
      textLayerCount: tls.length,
      samples: tls.map(tl => {
        const spans = tl.querySelectorAll('span')
        return spans[0]?.textContent?.slice(0,30) || ''
      })
    }
  }, searchText)
  console.log('\nfindTextRange target search:', JSON.stringify(findResult, null, 2))

  // Now try the actual addOverlaysForRange approach manually
  const manualOverlayTest = await page.evaluate((searchText) => {
    function findTextRange(container, searchText) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      const nodes = []
      let n
      while ((n = walker.nextNode())) nodes.push(n)
      if (!nodes.length) return null

      let flat = ''
      const src = []
      for (const nd of nodes) {
        for (let ci = 0; ci < nd.textContent.length; ci++) {
          src.push({ node: nd, offset: ci })
          flat += nd.textContent[ci]
        }
      }

      let norm = ''
      const n2f = []
      let inSpace = false
      for (let fi = 0; fi < flat.length; fi++) {
        if (/\s/.test(flat[fi])) {
          if (!inSpace) { norm += ' '; n2f.push(fi); inSpace = true }
        } else {
          norm += flat[fi]; n2f.push(fi); inSpace = false
        }
      }

      const dehyphenated = searchText.replace(/-\r?\n/g, '').replace(/-\n/g, '')
      const anchor = dehyphenated.replace(/\s+/g, ' ').trim().slice(0, 60)
      if (!anchor) return null

      let si = norm.toLowerCase().indexOf(anchor.toLowerCase())
      if (si === -1) {
        let flatStripped = ''
        const s2f = []
        for (let fi = 0; fi < flat.length; fi++) {
          if (!/\s/.test(flat[fi])) { flatStripped += flat[fi]; s2f.push(fi) }
        }
        const anchorStripped = anchor.replace(/\s/g, '')
        const fullStripped = searchText.replace(/\s/g, '').slice(0, 200)
        const si2 = flatStripped.toLowerCase().indexOf(anchorStripped.toLowerCase())
        if (si2 === -1) return null
        const flatStart2 = s2f[si2]
        const flatEnd2 = s2f[Math.min(si2 + fullStripped.length - 1, s2f.length - 1)]
        if (flatStart2 === undefined || flatEnd2 === undefined) return null
        const s2 = src[flatStart2]
        const e2 = src[flatEnd2]
        if (!s2 || !e2) return null
        try {
          const range = document.createRange()
          range.setStart(s2.node, s2.offset)
          range.setEnd(e2.node, Math.min(e2.offset + 1, e2.node.textContent.length))
          return range
        } catch { return null }
      }

      const fullNorm = dehyphenated.replace(/\s+/g, ' ').trim()
      const ei = si + Math.min(fullNorm.length, norm.length - si)
      const flatStart = n2f[si]
      const flatEnd = n2f[Math.min(ei - 1, n2f.length - 1)]
      if (flatStart === undefined || flatEnd === undefined) return null
      const s = src[flatStart]
      const e = src[flatEnd]
      if (!s || !e) return null
      try {
        const range = document.createRange()
        range.setStart(s.node, s.offset)
        range.setEnd(e.node, Math.min(e.offset + 1, e.node.textContent.length))
        return range
      } catch { return null }
    }

    // Try each text layer
    const tls = Array.from(document.querySelectorAll('.textLayer'))
    const results = []
    for (const tl of tls) {
      const spans = tl.querySelectorAll('span')
      if (!spans.length) continue

      const range = findTextRange(tl, searchText)
      if (!range) {
        results.push({ spans: spans.length, rangeFound: false, firstText: spans[0]?.textContent?.slice(0,30) })
        continue
      }

      const rects = range.getClientRects()
      const pageWrapper = tl.closest('.viewer-page-wrapper')
      const wRect = pageWrapper?.getBoundingClientRect()

      const overlayData = []
      for (const rect of rects) {
        if (rect.width < 1 || rect.height < 1) continue
        overlayData.push({
          l: Math.round(rect.left - (wRect?.left || 0)),
          t: Math.round(rect.top - (wRect?.top || 0)),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        })
      }

      results.push({
        spans: spans.length,
        rangeFound: true,
        rectCount: rects.length,
        validRects: overlayData.length,
        overlayPositions: overlayData.slice(0, 3),
        wrapperPos: pageWrapper ? getComputedStyle(pageWrapper).position : null,
      })
    }
    return results
  }, searchText)
  console.log('\nManual overlay test:', JSON.stringify(manualOverlayTest, null, 2))

  // Click the index entry for flash test
  console.log('\n── Clicking index entry for flash ──')
  const indexEntry = await page.$('.idx-entry-text')
  if (indexEntry) {
    await indexEntry.click()
    await page.waitForTimeout(3000)
    const flashCount = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay.pdf-hl-flash').length)
    const lensCount = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay.pdf-hl-lens').length)
    const totalCount = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay').length)
    console.log(`After flash click: flash=${flashCount} lens=${lensCount} total=${totalCount}`)
  }

  console.log('\n── App logs ──')
  logs.forEach(l => console.log(l))

  await browser.close()
})()
