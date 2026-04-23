/**
 * Deep audit — verifies ten observations on Paper Plain (pdf_id=5).
 * Produces factual evidence: screenshots + counts printed to stdout.
 * No mutations — pure inspection.
 */
const { chromium } = require('playwright')

const SHOT_DIR = '/Users/neeravch/Desktop/pdf-workspace/logs/audit_2026-04-22'
const APP = 'http://localhost:5173'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  const findings = {}

  page.on('pageerror', (e) => console.error('[PAGE ERROR]', e.message))

  // Step 1 — load app, open Paper Plain (id=5)
  await page.goto(APP, { waitUntil: 'networkidle' })
  await sleep(500)

  // Find Paper Plain card by substring in the sidebar
  const pdfs = await page.locator('.pdf-item').all()
  let clicked = false
  for (const el of pdfs) {
    const t = (await el.textContent()) || ''
    if (t.includes('Paper Plain') || t.includes('Medical Research Papers')) {
      await el.click()
      clicked = true
      break
    }
  }
  if (!clicked) {
    console.error('Paper Plain PDF not found in sidebar — aborting')
    await browser.close()
    process.exit(2)
  }
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await sleep(1500)

  // ── Obs #1 — chat pane starts empty (no DB persistence) ─────────────────────
  // Click Chat tab
  const chatTab = page.locator('button.chat-tab').first()
  if (await chatTab.count()) await chatTab.click()
  await sleep(500)
  const userMsgs = await page.locator('.message-user').count()
  const assistantMsgs = await page.locator('.message-assistant').count()
  findings.chat_user_msgs_on_open = userMsgs
  findings.chat_assistant_msgs_on_open = assistantMsgs
  await page.screenshot({ path: `${SHOT_DIR}/01_chat_on_open.png`, fullPage: false })

  // Also: check localStorage partialize key — confirms chat is ONLY in localStorage
  const ls = await page.evaluate(() => localStorage.getItem('pdf-workspace-chat'))
  findings.localStorage_keys = ls ? Object.keys(JSON.parse(ls).state || {}) : null
  findings.localStorage_has_chat_history = ls ? !!JSON.parse(ls).state?.chatHistoriesByPdf : false

  // Probe backend: GET /api/chat/history/5 — expect 404 (no endpoint)
  const chatHistEndpoint = await page.evaluate(async () => {
    const r = await fetch('/api/chat/history/5').catch((e) => ({ status: 'err' }))
    return { status: r.status }
  })
  findings.chat_history_backend_endpoint = chatHistEndpoint

  // ── Obs #2 — index overview density ─────────────────────────────────────────
  const idxTab = page.locator('button.chat-tab').nth(1)
  if (await idxTab.count()) await idxTab.click()
  await sleep(800)
  await page.screenshot({ path: `${SHOT_DIR}/02_index_overview.png`, fullPage: false })

  // Pull statbar text
  const statbarText = await page.locator('.idx-statbar, .idx-stat-row').first().textContent().catch(() => '')
  findings.index_statbar = (statbarText || '').replace(/\s+/g, ' ').trim()

  // Count visible entry cards
  const entryCount = await page.locator('.idx-entry, .idx-entry-row').count()
  findings.visible_entry_cards = entryCount

  // ── Obs #3 — duplicate / near-duplicate questions in index ──────────────────
  // Get visible question labels
  const qLabels = await page.$$eval(
    '.idx-q-label, .idx-question, .idx-q-title, .idx-entry-question',
    (nodes) => nodes.map((n) => (n.innerText || n.textContent || '').trim()).filter(Boolean),
  ).catch(() => [])
  findings.visible_question_count = qLabels.length
  findings.visible_questions_sample = qLabels.slice(0, 25)
  await page.screenshot({ path: `${SHOT_DIR}/03_index_questions.png`, fullPage: true })

  // Normalise + count dups
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/g, '').trim()
  const freq = {}
  qLabels.forEach((q) => { const k = norm(q); freq[k] = (freq[k] || 0) + 1 })
  findings.duplicate_visible_questions = Object.fromEntries(
    Object.entries(freq).filter(([, v]) => v > 1),
  )

  // ── Obs #4 — concepts density ───────────────────────────────────────────────
  // Concepts tab — heuristic selector
  const conceptsTabBtn = page.locator('button', { hasText: /^Concepts/ }).first()
  if (await conceptsTabBtn.count()) {
    await conceptsTabBtn.click()
    await sleep(600)
    await page.screenshot({ path: `${SHOT_DIR}/04_concepts_tab.png`, fullPage: true })
    const allChips = await page.$$eval('.idx-concept-tag, .idx-concept-chip, .idx-concept-bar-chip',
      (els) => els.map((e) => (e.innerText || '').trim()).filter(Boolean))
    findings.concept_chip_labels = allChips
    findings.concept_chip_total = allChips.length
  }

  // ── Obs #5 — collapsed entry header phrasing ────────────────────────────────
  // Switch back to default (By Passage) and capture one expanded card
  const byPassageTab = page.locator('button', { hasText: /By Passage|All Passages|Entries/ }).first()
  if (await byPassageTab.count()) { await byPassageTab.click(); await sleep(400) }
  const firstEntry = page.locator('.idx-entry, .idx-entry-row').first()
  if (await firstEntry.count()) {
    await firstEntry.scrollIntoViewIfNeeded()
    await firstEntry.screenshot({ path: `${SHOT_DIR}/05_collapsed_entry.png` })
    // Try to expand
    await firstEntry.click().catch(() => {})
    await sleep(400)
    await firstEntry.screenshot({ path: `${SHOT_DIR}/05b_expanded_entry.png` })
  }

  // ── Obs #6 — section coverage ───────────────────────────────────────────────
  // Hit highlights API directly to compute section-anchor ratio
  const hlStats = await page.evaluate(async () => {
    const r = await fetch('/api/pdfs/5/highlights').then((x) => x.json())
    let total = 0, withSection = 0, withDeep = 0
    for (const e of r) {
      total += 1
      if (e.section_title) withSection += 1
      if ((e.deep_section_path || []).length > 0) withDeep += 1
    }
    return { total, withSection, withDeep }
  })
  findings.section_anchoring = hlStats

  // ── Obs #7 — due queue quality ──────────────────────────────────────────────
  const dueData = await page.evaluate(async () => {
    const r = await fetch('/api/pdfs/5/review/due').then((x) => x.json())
    const prefixes = ['Create a quiz question', 'Explain this passage', 'Explain this in simple',
      'Identify and define', 'Summarise this passage']
    let raw_prompt_cards = 0
    const qnorm = {}
    for (const c of r) {
      const q = c.question || ''
      if (prefixes.some((p) => q.startsWith(p))) raw_prompt_cards += 1
      const k = q.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[?.!]+$/g, '')
      qnorm[k] = (qnorm[k] || 0) + 1
    }
    return {
      total_due: r.length,
      raw_prompt_cards,
      duplicate_due_questions: Object.fromEntries(
        Object.entries(qnorm).filter(([, v]) => v > 1).map(([k, v]) => [k.slice(0, 60), v]),
      ),
    }
  })
  findings.due_queue = dueData

  // ── Obs #8 — review session: source-first layout ────────────────────────────
  // Open Review session for this PDF
  // The sidebar or top bar has a "Review due" button — find it
  const reviewBtn = page.locator('button', { hasText: /Review|review due/i }).first()
  if (await reviewBtn.count()) {
    await reviewBtn.click()
    await sleep(1200)
    await page.screenshot({ path: `${SHOT_DIR}/06_review_session_card.png`, fullPage: false })
    // Measure which element appears higher on screen: source passage vs recall textarea
    const geom = await page.evaluate(() => {
      const src = document.querySelector('.rv-source')
      const q = document.querySelector('.rv-question')
      const ta = document.querySelector('.rv-recall-input')
      const conf = document.querySelector('.rv-confidence')
      const r = (el) => el ? { top: el.getBoundingClientRect().top, h: el.getBoundingClientRect().height } : null
      return { source: r(src), question: r(q), textarea: r(ta), confidence: r(conf) }
    })
    findings.review_geometry = geom
    // Scroll to bottom of card to capture confidence + submit area too
    await page.evaluate(() => document.querySelector('.rv-card-wrap')?.scrollTo(0, 9999))
    await sleep(250)
    await page.screenshot({ path: `${SHOT_DIR}/06b_review_session_full.png`, fullPage: true })
    // Close via Esc / back nav
    await page.keyboard.press('Escape').catch(() => {})
  }

  await page.screenshot({ path: `${SHOT_DIR}/07_final_state.png`, fullPage: false })

  console.log('\n================= AUDIT FINDINGS =================')
  console.log(JSON.stringify(findings, null, 2))

  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
