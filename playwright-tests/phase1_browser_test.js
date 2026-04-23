const { chromium } = require('playwright')
const fs = require('fs')

const SCREENSHOTS = '/Users/neeravch/Desktop/pdf-workspace/playwright-tests/screenshots'
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  console.log('=== Phase 1 Browser Test ===\n')

  // ── Fix 1: Empty state CTA ────────────────────────────────────────────────
  // Before clicking any PDF, check the empty state hint
  const hintText = await page.locator('.viewer-placeholder-hint').textContent().catch(() => '')
  const hintVisible = await page.locator('.viewer-placeholder-hint').isVisible().catch(() => false)
  console.log(`Fix 5 - Empty state hint visible: ${hintVisible ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 5 - Hint text: "${hintText}"`)
  console.log(`Fix 5 - Contains CTA arrow: ${hintText.includes('←') ? 'PASS ✓' : 'FAIL ✗'}`)
  await page.screenshot({ path: `${SCREENSHOTS}/p1_01_empty_state.png` })

  // ── Fix 2: Sidebar — no "chunks" jargon ─────────────────────────────────
  const sidebarText = await page.locator('.pdf-sidebar').textContent().catch(() => '')
  const hasChunks  = sidebarText.includes('chunk')
  const hasPages   = sidebarText.includes('pages')
  console.log(`\nFix 3 - Sidebar has "pages":    ${hasPages   ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 3 - Sidebar no "chunks":    ${!hasChunks  ? 'PASS ✓' : 'FAIL ✗'} ${hasChunks ? '(JARGON STILL PRESENT)' : ''}`)

  // Check the actual meta text
  const metaTexts = await page.locator('.pdf-meta').allTextContents()
  console.log(`Fix 3 - Meta texts: ${JSON.stringify(metaTexts)}`)

  // ── Open PDF ──────────────────────────────────────────────────────────────
  const pdfItems = await page.locator('.pdf-item').count()
  if (pdfItems === 0) { console.log('\nNo PDFs loaded — cannot test further'); await browser.close(); return }

  await page.locator('.pdf-item').first().click()
  await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SCREENSHOTS}/p1_02_pdf_open.png` })
  console.log('\nPDF opened')

  // ── Fix 3: PDF name as breadcrumb (visible on Chat tab) ──────────────────
  const pdfNameEl = page.locator('.chat-pdf-name')
  const pdfNameVisible = await pdfNameEl.isVisible().catch(() => false)
  const pdfNameText = await pdfNameEl.textContent().catch(() => '')
  console.log(`\nFix 2 - PDF name breadcrumb visible on Chat tab: ${pdfNameVisible ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 2 - PDF name text: "${pdfNameText}"`)

  // Check computed styles
  const pdfNameStyles = await pdfNameEl.evaluate((el) => {
    const s = window.getComputedStyle(el)
    return { fontSize: s.fontSize, color: s.color, borderLeft: s.borderLeft }
  }).catch(() => ({}))
  console.log(`Fix 2 - Font size: ${pdfNameStyles.fontSize} (expect ~10px)`)
  console.log(`Fix 2 - Font size small: ${parseFloat(pdfNameStyles.fontSize) <= 11 ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`Fix 2 - Has left border: ${pdfNameStyles.borderLeft?.includes('solid') ? 'PASS ✓' : 'FAIL ✗'}`)

  // Switch to Index tab — name should still be visible
  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(400)
  const pdfNameOnIndex = await pdfNameEl.isVisible().catch(() => false)
  console.log(`Fix 2b - PDF name visible on Index tab: ${pdfNameOnIndex ? 'PASS ✓' : 'FAIL ✗'}`)
  await page.screenshot({ path: `${SCREENSHOTS}/p1_03_index_tab_name.png` })

  // Switch back to Chat tab
  await page.locator('.chat-tab').filter({ hasText: 'Chat' }).click()
  await page.waitForTimeout(300)

  // ── Fix 4: Tab badge separated from "Index" text ─────────────────────────
  const badge = page.locator('.tab-badge').first()
  const badgeExists = await badge.isVisible().catch(() => false)
  if (badgeExists) {
    const badgeStyles = await badge.evaluate((el) => {
      const s = window.getComputedStyle(el)
      return { marginLeft: s.marginLeft, verticalAlign: s.verticalAlign, fontWeight: s.fontWeight }
    })
    console.log(`\nFix 3 (badge) - margin-left: ${badgeStyles.marginLeft}`)
    console.log(`Fix 3 (badge) - vertical-align: ${badgeStyles.verticalAlign}`)
    console.log(`Fix 3 (badge) - margin-left ≥ 4px: ${parseFloat(badgeStyles.marginLeft) >= 4 ? 'PASS ✓' : 'FAIL ✗'}`)
  } else {
    console.log('\nFix 3 (badge) - No badge (index empty — need to add an entry first)')
  }

  // ── Fix 5: Assistant bubble styling ──────────────────────────────────────
  // Send a chat message to get an assistant bubble
  const chatInput = page.locator('.chat-input')
  await chatInput.click()
  await chatInput.fill('What is this document about in one sentence?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  // Wait for response
  try { await page.waitForSelector('.message-bubble.typing', { timeout: 8000 }) } catch {}
  console.log('\nWaiting for assistant response...')
  await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 35000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SCREENSHOTS}/p1_04_chat_response.png` })

  const assistantBubble = page.locator('.message-assistant .message-bubble').first()
  const bubbleVisible = await assistantBubble.isVisible().catch(() => false)
  console.log(`Fix 4 - Assistant bubble visible: ${bubbleVisible ? 'PASS ✓' : 'FAIL ✗'}`)

  if (bubbleVisible) {
    const bubbleStyles = await assistantBubble.evaluate((el) => {
      const s = window.getComputedStyle(el)
      return { background: s.backgroundColor, borderLeft: s.borderLeft, borderRadius: s.borderRadius }
    })
    console.log(`Fix 4 - Background: ${bubbleStyles.background}`)
    console.log(`Fix 4 - Border-left: ${bubbleStyles.borderLeft}`)
    console.log(`Fix 4 - Has left border: ${bubbleStyles.borderLeft?.includes('solid') ? 'PASS ✓' : 'FAIL ✗'}`)
    console.log(`Fix 4 - Not default bg: ${bubbleStyles.background !== 'rgba(0, 0, 0, 0)' ? 'PASS ✓' : 'FAIL ✗'}`)
  }

  // ── Fix 6: Dismiss log banner, then check Index tab for concept chips ─────
  const logBanner = await page.locator('.log-prompt').isVisible().catch(() => false)
  if (logBanner) {
    await page.locator('.log-prompt-skip').click()
    await page.waitForTimeout(300)
  }

  // Navigate to Index tab to check concept chip count badge
  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SCREENSHOTS}/p1_05_index_tab.png` })

  // Switch to Concepts view if entries exist
  const conceptsBtn = page.locator('.idx-view-btn').filter({ hasText: 'Concepts' })
  const conceptsBtnExists = await conceptsBtn.isVisible().catch(() => false)
  if (conceptsBtnExists) {
    await conceptsBtn.click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SCREENSHOTS}/p1_06_concepts_view.png` })

    const chipCount = page.locator('.idx-concept-chip-count').first()
    const chipCountVisible = await chipCount.isVisible().catch(() => false)
    if (chipCountVisible) {
      const chipStyles = await chipCount.evaluate((el) => {
        const s = window.getComputedStyle(el)
        return { marginLeft: s.marginLeft, background: s.backgroundColor, padding: s.padding }
      })
      console.log(`\nFix 6 - Chip count margin-left: ${chipStyles.marginLeft}`)
      console.log(`Fix 6 - Chip count has bg badge: ${chipStyles.background !== 'rgba(0, 0, 0, 0)' ? 'PASS ✓' : 'FAIL ✗'}`)
      console.log(`Fix 6 - margin-left ≥ 2px: ${parseFloat(chipStyles.marginLeft) >= 2 ? 'PASS ✓' : 'FAIL ✗'}`)
    } else {
      console.log('\nFix 6 - No concept chips visible (no index entries with concepts yet)')
    }
  } else {
    console.log('\nFix 6 - No index entries yet — concept chips not visible')
  }

  await page.screenshot({ path: `${SCREENSHOTS}/p1_07_final.png` })
  console.log('\n=== Done. Screenshots in playwright-tests/screenshots/ ===')
  await browser.close()
})()
