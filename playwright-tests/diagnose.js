/**
 * Diagnostic script — opens the app, clicks a PDF, enables lens,
 * clicks a passage in the index, and reports:
 *   1. Whether overlay divs are created in the DOM
 *   2. Whether findTextRange returns a range (via console intercept)
 *   3. Exact console.log / error output from the highlight path
 *   4. The DOM structure of viewer-page-wrapper
 */
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx    = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const page   = await ctx.newPage()

  // Capture all console messages from the app
  const logs = []
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', err => logs.push(`[PAGE ERROR] ${err.message}`))

  console.log('── Opening app ──')
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })

  // ── Step 1: pick the first PDF in the library ──────────────────────────────
  const pdfItem = page.locator('.pdf-item, .library-item, [data-testid="pdf-item"]').first()
  const pdfCount = await pdfItem.count()
  console.log(`PDF items found: ${pdfCount}`)

  if (pdfCount === 0) {
    // Try clicking any element that looks like a PDF title
    const titles = await page.locator('text=/\.pdf/i').all()
    console.log(`PDF title links found: ${titles.length}`)
    if (titles.length) await titles[0].click()
  } else {
    await pdfItem.click()
  }

  // Wait for viewer to load something
  await page.waitForTimeout(3000)

  // ── Step 2: Check what tabs/panels exist ──────────────────────────────────
  const indexTab = page.locator('text=Index, button:has-text("Index"), [aria-label="Index"]').first()
  const indexCount = await indexTab.count()
  console.log(`Index tab found: ${indexCount}`)
  if (indexCount) await indexTab.click()

  await page.waitForTimeout(1000)

  // ── Step 3: Check if highlight entries exist in the DOM ───────────────────
  const entries = await page.locator('.idx-entry-text, .idx-entry-text-wrap button').all()
  console.log(`Highlight entry text buttons found: ${entries.length}`)

  if (entries.length === 0) {
    console.log('No highlight entries — checking DOM structure:')
    const indexHtml = await page.locator('.highlight-index').first().innerHTML().catch(() => 'NOT FOUND')
    console.log(indexHtml.slice(0, 500))
  }

  // ── Step 4: Enable lens button if present ─────────────────────────────────
  const lensBtn = page.locator('.viewer-lens-btn').first()
  const lensBtnCount = await lensBtn.count()
  console.log(`Lens button found: ${lensBtnCount}`)
  if (lensBtnCount) {
    const isActive = await lensBtn.evaluate(el => el.classList.contains('active'))
    console.log(`Lens currently active: ${isActive}`)
    if (!isActive) await lensBtn.click()
    await page.waitForTimeout(500)
  }

  // ── Step 5: Check for overlay divs after lens enable ─────────────────────
  const overlays = await page.locator('.pdf-hl-overlay').all()
  console.log(`Overlay divs after lens enable: ${overlays.length}`)

  // ── Step 6: Click first passage text and check for flash overlay ──────────
  if (entries.length > 0) {
    console.log('── Clicking first passage entry ──')
    await entries[0].click()
    await page.waitForTimeout(1000)

    const flashOverlays = await page.locator('.pdf-hl-overlay.pdf-hl-flash').all()
    console.log(`Flash overlay divs after click: ${flashOverlays.length}`)

    const allOverlays = await page.locator('.pdf-hl-overlay').all()
    console.log(`Total overlay divs after click: ${allOverlays.length}`)

    // Check page wrapper has position:relative
    const wrapperPos = await page.locator('.viewer-page-wrapper').first().evaluate(el => {
      const s = getComputedStyle(el)
      return `position:${s.position}, width:${el.offsetWidth}, height:${el.offsetHeight}`
    }).catch(() => 'NOT FOUND')
    console.log(`Page wrapper computed style: ${wrapperPos}`)

    // Check text layer exists and has text nodes
    const textLayerInfo = await page.locator('.textLayer').first().evaluate(el => {
      const spans = el.querySelectorAll('span')
      const text = Array.from(spans).map(s => s.textContent).join('').slice(0, 100)
      return `spans:${spans.length}, text:${JSON.stringify(text)}`
    }).catch(() => 'NOT FOUND')
    console.log(`Text layer: ${textLayerInfo}`)
  }

  // ── Step 7: Inject diagnostic code to test findTextRange directly ─────────
  console.log('── Running in-browser diagnostic ──')
  const diagResult = await page.evaluate(() => {
    // Find the first text layer
    const textLayer = document.querySelector('.textLayer')
    if (!textLayer) return { error: 'No text layer found' }

    const pageWrapper = document.querySelector('.viewer-page-wrapper')
    if (!pageWrapper) return { error: 'No page wrapper found' }

    const wrapperRect = pageWrapper.getBoundingClientRect()
    const spans = textLayer.querySelectorAll('span')
    const firstText = spans[0]?.textContent || ''
    const allText = Array.from(spans).map(s => s.textContent).join('').slice(0, 200)

    // Try creating a range for the first few words
    const firstSpan = spans[0]
    let rangeTest = null
    if (firstSpan && firstSpan.firstChild) {
      try {
        const r = document.createRange()
        r.setStart(firstSpan.firstChild, 0)
        r.setEnd(firstSpan.firstChild, Math.min(5, firstSpan.firstChild.length))
        const rects = r.getClientRects()
        rangeTest = { rects: rects.length, firstRect: rects[0] ? `${rects[0].left},${rects[0].top},${rects[0].width},${rects[0].height}` : null }
      } catch(e) { rangeTest = { error: e.message } }
    }

    return {
      textLayerSpans: spans.length,
      firstSpanText: firstText.slice(0, 50),
      allText: allText,
      wrapperRect: `left:${wrapperRect.left},top:${wrapperRect.top},w:${wrapperRect.width},h:${wrapperRect.height}`,
      wrapperPosition: getComputedStyle(pageWrapper).position,
      existingOverlays: document.querySelectorAll('.pdf-hl-overlay').length,
      rangeTest,
    }
  })
  console.log('In-browser diagnostic:', JSON.stringify(diagResult, null, 2))

  // ── Print all captured logs ───────────────────────────────────────────────
  console.log('\n── App console output ──')
  logs.forEach(l => console.log(l))

  await browser.close()
})()
