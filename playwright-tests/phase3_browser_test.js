const { chromium } = require('playwright')
const fs = require('fs')

const SCREENSHOTS = '/Users/neeravch/Desktop/pdf-workspace/playwright-tests/screenshots'
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  console.log('=== Phase 3 Browser Test ===\n')

  // ── Open PDF ──────────────────────────────────────────────────────────────
  const pdfItems = await page.locator('.pdf-item').count()
  if (!pdfItems) { console.log('No PDFs loaded'); await browser.close(); return }
  await page.locator('.pdf-item').first().click()
  await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
  await page.waitForTimeout(2000)
  console.log('PDF opened\n')

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 12 — No copy button yet (no messages). Send a message first.
  // ─────────────────────────────────────────────────────────────────────────
  const chatInput = page.locator('.chat-input')
  await chatInput.fill('hi')          // 1-word query → triggers quick mode
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  try { await page.waitForSelector('.message-bubble.typing', { timeout: 6000 }) } catch {}
  console.log('Waiting for quick-mode response...')
  await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 30000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SCREENSHOTS}/p3_01_quick_response.png` })

  // Quick mode: check that response exists and is SHORT (no "→ Questions worth sitting with")
  const assistantMsgs = await page.locator('.message-assistant .message-bubble').allTextContents()
  const lastResp = assistantMsgs[assistantMsgs.length - 1] || ''
  const hasDeepDive = lastResp.includes('Questions worth sitting with')
  console.log(`Fix 16 - Quick mode response (< 8 word query): ${assistantMsgs.length > 0 ? 'RESPONSE RECEIVED ✓' : 'FAIL ✗'}`)
  console.log(`Fix 16 - No deep-dive prompts in quick response: ${!hasDeepDive ? 'PASS ✓' : 'FAIL ✗ (full template used)'}`)
  console.log(`  Response length: ${lastResp.length} chars`)

  // Dismiss log prompt if present
  const logBanner = await page.locator('.log-prompt').isVisible().catch(() => false)
  if (logBanner) { await page.locator('.log-prompt-skip').click(); await page.waitForTimeout(300) }

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 12 — Copy button on assistant message
  // ─────────────────────────────────────────────────────────────────────────
  const assistantMsg = page.locator('.message-assistant').first()
  await assistantMsg.hover()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SCREENSHOTS}/p3_02_copy_hover.png` })

  const copyBtn = assistantMsg.locator('.message-copy-btn')
  const copyBtnVisible = await copyBtn.isVisible().catch(() => false)
  console.log(`\nFix 12 - Copy button visible on hover: ${copyBtnVisible ? 'PASS ✓' : 'FAIL ✗'}`)

  if (copyBtnVisible) {
    const copyBtnOpacity = await copyBtn.evaluate(el => window.getComputedStyle(el).opacity)
    console.log(`Fix 12 - Copy button opacity on hover: ${copyBtnOpacity} (expect ~1)`)
    await copyBtn.click()
    await page.waitForTimeout(600)
    const copiedState = await copyBtn.getAttribute('class')
    console.log(`Fix 12 - Copy btn has "copied" class after click: ${copiedState?.includes('copied') ? 'PASS ✓' : 'FAIL ✗'}`)
    await page.screenshot({ path: `${SCREENSHOTS}/p3_03_copy_clicked.png` })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 14 — Message timestamps
  // ─────────────────────────────────────────────────────────────────────────
  const timestamps = await page.locator('.message-time').allTextContents()
  console.log(`\nFix 14 - Timestamps present: ${timestamps.length > 0 ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 14 - Timestamp values: ${JSON.stringify(timestamps)}`)

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 13 — Clear chat button
  // ─────────────────────────────────────────────────────────────────────────
  const clearBtn = page.locator('.chat-clear-btn')
  const clearBtnVisible = await clearBtn.isVisible().catch(() => false)
  console.log(`\nFix 13 - Clear button visible with messages: ${clearBtnVisible ? 'PASS ✓' : 'FAIL ✗'}`)
  await page.screenshot({ path: `${SCREENSHOTS}/p3_04_clear_btn.png` })

  // Test clear (confirm → yes)
  if (clearBtnVisible) {
    page.once('dialog', async (dialog) => {
      console.log(`Fix 13 - Confirm dialog: "${dialog.message()}"`)
      await dialog.accept()
    })
    await clearBtn.click()
    await page.waitForTimeout(600)
    const remainingMsgs = await page.locator('.message').count()
    console.log(`Fix 13 - Messages after clear: ${remainingMsgs} (expect 0)`)
    console.log(`Fix 13 - Clear works: ${remainingMsgs === 0 ? 'PASS ✓' : 'FAIL ✗'}`)
    const clearBtnGone = !(await clearBtn.isVisible().catch(() => false))
    console.log(`Fix 13 - Clear btn hidden when history empty: ${clearBtnGone ? 'PASS ✓' : 'FAIL ✗'}`)
    await page.screenshot({ path: `${SCREENSHOTS}/p3_05_after_clear.png` })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 16 — Full response for longer query (>= 8 words)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Full mode test (>= 8 word query) ---')
  await chatInput.fill('What is the purpose of this medical encyclopedia?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  try { await page.waitForSelector('.message-bubble.typing', { timeout: 6000 }) } catch {}
  console.log('Waiting for full-mode response...')
  await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 35000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SCREENSHOTS}/p3_06_full_response.png` })

  const fullMsgs = await page.locator('.message-assistant .message-bubble').allTextContents()
  const fullResp = fullMsgs[fullMsgs.length - 1] || ''
  const hasDeepDiveFull = fullResp.includes('Questions worth sitting with')
  console.log(`Fix 16 - Full response has deep-dive prompts: ${hasDeepDiveFull ? 'PASS ✓' : 'FAIL ✗ (quick mode used for long query)'}`)
  console.log(`  Response length: ${fullResp.length} chars`)

  // ─────────────────────────────────────────────────────────────────────────
  // Fix 15 — sel-menu flip guard (y < 120 → flips below selection)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- sel-menu top flip ---')
  const flipGuard = await page.evaluate(() => {
    const src = document.querySelector('script[src*="SelectionMenu"]')
    // Check the source file directly
    return true // We'll verify via code inspection
  })
  const menuSrc = fs.readFileSync('/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/SelectionMenu.jsx', 'utf8')
  const hasFlipGuard = menuSrc.includes('position.y < 120')
  console.log(`Fix 15 - Top flip guard (y < 120): ${hasFlipGuard ? 'PASS ✓' : 'FAIL ✗'}`)

  // ─────────────────────────────────────────────────────────────────────────
  // CSS checks for copy/clear/timestamp
  // ─────────────────────────────────────────────────────────────────────────
  const css = fs.readFileSync('/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/ChatPanel.css', 'utf8')
  console.log(`\nCSS - .message-copy-btn defined: ${css.includes('.message-copy-btn') ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`CSS - .chat-clear-btn defined:   ${css.includes('.chat-clear-btn') ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`CSS - .message-time defined:     ${css.includes('.message-time') ? 'PASS ✓' : 'FAIL ✗'}`)

  await page.screenshot({ path: `${SCREENSHOTS}/p3_07_final.png` })
  console.log('\n=== Done. Screenshots in playwright-tests/screenshots/ ===')
  await browser.close()
})()
