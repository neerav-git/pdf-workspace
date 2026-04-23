/**
 * test_highlight_popover.js
 * Verify clickable highlight overlays and the HighlightPopover component.
 *
 * The second indexed highlight is on page 7 (has text layer).
 * Navigate there, enable lens, click overlay → verify popover.
 */

const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const BASE = 'http://localhost:5173'
const SS_DIR = path.join(__dirname, 'screenshots')
fs.mkdirSync(SS_DIR, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  const ss = (name) => page.screenshot({ path: path.join(SS_DIR, `hl_pop_${name}.png`), fullPage: false })
  const log = (msg) => console.log(`  ${msg}`)
  const PASS = (msg) => console.log(`  ✓ ${msg}`)
  const FAIL = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1 }

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await ss('01_baseline')

  // ── 1. Select the PDF ──────────────────────────────────────────────────────
  const firstPdf = page.locator('.pdf-item').first()
  if (await firstPdf.count() === 0) {
    FAIL('No PDF in sidebar'); await browser.close(); return
  }
  await firstPdf.click()
  await page.waitForTimeout(2000)

  // ── 2. Check lens button (confirms highlights are loaded) ─────────────────
  try {
    await page.waitForSelector('.viewer-lens-btn', { timeout: 10000 })
    PASS('Lens button visible (indexed entries exist)')
  } catch {
    FAIL('No lens button — no indexed entries for this PDF')
    await browser.close(); return
  }

  // ── 3. Navigate to page 7 (the text-layer highlight page) ─────────────────
  // Wait for PDF to finish loading (totalPages populated)
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('.viewer-page-info')
      return el && !el.textContent.includes('—')
    }, { timeout: 30000 })
    log('PDF fully loaded')
  } catch {
    log('PDF load timeout — trying to navigate anyway')
  }

  await page.evaluate(() => {
    const el = document.querySelector('.viewer-page-info.clickable')
    if (el) el.click()
  })
  await page.waitForTimeout(300)
  const pageInput = page.locator('.viewer-page-input')
  if (await pageInput.count() > 0) {
    await pageInput.fill('7')
    await pageInput.press('Enter')
    await page.waitForTimeout(2500)
    log('Navigated to page 7 via input')
  }

  // Wait for page 7 text layer
  try {
    await page.waitForFunction(() => {
      const w = document.querySelector('[data-page="7"]')
      if (!w) return false
      const spans = w.querySelectorAll('.textLayer span, .react-pdf__Page__textContent span')
      return spans.length > 10
    }, { timeout: 15000 })
    PASS('Page 7 text layer ready')
  } catch {
    FAIL('Page 7 text layer did not render')
    await ss('02_no_text_layer')
    await browser.close(); return
  }

  // ── 4. Enable lens ─────────────────────────────────────────────────────────
  const lensBtn = page.locator('.viewer-lens-btn')
  const isActive = await lensBtn.evaluate((el) => el.classList.contains('active'))
  if (!isActive) {
    await lensBtn.click()
    await page.waitForTimeout(1000)
    log('Lens enabled')
  } else {
    log('Lens already active')
  }
  await ss('02_lens_active')

  // ── 5. Wait for lens overlays on page 7 ───────────────────────────────────
  const overlaySelector = '.pdf-hl-overlay.pdf-hl-lens, .pdf-hl-overlay.pdf-hl-lens-flagged, .pdf-hl-overlay.pdf-hl-lens-anchored, .pdf-hl-overlay.pdf-hl-lens-reviewed'

  let overlayCount = await page.locator(overlaySelector).count()
  if (overlayCount === 0) {
    // Toggle to retrigger applyLensToPage now that text layer exists
    await lensBtn.click(); await page.waitForTimeout(300)
    await lensBtn.click(); await page.waitForTimeout(1000)
    overlayCount = await page.locator(overlaySelector).count()
  }

  if (overlayCount === 0) {
    try {
      await page.waitForSelector(overlaySelector, { timeout: 5000 })
      overlayCount = await page.locator(overlaySelector).count()
    } catch {
      FAIL('No lens overlays appeared on page 7')
      await ss('03_no_overlays')
      await browser.close(); return
    }
  }
  PASS(`Lens overlays rendered: ${overlayCount} divs`)
  await ss('03_overlays')

  // ── 6. Click the first overlay ────────────────────────────────────────────
  const firstOverlay = page.locator(overlaySelector).first()
  await firstOverlay.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await firstOverlay.click({ force: true })
  await page.waitForTimeout(600)
  await ss('04_after_click')

  // ── 7. Verify popover ─────────────────────────────────────────────────────
  const popover = page.locator('.hl-popover')
  // The popover starts visibility:hidden, becomes visible after flip useEffect
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('.hl-popover')
      if (!el) return false
      return getComputedStyle(el).visibility === 'visible'
    }, { timeout: 3000 })
    PASS('hl-popover is visible')
  } catch {
    const count = await popover.count()
    FAIL(`hl-popover visibility failed (count in DOM: ${count})`)
  }

  const excerpt = await page.locator('.hl-popover-excerpt').count()
  if (excerpt > 0) PASS('.hl-popover-excerpt rendered')
  else FAIL('.hl-popover-excerpt missing')

  const indexBtn = await page.locator('.hl-popover-btn--index').count()
  if (indexBtn > 0) PASS('"→ Index" button present')
  else FAIL('"→ Index" button missing')

  const reviewBtn = await page.locator('.hl-popover-btn--review').count()
  if (reviewBtn > 0) {
    PASS('"▶ Review" button present')
  } else {
    log('  ⚪ "▶ Review" absent (entry has no QAs — expected if fresh)')
  }

  const qaCountEl = await page.locator('.hl-popover-qa-count').first()
  if (await qaCountEl.count() > 0) {
    const txt = await qaCountEl.textContent()
    PASS(`.hl-popover-qa-count: "${txt}"`)
  }

  await ss('05_popover_open')

  // ── 8. Close with Escape ──────────────────────────────────────────────────
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const afterEsc = await popover.count()
  if (afterEsc === 0) PASS('Popover closed on Escape')
  else FAIL('Popover still in DOM after Escape')

  await ss('06_after_escape')

  // ── 9. Test "→ Index" click (reopen + click) ──────────────────────────────
  await firstOverlay.click({ force: true })
  await page.waitForTimeout(500)
  await page.waitForFunction(() => {
    const el = document.querySelector('.hl-popover')
    return el && getComputedStyle(el).visibility === 'visible'
  }, { timeout: 3000 }).catch(() => {})

  const indexBtnEl = page.locator('.hl-popover-btn--index').first()
  if (await indexBtnEl.count() > 0) {
    await indexBtnEl.click()
    await page.waitForTimeout(800)
    await ss('07_after_index_click')
    PASS('Clicked "→ Index" — no crash')
  }

  await browser.close()
  console.log('\nDone. Screenshots in screenshots/hl_pop_*.png')
})()
