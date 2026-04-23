const { chromium } = require('playwright')
const fs = require('fs')

const SCREENSHOTS = '/Users/neeravch/Desktop/pdf-workspace/playwright-tests/screenshots'

;(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // Open PDF
  await page.locator('.pdf-item').first().click()
  await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
  await page.waitForTimeout(2000)

  // Helper: clip screenshot to just the chat panel
  const chatClip = async () => {
    const box = await page.locator('.chat-panel').boundingBox()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  // ── 1. QUICK MODE: send a 1-word query ───────────────────────────────────
  await page.locator('.chat-input').fill('hi')
  await page.keyboard.press('Enter')
  try { await page.waitForSelector('.message-bubble.typing', { timeout: 5000 }) } catch {}
  await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 30000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SCREENSHOTS}/p3v_01_quick_mode.png`, clip: await chatClip() })
  console.log('Screenshot 1: quick mode response')

  // Dismiss log banner if visible
  if (await page.locator('.log-prompt').isVisible().catch(() => false)) {
    await page.locator('.log-prompt-skip').click()
    await page.waitForTimeout(300)
  }

  // ── 2. COPY BUTTON: hover over assistant message ─────────────────────────
  const assistantMsg = page.locator('.message-assistant').first()
  await assistantMsg.hover()
  await page.waitForTimeout(500)  // let CSS transition finish
  await page.screenshot({ path: `${SCREENSHOTS}/p3v_02_copy_hover.png`, clip: await chatClip() })
  console.log('Screenshot 2: copy button on hover')

  // Click copy
  await page.locator('.message-copy-btn').first().click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SCREENSHOTS}/p3v_03_copy_clicked.png`, clip: await chatClip() })
  console.log('Screenshot 3: copy clicked (✓ state)')

  // Move mouse away to reset hover
  await page.mouse.move(300, 400)
  await page.waitForTimeout(300)

  // ── 3. TIMESTAMPS visible ────────────────────────────────────────────────
  await page.screenshot({ path: `${SCREENSHOTS}/p3v_04_timestamps.png`, clip: await chatClip() })
  console.log('Screenshot 4: timestamps')

  // ── 4. CLEAR BUTTON visible in header ────────────────────────────────────
  const headerBox = await page.locator('.chat-header').boundingBox()
  await page.screenshot({ path: `${SCREENSHOTS}/p3v_05_clear_btn.png`, clip: headerBox })
  console.log('Screenshot 5: clear button in header')

  // ── 5. FULL MODE: send a long query, show deep-dive prompts ──────────────
  // First clear history
  page.once('dialog', d => d.accept())
  await page.locator('.chat-clear-btn').click()
  await page.waitForTimeout(400)

  await page.locator('.chat-input').fill('What are the main topics covered in this medical encyclopedia?')
  await page.keyboard.press('Enter')
  try { await page.waitForSelector('.message-bubble.typing', { timeout: 5000 }) } catch {}
  console.log('Waiting for full-mode response...')
  await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 35000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SCREENSHOTS}/p3v_06_full_mode.png`, clip: await chatClip() })
  console.log('Screenshot 6: full mode with deep-dive prompts')

  // Scroll to bottom of chat messages to show deep dive prompts
  await page.evaluate(() => {
    const msgs = document.querySelector('.chat-messages')
    if (msgs) msgs.scrollTop = msgs.scrollHeight
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SCREENSHOTS}/p3v_07_full_mode_bottom.png`, clip: await chatClip() })
  console.log('Screenshot 7: full mode scrolled to bottom')

  // ── 6. SEL-MENU: trigger near top of page to test flip ───────────────────
  await page.locator('.viewer-canvas-wrap').evaluate(el => { el.scrollTop = 0 })
  await page.waitForTimeout(300)

  await page.evaluate((offset) => {
    const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
    if (spans.length < offset + 4) return
    const range = document.createRange()
    range.setStart(spans[offset], 0)
    range.setEnd(spans[offset + 3], spans[offset + 3].childNodes.length || 0)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    const canvasWrap = document.querySelector('.viewer-canvas-wrap')
    const rect = canvasWrap.getBoundingClientRect()
    // Fire mouseup near top — Y=80, should trigger flip guard
    canvasWrap.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, clientX: rect.x + rect.width * 0.5, clientY: rect.y + 60
    }))
  }, 5)
  await page.waitForTimeout(700)

  const menuVisible = await page.locator('.sel-menu').isVisible().catch(() => false)
  if (menuVisible) {
    // Check if menu is BELOW the selection point (flipped)
    const menuBox = await page.locator('.sel-menu').boundingBox()
    console.log(`\nSel-menu at Y=${menuBox.y.toFixed(0)} when selection at Y≈${(await page.locator('.viewer-canvas-wrap').boundingBox()).y.toFixed(0)+60}`)
    const viewerBox = await page.locator('.viewer-canvas-wrap').boundingBox()
    const selectionY = viewerBox.y + 60
    const isBelow = menuBox.y > selectionY
    console.log(`Fix 15 - Menu flipped below selection at top: ${isBelow ? 'PASS ✓' : 'FAIL ✗'}`)
    await page.screenshot({ path: `${SCREENSHOTS}/p3v_08_menu_flip.png` })
    console.log('Screenshot 8: sel-menu flipped below top selection')
  } else {
    console.log('Sel-menu did not appear for flip test')
  }

  console.log('\nAll visual checks done.')
  await browser.close()
})()
