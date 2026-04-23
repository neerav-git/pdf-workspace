/**
 * User-perspective exploration script.
 * Simulates a real user session and reports every issue found.
 * Run this to audit the app before making any fixes.
 */
const { chromium } = require('playwright')

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

;(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 })  // visible browser
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

  const issues = []
  function report(severity, area, description, detail = '') {
    const msg = `[${severity}] ${area}: ${description}${detail ? ' — ' + detail : ''}`
    issues.push(msg)
    console.log(msg)
  }

  const logs = []
  page.on('console', m => { if (!['vite','DevTools','React'].some(s => m.text().includes(s))) logs.push(m.text()) })
  page.on('pageerror', e => logs.push('[PAGE ERR] ' + e.message))

  // ── 1. Load app ──────────────────────────────────────────────────────────────
  console.log('\n=== PHASE 1: App load ===')
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  const pdfCount = await page.locator('.pdf-item').count()
  console.log(`PDFs in library: ${pdfCount}`)

  // ── 2. Open PDF ──────────────────────────────────────────────────────────────
  console.log('\n=== PHASE 2: Open PDF ===')
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await sleep(1500)
  console.log('PDF opened')

  // ── 3. Index panel ───────────────────────────────────────────────────────────
  console.log('\n=== PHASE 3: Index panel ===')
  await page.click('button.chat-tab:last-child')
  await sleep(500)

  const indexEntries = await page.locator('.idx-entry-text').count()
  console.log(`Index entry text buttons: ${indexEntries}`)
  if (indexEntries === 0) report('CRITICAL', 'Index', 'No entry text buttons visible')

  // Check concepts display
  const conceptChips = await page.locator('.idx-concept-chip, .idx-chip, [class*="concept"]').count()
  console.log(`Concept chips visible: ${conceptChips}`)

  // Check synthesis section
  const synthSection = await page.locator('.idx-synthesis-block, .idx-synthesis-wrap').count()
  console.log(`Synthesis sections: ${synthSection}`)

  // Screenshot the index panel
  await page.screenshot({ path: '/tmp/index_panel.png', fullPage: false })
  console.log('Screenshot saved: /tmp/index_panel.png')

  // Inspect each passage text button
  const entryTexts = await page.locator('.idx-entry-text').all()
  for (let i = 0; i < entryTexts.length; i++) {
    const text = await entryTexts[i].textContent()
    const title = await entryTexts[i].getAttribute('title')
    console.log(`  Entry [${i}]: "${text?.slice(0,50)}" title="${title}"`)
  }

  // ── 4. Check passage navigation ───────────────────────────────────────────
  console.log('\n=== PHASE 4: Passage navigation ===')

  // Navigate to page 7 first so highlights can render
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await sleep(200)
  const navInput = await page.$('.viewer-page-input')
  if (navInput) {
    await navInput.click({ clickCount: 3 })
    await navInput.fill('7')
    await navInput.press('Enter')
    await sleep(2000)
  }

  // Enable lens
  const lensBtn = await page.$('.viewer-lens-btn')
  if (lensBtn) {
    await lensBtn.click()
    await sleep(1000)
  }

  const lensOverlays = await page.locator('.pdf-hl-overlay.pdf-hl-lens').count()
  console.log(`Lens overlays on page 7: ${lensOverlays}`)
  if (lensOverlays === 0) report('HIGH', 'Lens', 'No lens overlays visible on page 7')

  // Get overlay colors
  const overlayColors = await page.evaluate(() => {
    const overlays = document.querySelectorAll('.pdf-hl-overlay')
    return Array.from(new Set(Array.from(overlays).map(el => {
      const s = getComputedStyle(el)
      return `${el.className.split(' ').slice(1).join('.')}: bg=${s.backgroundColor}`
    })))
  })
  console.log('Overlay colors:', overlayColors)

  // ── 5. Click each passage entry ────────────────────────────────────────────
  console.log('\n=== PHASE 5: Passage click behavior ===')
  const entries = await page.locator('.idx-entry-text').all()
  for (let i = 0; i < entries.length; i++) {
    const beforePage = await page.evaluate(() => {
      const pi = document.querySelector('.viewer-page-info')
      return pi?.textContent
    })

    await entries[i].click()
    await sleep(1500)

    const afterPage = await page.evaluate(() => {
      const pi = document.querySelector('.viewer-page-info')
      return pi?.textContent
    })
    const flashCount = await page.locator('.pdf-hl-overlay.pdf-hl-flash').count()
    const text = await entries[i].textContent()
    console.log(`  Click [${i}] "${text?.slice(0,40)}": page ${beforePage}→${afterPage}, flash=${flashCount}`)
    if (flashCount === 0) {
      report('HIGH', 'Flash', `Entry [${i}] click: no flash overlay created`, `text: "${text?.slice(0,40)}"`)
    }
    await sleep(500)
  }

  // ── 6. Visual inspection of flash vs lens colors ───────────────────────────
  console.log('\n=== PHASE 6: Color differentiation ===')
  // Click first entry to get a flash
  if (entries.length > 0) {
    await entries[0].click()
    await sleep(500)

    const colorInfo = await page.evaluate(() => {
      const lens = document.querySelector('.pdf-hl-overlay.pdf-hl-lens')
      const flash = document.querySelector('.pdf-hl-overlay.pdf-hl-flash')
      return {
        lensColor: lens ? getComputedStyle(lens).backgroundColor : null,
        flashColor: flash ? getComputedStyle(flash).backgroundColor : null,
        lensOpacity: lens ? getComputedStyle(lens).opacity : null,
        flashOpacity: flash ? getComputedStyle(flash).opacity : null,
      }
    })
    console.log('Color comparison:', JSON.stringify(colorInfo, null, 2))
    if (colorInfo.lensColor === colorInfo.flashColor) {
      report('MEDIUM', 'Colors', 'Flash and lens overlays have identical background colors — hard to distinguish')
    }
  }

  // ── 7. Index readability audit ─────────────────────────────────────────────
  console.log('\n=== PHASE 7: Index readability audit ===')
  const readabilityAudit = await page.evaluate(() => {
    const results = []

    // Check each text element's contrast
    const checks = [
      { sel: '.idx-entry-text', name: 'Passage text button' },
      { sel: '.idx-concept-chip, [class*="concept"]', name: 'Concept chips' },
      { sel: '.idx-synthesis-text', name: 'Synthesis text' },
      { sel: '.idx-qa-q, .idx-qa-question', name: 'Q&A question' },
      { sel: '.idx-qa-a, .idx-qa-answer', name: 'Q&A answer' },
      { sel: '.idx-entry-meta', name: 'Entry metadata' },
      { sel: '.idx-section-title', name: 'Section title' },
      { sel: '.idx-page-num', name: 'Page number' },
    ]

    for (const { sel, name } of checks) {
      const el = document.querySelector(sel)
      if (!el) { results.push(`${name}: NOT FOUND`); continue }
      const s = getComputedStyle(el)
      results.push(`${name}: color=${s.color} bg=${s.backgroundColor} size=${s.fontSize}`)
    }

    // Check overall index height/overflow
    const indexContainer = document.querySelector('.highlight-index, .chat-messages')
    if (indexContainer) {
      const s = getComputedStyle(indexContainer)
      results.push(`Index container: overflow=${s.overflow} overflowY=${s.overflowY} height=${indexContainer.offsetHeight}`)
    }

    return results
  })
  readabilityAudit.forEach(r => console.log('  ', r))

  // ── 8. Review session check ────────────────────────────────────────────────
  console.log('\n=== PHASE 8: Review button ===')
  const reviewBtn = await page.locator('.idx-review-btn, button:has-text("Review"), [class*="review"]').first()
  const reviewBtnCount = await reviewBtn.count()
  console.log(`Review button found: ${reviewBtnCount}`)

  // ── 9. Scroll behavior in index ────────────────────────────────────────────
  console.log('\n=== PHASE 9: Index scroll ===')
  const indexHeight = await page.evaluate(() => {
    const idx = document.querySelector('.highlight-index')
    if (!idx) return null
    return { scrollHeight: idx.scrollHeight, clientHeight: idx.clientHeight, overflow: getComputedStyle(idx).overflowY }
  })
  console.log('Index scroll info:', JSON.stringify(indexHeight))

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n=== ISSUES FOUND ===')
  if (issues.length === 0) {
    console.log('No critical issues detected by automated checks.')
  } else {
    issues.forEach((issue, i) => console.log(`${i+1}. ${issue}`))
  }

  console.log('\n=== CONSOLE ERRORS ===')
  logs.filter(l => l.includes('ERR') || l.includes('error') || l.includes('Error')).forEach(l => console.log(l))

  // Keep browser open for 3 seconds for visual inspection
  await sleep(3000)
  await browser.close()
})()
