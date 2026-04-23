const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

  const logs = []
  page.on('console', m => { if (!m.text().includes('vite') && !m.text().includes('DevTools')) logs.push(`[${m.type()}] ${m.text()}`) })
  page.on('pageerror', e => logs.push(`[ERR] ${e.message}`))

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

  // 1. Click the PDF
  await page.click('.pdf-item')
  console.log('Clicked PDF')

  // 2. Wait for viewer to render — wait for canvas or text layer
  try {
    await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
    console.log('Canvas rendered')
  } catch(e) {
    console.log('Canvas not found after 15s')
  }

  // 3. Wait a bit more for text layer
  await page.waitForTimeout(3000)

  // 4. Check text layer
  const tlInfo = await page.evaluate(() => {
    const tls = document.querySelectorAll('.textLayer')
    const results = []
    tls.forEach((tl, i) => {
      const spans = tl.querySelectorAll('span')
      results.push({ index: i, spanCount: spans.length, firstText: spans[0]?.textContent?.slice(0,50) || '' })
    })
    return results
  })
  console.log('Text layers:', JSON.stringify(tlInfo))

  // 5. Click Index tab
  await page.click('button.chat-tab:has-text("Index")')
  console.log('Clicked Index tab')
  await page.waitForTimeout(500)

  // 6. Check index entries
  const entryInfo = await page.evaluate(() => {
    const entries = document.querySelectorAll('.idx-entry-text')
    return { count: entries.length, first: entries[0]?.textContent?.slice(0,60) || '' }
  })
  console.log('Index entries:', JSON.stringify(entryInfo))

  // 7. Enable lens
  const lensBtn = await page.$('.viewer-lens-btn')
  if (lensBtn) {
    await lensBtn.click()
    console.log('Clicked lens button')
    await page.waitForTimeout(1000)
  } else {
    console.log('Lens button NOT FOUND')
  }

  // 8. Check overlays after lens enable
  const overlayCount1 = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay').length)
  console.log(`Overlays after lens: ${overlayCount1}`)

  // 9. Click first index entry (passage text)
  const firstEntry = await page.$('.idx-entry-text')
  if (firstEntry) {
    const entryText = await firstEntry.textContent()
    console.log(`Clicking entry: "${entryText?.slice(0, 50)}"`)
    await firstEntry.click()
    await page.waitForTimeout(2000)

    const flashCount = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay.pdf-hl-flash').length)
    const totalOverlays = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay').length)
    console.log(`Flash overlays: ${flashCount}, total overlays: ${totalOverlays}`)
  } else {
    console.log('No .idx-entry-text found')
  }

  // 10. Deep diagnostic — inject custom findTextRange test
  const deepDiag = await page.evaluate(() => {
    const textLayer = document.querySelector('.textLayer')
    if (!textLayer) return { error: 'no textLayer' }
    const spans = textLayer.querySelectorAll('span')
    if (!spans.length) return { error: 'textLayer has 0 spans' }

    // Get text stored in the highlight index (from store if accessible)
    const allText = Array.from(spans).map(s => s.textContent).join('')

    // Test: create a range from first 3 spans and get rects
    let rangeRectTest = null
    try {
      const r = document.createRange()
      r.setStart(spans[0].firstChild || spans[0], 0)
      const lastSpan = spans[Math.min(2, spans.length-1)]
      r.setEnd(lastSpan.firstChild || lastSpan, (lastSpan.firstChild?.length || 1))
      const rects = r.getClientRects()
      rangeRectTest = {
        rectCount: rects.length,
        firstRect: rects[0] ? { l: Math.round(rects[0].left), t: Math.round(rects[0].top), w: Math.round(rects[0].width), h: Math.round(rects[0].height) } : null
      }
    } catch(e) { rangeRectTest = { error: e.message } }

    // Test: check viewer-page-wrapper position
    const wrapper = document.querySelector('.viewer-page-wrapper')
    const wrapperStyle = wrapper ? {
      position: getComputedStyle(wrapper).position,
      w: wrapper.offsetWidth,
      h: wrapper.offsetHeight,
    } : null

    return {
      spanCount: spans.length,
      textSample: allText.slice(0, 100),
      rangeRectTest,
      wrapperStyle,
      existingOverlays: document.querySelectorAll('.pdf-hl-overlay').length,
    }
  })
  console.log('Deep diagnostic:', JSON.stringify(deepDiag, null, 2))

  console.log('\n── Console logs ──')
  logs.forEach(l => console.log(l))

  await browser.close()
})()
