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

  console.log('=== Phase 2 Browser Test ===\n')

  const pdfItems = await page.locator('.pdf-item').count()
  if (pdfItems === 0) { console.log('No PDFs'); await browser.close(); return }
  await page.locator('.pdf-item').first().click()
  await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
  await page.waitForTimeout(2000)
  console.log('PDF rendered')

  // ── Trigger menu: select text programmatically, fire mouseup at fixed screen pos ──
  async function triggerMenu(spanOffset = 30) {
    // First scroll so the text spans we target are near the top of the visible area
    await page.locator('.viewer-canvas-wrap').evaluate((el) => { el.scrollTop = 0 })
    await page.waitForTimeout(300)

    const menuX = await page.evaluate((offset) => {
      const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
      if (spans.length < offset + 6) return null
      const range = document.createRange()
      range.setStart(spans[offset], 0)
      range.setEnd(spans[offset + 5], spans[offset + 5].childNodes.length || 0)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)

      // Fire mouseup at a fixed location near top-center of the viewer
      const canvasWrap = document.querySelector('.viewer-canvas-wrap')
      const rect = canvasWrap.getBoundingClientRect()
      // Use Y=300 (roughly middle of first page in viewport) so menu appears on-screen
      const fireY = Math.min(rect.y + 300, window.innerHeight - 200)
      const fireX = rect.x + rect.width * 0.5
      canvasWrap.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, clientX: fireX, clientY: fireY
      }))
      return fireX
    }, spanOffset)

    await page.waitForTimeout(700)
    return page.locator('.sel-menu').isVisible().catch(() => false)
  }

  const appeared = await triggerMenu(30)
  console.log(`Selection menu visible: ${appeared ? 'YES ✓' : 'NO ✗'}`)
  if (!appeared) {
    await page.screenshot({ path: `${SCREENSHOTS}/p2_debug.png` })
    await browser.close()
    return
  }
  await page.screenshot({ path: `${SCREENSHOTS}/p2_04_menu_open.png` })

  // ── A) Label checks ────────────────────────────────────────────────────────
  const btns = await page.locator('.sel-menu-btn-label').allTextContents()
  console.log('\nMenu labels:', btns)
  console.log(`Fix 1  - "Note only":           ${btns.some(t => t.trim() === 'Note only')   ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 1b - "Save note" absent:    ${!btns.some(t => t.trim() === 'Save note')  ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 2  - "Add to Index":         ${btns.some(t => t.includes('Add to Index') || t.includes('Index ·')) ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 2b - "Index (empty)" absent: ${!btns.some(t => t.includes('Index (empty)')) ? 'PASS ✓' : 'FAIL ✗'}`)
  const tooltip = await page.locator('.sel-menu-btn').filter({ hasText: 'Note only' }).getAttribute('title').catch(() => '')
  console.log(`Fix 1c - Tooltip: "${tooltip}"`)
  console.log(`Fix 1c - Mentions "annotation":  ${tooltip?.includes('annotation') ? 'PASS ✓' : 'FAIL ✗'}`)

  // ── B) Click Explain via JS to bypass viewport restrictions ──────────────
  console.log('\nFiring Explain via JS click...')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sel-menu-btn')]
      .find(b => b.textContent.includes('Explain'))
    if (btn) btn.click()
  })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SCREENSHOTS}/p2_05_explain_sent.png` })

  // Wait for response
  try { await page.waitForSelector('.message-bubble.typing', { timeout: 8000 }) } catch {}
  console.log('Response loading...')
  await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 35000 })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SCREENSHOTS}/p2_06_response_done.png` })

  // ── C) Log-prompt banner ──────────────────────────────────────────────────
  const logVisible = await page.locator('.log-prompt').isVisible().catch(() => false)
  console.log(`\nFix 3  - Log banner visible: ${logVisible ? 'PASS ✓' : 'FAIL ✗'}`)

  if (logVisible) {
    const logBox   = await page.locator('.log-prompt').boundingBox()
    const inputBox = await page.locator('.chat-input-area').boundingBox()
    const msgBox   = await page.locator('.chat-messages').boundingBox()

    console.log(`  Banner  top=${logBox.y.toFixed(0)} bottom=${(logBox.y+logBox.height).toFixed(0)}`)
    console.log(`  Messages bottom=${(msgBox.y+msgBox.height).toFixed(0)}`)
    console.log(`  Input   top=${inputBox.y.toFixed(0)}`)

    const aboveInput    = logBox.y + logBox.height <= inputBox.y + 2
    const belowMessages = logBox.y >= msgBox.y + msgBox.height - 2
    console.log(`Fix 3b - Banner above input bar:      ${aboveInput    ? 'PASS ✓' : 'FAIL ✗'}`)
    console.log(`Fix 3c - Banner outside scroll area:  ${belowMessages ? 'PASS ✓' : 'FAIL ✗'}`)

    await page.screenshot({ path: `${SCREENSHOTS}/p2_07_banner_position.png` })

    // Skip
    await page.locator('.log-prompt-skip').click()
    await page.waitForTimeout(400)
    const gone = !(await page.locator('.log-prompt').isVisible().catch(() => false))
    console.log(`Fix 3d - Skip dismisses banner:       ${gone ? 'PASS ✓' : 'FAIL ✗'}`)
    await page.screenshot({ path: `${SCREENSHOTS}/p2_08_after_skip.png` })
  }

  // ── D) Save to Index path ─────────────────────────────────────────────────
  console.log('\n--- Save to Index path ---')
  const appeared2 = await triggerMenu(50)
  if (appeared2) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.sel-menu-btn')].find(b => b.textContent.includes('Explain'))
      if (btn) btn.click()
    })
    await page.waitForTimeout(600)
    try { await page.waitForSelector('.message-bubble.typing', { timeout: 8000 }) } catch {}
    console.log('Waiting for second response...')
    await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 35000 })
    await page.waitForTimeout(1000)

    const logVisible2 = await page.locator('.log-prompt').isVisible().catch(() => false)
    if (logVisible2) {
      await page.screenshot({ path: `${SCREENSHOTS}/p2_09_save_test.png` })
      await page.locator('.log-prompt-save').click()
      await page.waitForTimeout(2500)
      const saved = !(await page.locator('.log-prompt').isVisible().catch(() => false))
      console.log(`Fix 4  - "Save to Index" clears banner: ${saved ? 'PASS ✓' : 'FAIL ✗'}`)

      const badgeText = await page.locator('.tab-badge').first().textContent().catch(() => '0')
      console.log(`Fix 4b - Index tab badge: "${badgeText}"`)
      console.log(`Fix 4b - Badge > 0: ${parseInt(badgeText) > 0 ? 'PASS ✓' : 'FAIL ✗'}`)
      await page.screenshot({ path: `${SCREENSHOTS}/p2_10_after_save.png` })
    } else {
      console.log('Log banner did not appear for second response')
    }
  }

  await page.screenshot({ path: `${SCREENSHOTS}/p2_11_final.png` })
  console.log('\n=== Done ===')
  await browser.close()
})()
