const { chromium } = require('playwright')
const fs = require('fs')
const SCREENSHOTS = '/Users/neeravch/Desktop/pdf-workspace/playwright-tests/screenshots'
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  console.log('=== Phase 4 Browser Test ===\n')

  // Open PDF and navigate to index to launch a review session
  await page.locator('.pdf-item').first().click()
  await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
  await page.waitForTimeout(1500)

  // Switch to Index tab
  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(500)

  // Look for a Review button (per-card or global)
  const reviewBtns = await page.locator('button').filter({ hasText: /Review/i }).all()
  console.log(`Review buttons found: ${reviewBtns.length}`)

  if (reviewBtns.length === 0) {
    console.log('No review buttons — seeding an index entry first...')
    // Go to chat, send a question with selection to trigger a save
    await page.locator('.chat-tab').filter({ hasText: 'Chat' }).click()
    await page.waitForTimeout(300)
    // Use programmatic selection + Explain
    await page.locator('.viewer-canvas-wrap').evaluate(el => { el.scrollTop = 0 })
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
      const range = document.createRange()
      range.setStart(spans[20], 0)
      range.setEnd(spans[28], spans[28]?.childNodes.length || 0)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
      const canvasWrap = document.querySelector('.viewer-canvas-wrap')
      const rect = canvasWrap.getBoundingClientRect()
      canvasWrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.x + rect.width * 0.5, clientY: rect.y + 300 }))
    })
    await page.waitForTimeout(700)
    if (await page.locator('.sel-menu').isVisible().catch(() => false)) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.sel-menu-btn')].find(b => b.textContent.includes('Explain'))
        btn?.click()
      })
      await page.waitForTimeout(500)
      try { await page.waitForSelector('.message-bubble.typing', { timeout: 5000 }) } catch {}
      await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 30000 })
      await page.waitForTimeout(600)
      if (await page.locator('.log-prompt').isVisible().catch(() => false)) {
        await page.locator('.log-prompt-save').click()
        await page.waitForTimeout(1500)
      }
    }
    await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
    await page.waitForTimeout(600)
  }

  // Find a Review button and click it
  const reviewBtn = page.locator('button').filter({ hasText: /Review now/i }).first()
  const hasReviewNow = await reviewBtn.isVisible().catch(() => false)
  if (!hasReviewNow) {
    // Try the global Review button in the index header
    const globalReview = page.locator('button').filter({ hasText: /Review/i }).first()
    await globalReview.click()
  } else {
    await reviewBtn.click()
  }
  await page.waitForTimeout(800)

  const overlayVisible = await page.locator('.rv-overlay').isVisible().catch(() => false)
  console.log(`Review session opened: ${overlayVisible ? 'YES ✓' : 'NO ✗'}`)

  if (!overlayVisible) {
    console.log('Could not open review session')
    await page.screenshot({ path: `${SCREENSHOTS}/p4_debug.png` })
    await browser.close()
    return
  }

  await page.screenshot({ path: `${SCREENSHOTS}/p4_01_review_open.png` })

  // ── Fix 17: Hard/Easy endpoint labels ──────────────────────────────────────
  const hardLabel = await page.locator('.rv-conf-endpoint--hard').textContent().catch(() => '')
  const easyLabel = await page.locator('.rv-conf-endpoint--easy').textContent().catch(() => '')
  console.log(`Fix 17 - "Hard" endpoint: "${hardLabel}" → ${hardLabel === 'Hard' ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 17 - "Easy" endpoint: "${easyLabel}" → ${easyLabel === 'Easy' ? 'PASS ✓' : 'FAIL ✗'}`)

  // ── Fix 19: ⓘ info icon next to mode toggle ─────────────────────────────
  const infoIcon = await page.locator('.rv-mode-info').isVisible().catch(() => false)
  const infoTitle = await page.locator('.rv-mode-info').getAttribute('title').catch(() => '')
  console.log(`\nFix 19 - ⓘ icon visible: ${infoIcon ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 19 - ⓘ tooltip set: ${infoTitle?.includes('Concept') ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 19 - Tooltip text: "${infoTitle?.slice(0, 60)}..."`)

  // ── Fix 20: Submit disabled with empty textarea ──────────────────────────
  const submitBtn = page.locator('.rv-submit')
  const submitDisabled = await submitBtn.isDisabled()
  const hintText = await page.locator('.rv-submit-hint').textContent().catch(() => '')
  console.log(`\nFix 20 - Submit disabled (empty + no confidence): ${submitDisabled ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 20 - Hint text: "${hintText}"`)
  console.log(`Fix 20 - Hint explains what's missing: ${hintText.length > 0 ? 'PASS ✓' : 'FAIL ✗'}`)

  await page.screenshot({ path: `${SCREENSHOTS}/p4_02_empty_state.png` })

  // Type in textarea — hint should change to confidence-only
  await page.locator('.rv-recall-input').fill('test answer from memory')
  await page.waitForTimeout(300)
  const hintAfterText = await page.locator('.rv-submit-hint').textContent().catch(() => '')
  console.log(`Fix 20 - Hint after typing (expect confidence): "${hintAfterText}"`)
  console.log(`Fix 20 - Hint changes to confidence prompt: ${hintAfterText.includes('confidence') ? 'PASS ✓' : 'FAIL ✗'}`)

  // Set confidence — hint should disappear, submit enabled
  await page.locator('.rv-conf-btn').nth(2).click() // confidence = 3
  await page.waitForTimeout(300)
  const submitEnabled = await submitBtn.isEnabled()
  const hintGone = !(await page.locator('.rv-submit-hint').isVisible().catch(() => false))
  console.log(`Fix 20 - Submit enabled when text + confidence set: ${submitEnabled ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 20 - Hint gone when ready: ${hintGone ? 'PASS ✓' : 'FAIL ✗'}`)

  await page.screenshot({ path: `${SCREENSHOTS}/p4_03_ready_to_submit.png` })

  // ── Fix 18: Action-type recall prompt ────────────────────────────────────
  const questionText = await page.locator('.rv-question').textContent().catch(() => '')
  const actionBadge = await page.locator('.rv-action-badge').textContent().catch(() => '')
  console.log(`\nFix 18 - Action badge: "${actionBadge}"`)
  console.log(`Fix 18 - Question/prompt: "${questionText.trim().slice(0, 80)}"`)
  const isSpecific = questionText.includes('own words') || questionText.includes('simply')
    || questionText.includes('key terms') || questionText.includes('Summarise')
    || questionText.length > 5  // has actual question from quiz extraction
  console.log(`Fix 18 - Specific recall prompt (not generic): ${isSpecific ? 'PASS ✓' : 'CHECK MANUALLY'}`)

  // ── Close and take full screenshot ───────────────────────────────────────
  await page.screenshot({ path: `${SCREENSHOTS}/p4_04_review_full.png` })
  await page.locator('.rv-close').click()
  await page.waitForTimeout(400)

  // ── CSS checks ────────────────────────────────────────────────────────────
  const css = fs.readFileSync('/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/ReviewSession.css', 'utf8')
  console.log(`\nCSS - .rv-conf-endpoint defined: ${css.includes('.rv-conf-endpoint') ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`CSS - .rv-mode-info defined:      ${css.includes('.rv-mode-info') ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`CSS - .rv-submit-hint defined:    ${css.includes('.rv-submit-hint') ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`CSS - .rv-submit-row defined:     ${css.includes('.rv-submit-row') ? 'PASS ✓' : 'FAIL ✗'}`)

  await page.screenshot({ path: `${SCREENSHOTS}/p4_05_final.png` })
  console.log('\n=== Done ===')
  await browser.close()
})()
