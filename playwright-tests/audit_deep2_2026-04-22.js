/**
 * Deep audit — round 2.
 * Extends the first round with: Quiz-Me action flow, per-card review screenshots,
 * dedup-gap empirical test, concept/section tab visuals.
 * All screenshots go to logs/audit_2026-04-22/ for later reference.
 */
const { chromium } = require('playwright')

const SHOT = '/Users/neeravch/Desktop/pdf-workspace/logs/audit_2026-04-22'
const APP = 'http://localhost:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openPaperPlain(page) {
  await page.goto(APP, { waitUntil: 'networkidle' })
  await sleep(500)
  const items = await page.locator('.pdf-item').all()
  for (const el of items) {
    const t = (await el.textContent()) || ''
    if (t.includes('Medical Research Papers') || t.includes('Paper Plain')) {
      await el.click()
      break
    }
  }
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 20000 })
  await sleep(1500)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('[PAGE ERROR]', e.message))
  const findings = {}

  await openPaperPlain(page)

  // ══════════════════════════════════════════════════════════════════
  // A. INSPECT INDEX TABS (By Page / Section / Concept / Curated) VISUAL
  // ══════════════════════════════════════════════════════════════════
  const idxTab = page.locator('button.chat-tab').nth(1)
  await idxTab.click()
  await sleep(800)

  // Tab buttons inside the index
  const subTabs = await page.locator('.idx-tabbar button, .idx-view-tabs button, .idx-tab').all()
  findings.index_sub_tabs = []
  for (const t of subTabs) {
    const txt = ((await t.textContent()) || '').trim().replace(/\s+/g, ' ')
    if (txt) findings.index_sub_tabs.push(txt)
  }

  // By Section view
  const secTabBtn = page.locator('button').filter({ hasText: /By Section|Section/ }).first()
  if (await secTabBtn.count()) {
    await secTabBtn.click().catch(() => {})
    await sleep(600)
    await page.screenshot({ path: `${SHOT}/10_by_section_tab.png`, fullPage: true })
    const unsectioned = await page.locator('text=/Unsectioned|Without section|No section/i').count()
    findings.by_section_has_unsectioned_bucket = unsectioned > 0
  }

  // By Concept view
  const cptTabBtn = page.locator('button').filter({ hasText: /By Concept|Concept/ }).first()
  if (await cptTabBtn.count()) {
    await cptTabBtn.click().catch(() => {})
    await sleep(600)
    await page.screenshot({ path: `${SHOT}/11_by_concept_tab.png`, fullPage: true })
    const chipCount = await page.locator('.idx-concept-tag, .idx-concept-chip, .idx-concept-bar-chip').count()
    findings.concept_tab_chip_count = chipCount
  }

  // Curated tab
  const curatedTabBtn = page.locator('button').filter({ hasText: /Curated/ }).first()
  if (await curatedTabBtn.count()) {
    await curatedTabBtn.click().catch(() => {})
    await sleep(500)
    await page.screenshot({ path: `${SHOT}/12_curated_tab.png`, fullPage: true })
  }

  // ══════════════════════════════════════════════════════════════════
  // B. CAPTURE 4x "What is this book about?" DUPLICATES UP CLOSE
  // ══════════════════════════════════════════════════════════════════
  // Back to By Page (default)
  const byPageBtn = page.locator('button').filter({ hasText: /By Page|All Passages|Entries/ }).first()
  if (await byPageBtn.count()) { await byPageBtn.click().catch(() => {}); await sleep(400) }
  // The hl=16 entry is the duplicate hotspot — find entry whose text includes "When seeking information" (first highlight on hl=16)
  // Easier: just take the 4 focus-titles that match "What is this book about"
  const dupFocus = await page.locator('.idx-entry-focus-title', { hasText: /what is this book about/i }).all()
  findings.visible_whatisbook_duplicates = dupFocus.length
  if (dupFocus.length) {
    await dupFocus[0].scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOT}/13_duplicate_whatisbook_cards.png`, fullPage: true })
  }

  // Also count Quiz-Me duplicates on hl=10
  const quizDup = await page.locator('.idx-entry-focus-title, .idx-qa-q-text', {
    hasText: /Practice recall|What gap in healthcare|What problem drives/i,
  }).all()
  findings.visible_quizme_like = quizDup.length

  // ══════════════════════════════════════════════════════════════════
  // C. WALK THROUGH QUIZ-ME ACTION FLOW (new card, no existing)
  // ══════════════════════════════════════════════════════════════════
  // Programmatic selection to avoid mouse flakiness
  await page.evaluate(async () => {
    // Go to page 5 where the ABSTRACT text sits — try scrolling into a stable area
    document.querySelector('.pdf-viewer, .react-pdf__Document')?.scrollBy({ top: 400, behavior: 'instant' })
  })
  await sleep(300)

  // Select a phrase via page.evaluate on the text layer
  const selectionMade = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.react-pdf__Page__textContent span')]
      .filter((s) => (s.textContent || '').length > 20)
    if (spans.length < 2) return false
    const s0 = spans[0], s1 = spans[Math.min(3, spans.length - 1)]
    const range = document.createRange()
    range.setStart(s0.firstChild || s0, 0)
    range.setEnd(s1.firstChild || s1, (s1.firstChild?.length || (s1.textContent || '').length))
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    return (sel.toString() || '').length > 10
  })
  findings.quizflow_selection_made = selectionMade
  await sleep(600)
  const menu = page.locator('.sel-menu')
  findings.quizflow_menu_opened = (await menu.count()) > 0
  if (findings.quizflow_menu_opened) {
    await page.screenshot({ path: `${SHOT}/14_selmenu_open.png`, fullPage: false })
  }

  // ══════════════════════════════════════════════════════════════════
  // D. REVIEW SESSION: CYCLE ALL CARDS, SCREENSHOT EACH + TAG BY TYPE
  // ══════════════════════════════════════════════════════════════════
  // First, close any open menu
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(200)

  // Click "Review due" on index header
  const reviewBtn = page.locator('button', { hasText: /Review due|Review/i }).first()
  if (await reviewBtn.count()) {
    await reviewBtn.click()
    await sleep(1500)
  }

  const dueCards = await page.evaluate(async () => {
    const r = await fetch('/api/pdfs/5/review/due').then((x) => x.json())
    return r
  })
  findings.due_card_count = dueCards.length
  findings.card_quality_classification = []

  const rawPrefixes = [
    'Create a quiz question', 'Explain this passage', 'Explain this in simple',
    'Identify and define', 'Summarise this passage',
  ]

  for (let i = 0; i < dueCards.length; i++) {
    const c = dueCards[i]
    const isRaw = rawPrefixes.some((p) => (c.question || '').startsWith(p))
    const isWhatAbout = /what is this book about/i.test((c.question || '')) ||
      /four (?:key )?features of (?:the )?Paper Plain/i.test((c.question || ''))

    findings.card_quality_classification.push({
      idx: i + 1, qa_id: c.id, hl: c.highlight_id,
      state: c.state,
      raw_prompt: isRaw,
      paraphrase_of_whatabout: isWhatAbout,
      question_80: (c.question || '').slice(0, 80),
    })

    // Screenshot only first, middle, last — 13 screenshots is noise
    if (i === 0 || i === Math.floor(dueCards.length / 2) || i === dueCards.length - 1) {
      await page.screenshot({ path: `${SHOT}/15_review_card_${String(i + 1).padStart(2, '0')}.png`, fullPage: false })
    }

    // Advance: submit is blocked until recall + confidence set, but we can skip via Escape→next
    // Easier path: just close the session
    if (i >= 2) break  // capture 3 cards; full loop not necessary for taxonomy (we have API data)
  }
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(400)

  // ══════════════════════════════════════════════════════════════════
  // E. SUMMARY
  // ══════════════════════════════════════════════════════════════════
  findings.summary = {
    total_due: findings.due_card_count,
    raw_prompt_cards: findings.card_quality_classification.filter((x) => x.raw_prompt).length,
    whatabout_paraphrase_cards: findings.card_quality_classification.filter((x) => x.paraphrase_of_whatabout).length,
  }

  console.log('\n================= ROUND 2 FINDINGS =================')
  console.log(JSON.stringify(findings, null, 2))

  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
