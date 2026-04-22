/**
 * Phase 11 verification — Study-Card reframing + chat-to-index flow
 */

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const APP = 'http://localhost:5173'
const SCREENSHOTS = path.join(__dirname, 'screenshots', 'phase11')
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true })

const results = []
const pass = (name) => { results.push({ name, ok: true });  console.log(`  ✓ ${name}`) }
const fail = (name, msg) => { results.push({ name, ok: false, msg }); console.log(`  ✗ ${name} — ${msg}`) }

async function shot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`), fullPage: false })
}

async function selectText(page, nFrom, nTo) {
  return page.evaluate(({ nFrom, nTo }) => {
    const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
    if (spans.length < nTo + 2) return { ok: false, spansFound: spans.length }
    const range = document.createRange()
    range.setStart(spans[nFrom], 0)
    const last = spans[nTo]
    range.setEnd(last, last?.childNodes?.length || last?.firstChild?.length || 0)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    const wrap = document.querySelector('.viewer-canvas-wrap')
    const rect = wrap.getBoundingClientRect()
    wrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.x + rect.width * 0.5, clientY: rect.y + 200 }))
    return { ok: true, text: sel.toString().trim().slice(0, 60) }
  }, { nFrom, nTo })
}

async function clickChatTab(page) {
  await page.locator('.chat-tab').filter({ hasText: /^Chat/ }).first().click().catch(() => {})
  await page.waitForTimeout(250)
}
async function clickIndexTab(page) {
  await page.locator('.chat-tab').filter({ hasText: /Index/ }).first().click().catch(() => {})
  await page.waitForTimeout(300)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (err) => console.log('    [page error]', err.message))

  console.log('\n=== Phase 11 Verification ===\n')

  // ── Boot ───────────────────────────────────────────────────────────────────
  console.log('[1] App boots and PDF loads')
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  if (await page.locator('.pdf-item').count() > 0) pass('PDF library renders')
  else { fail('PDF library renders', 'none'); await browser.close(); process.exit(1) }

  await page.locator('.pdf-item').first().click()
  try {
    await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 25000 })
    pass('PDF text layer rendered')
  } catch { fail('PDF text layer rendered', 'timeout') }
  await page.waitForTimeout(1500)
  await shot(page, '01-pdf-open')

  // ── Selection menu 3-group layout ──────────────────────────────────────────
  console.log('\n[2] Selection menu 3-group layout')
  const sel = await selectText(page, 20, 30)
  if (!sel.ok) { fail('text selection', `spans: ${sel.spansFound}`); await browser.close(); process.exit(1) }
  pass('text selection works')
  await page.waitForTimeout(400)

  if (await page.locator('.sel-menu').isVisible().catch(() => false)) pass('sel-menu appears')
  else fail('sel-menu appears', 'not visible')
  await shot(page, '02-sel-menu')

  const groupTitles = await page.locator('.sel-menu-group-title').allTextContents()
  const expectedGroups = ['Ask Now', 'Practice Now', 'Save Only']
  if (expectedGroups.every((g) => groupTitles.includes(g))) pass(`3 group titles: ${groupTitles.join(', ')}`)
  else fail('3 group titles', `got: ${JSON.stringify(groupTitles)}`)

  const quizInPractice = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.sel-menu-group')]
      .find((g) => g.querySelector('.sel-menu-group-title')?.textContent.trim() === 'Practice Now')
    return !!g?.querySelector('.sel-menu-btn-practice')
  })
  if (quizInPractice) pass('Quiz Me is in Practice Now group')
  else fail('Quiz Me grouping', 'button not found')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ── Send chat, verify per-message log button ──────────────────────────────
  console.log('\n[3] Chat: send message, verify per-message Log button')
  await clickChatTab(page)
  const inputBox = page.locator('.chat-input textarea, textarea[placeholder*="Ask"]').first()
  await inputBox.fill('What is this book about?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)

  try {
    await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 60000 })
  } catch {}
  await page.waitForTimeout(800)

  if (await page.locator('.message-assistant').count() > 0) pass('assistant message rendered')
  else fail('assistant message rendered', 'none')

  const logBtn = page.locator('.message-log-btn').first()
  if (await logBtn.isVisible().catch(() => false)) pass('per-message Log button visible')
  else fail('per-message Log button', 'not visible')

  if (await page.locator('.log-prompt').count() === 0) pass('old sticky log-prompt banner removed')
  else fail('old banner removed', 'still present')

  await shot(page, '03-chat-response')

  // ── Scroll regression (#1) ─────────────────────────────────────────────────
  console.log('\n[4] Scroll regression (#1): button reachable after response')
  const inView = await logBtn.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const container = el.closest('.chat-messages')
    const cr = container?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight }
    return r.top >= cr.top - 4 && r.bottom <= cr.bottom + 4
  }).catch(() => false)
  if (inView) pass('log button in viewport after response')
  else fail('log button in viewport', 'scrolled out')

  // ── Click Log, verify saved state after tab flip ───────────────────────────
  console.log('\n[5] Save chat response to index')
  await logBtn.click()
  // Wait for save to complete: tab auto-flips to Index when done.
  try {
    await page.waitForSelector('.highlight-index', { state: 'visible', timeout: 30000 })
    pass('flipped to Index tab after save')
  } catch { fail('flipped to Index tab', 'highlight-index did not appear within 30s') }
  await shot(page, '04-index-after-save')

  // Go back to Chat and verify button stuck in saved state
  await clickChatTab(page)
  await page.waitForTimeout(600)
  const savedBtnCount = await page.locator('.message-log-btn.saved').count()
  const savedBtnText = await page.locator('.message-log-btn.saved').first().textContent().catch(() => '')
  if (savedBtnCount >= 1 && /Logged/.test(savedBtnText)) pass(`Log button retains saved state ("${savedBtnText}")`)
  else fail('Log button saved state', `count=${savedBtnCount} text="${savedBtnText}"`)

  // ── Index content: study-card labels + FSRS badges ─────────────────────────
  console.log('\n[6] Study-card labels and FSRS status badges')
  await clickIndexTab(page)
  await page.waitForTimeout(500)

  const subtitles = await page.locator('.idx-qa-context').allTextContents()
  const hasStudyCardLabel = subtitles.some((s) =>
    /Study question|Retrieval practice|Build understanding|Simplify the idea|Vocabulary|High-level summary/.test(s),
  )
  if (hasStudyCardLabel) pass(`study-card subtitles render (sample: "${subtitles[0] || ''}")`)
  else fail('study-card subtitles', `got ${subtitles.length}: ${JSON.stringify(subtitles.slice(0,3))}`)

  const dueBadges = await page.locator('.idx-due-badge').count()
  if (dueBadges > 0) pass(`FSRS status badges render (${dueBadges})`)
  else fail('FSRS status badges', 'none')

  if (await page.locator('.idx-stats-due').count() === 1) pass('per-PDF due count in stats bar')
  else fail('per-PDF due count', 'not present')

  // ── Deep synthesis persists ────────────────────────────────────────────────
  console.log('\n[7] Deep synthesis persists via DB')
  // Make sure entry is expanded (first entry in By Page view)
  const firstEntry = page.locator('.idx-entry').first()
  const firstEntryId = await firstEntry.getAttribute('data-entry-id').catch(() => null)
  if (await firstEntry.isVisible().catch(() => false)) {
    // Click header if collapsed
    await page.waitForTimeout(300)
  }

  // Look for synthesize trigger OR existing synthesis
  let triggerVisible = await page.locator('.idx-synthesis-trigger').first().isVisible().catch(() => false)
  if (triggerVisible) {
    await page.locator('.idx-synthesis-trigger').first().click()
    try {
      await page.waitForSelector('.idx-synthesis-text', { timeout: 45000 })
      pass('summary synthesis generated')
    } catch { fail('summary synthesis', 'timeout waiting for idx-synthesis-text') }
    await page.waitForTimeout(400)
  } else if (await page.locator('.idx-synthesis-text').first().isVisible().catch(() => false)) {
    pass('summary synthesis already present')
  } else {
    fail('summary synthesis', 'neither trigger nor synthesis text visible')
  }

  await page.waitForTimeout(300)
  const diveDeeperBtn = page.locator('button.idx-synthesis-deep-btn').filter({ hasText: /Dive deeper/ }).first()
  if (await diveDeeperBtn.isVisible().catch(() => false)) {
    pass('Dive deeper button visible')
    await diveDeeperBtn.click()
    try {
      await page.waitForSelector('.idx-synthesis-deep-text', { timeout: 60000 })
      pass('deep synthesis generated')
    } catch { fail('deep synthesis generated', 'timeout') }
    await page.waitForTimeout(500)
    await shot(page, '05-deep-synth')
  } else {
    fail('Dive deeper button', 'not visible')
  }

  const deepTextBefore = await page.locator('.idx-synthesis-deep-text').first().textContent().catch(() => null)

  // ── Reload: deep synthesis survives (DB-backed) ────────────────────────────
  console.log('\n[8] Reload: deep synthesis persists')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.pdf-item').first().click()
  await page.waitForTimeout(2500)
  try { await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 }) } catch {}
  await clickIndexTab(page)
  await page.waitForTimeout(700)
  const deepTextAfter = await page.locator('.idx-synthesis-deep-text').first().textContent().catch(() => null)
  if (deepTextAfter && deepTextBefore && deepTextAfter === deepTextBefore) pass('deep synthesis survived reload (identical text)')
  else if (deepTextAfter) pass(`deep synthesis present after reload (${deepTextAfter.length} chars)`)
  else fail('deep synthesis persistence', 'not present after reload')

  // ── Chat history persists across reload (user's top priority) ──────────────
  console.log('\n[9] Chat history persists across reload (localStorage)')
  await clickChatTab(page)
  await page.waitForTimeout(400)
  const msgCountBefore = await page.locator('.message').count()
  if (msgCountBefore >= 2) pass(`chat has ${msgCountBefore} messages before reload`)
  else fail('chat messages before reload', `only ${msgCountBefore}`)
  const firstUserText = await page.locator('.message-user .message-bubble').first().textContent().catch(() => '')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.pdf-item').first().click()
  await page.waitForTimeout(2500)
  await clickChatTab(page)
  await page.waitForTimeout(500)

  const msgCountAfter = await page.locator('.message').count()
  if (msgCountAfter === msgCountBefore) pass(`chat has ${msgCountAfter} messages after reload (identical)`)
  else fail('chat messages after reload', `was ${msgCountBefore}, now ${msgCountAfter}`)

  const firstUserAfter = await page.locator('.message-user .message-bubble').first().textContent().catch(() => '')
  if (firstUserText && firstUserText === firstUserAfter) pass('first user message text identical after reload')
  else fail('user message identity after reload', `before="${firstUserText}" after="${firstUserAfter}"`)

  await shot(page, '06-after-reload')

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  ${passed}/${results.length} checks passed`)
  if (failed > 0) {
    console.log(`  ${failed} failures:`)
    for (const r of results.filter((r) => !r.ok)) console.log(`    - ${r.name}: ${r.msg}`)
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
})().catch((err) => {
  console.error('FATAL:', err)
  process.exit(2)
})
