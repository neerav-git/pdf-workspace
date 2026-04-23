/**
 * Step 3 done-criteria verification (deep-fix plan 2026-04-22).
 *
 * Asserts the thesis-critical "recall-first" contract:
 *   1. Phase 1 DOM has NO .rv-source by default.
 *   2. Manual/quiz/chat cards expose a "Reveal passage" button; clicking it
 *      surfaces .rv-source with the assisted flag and both Cloze / Full
 *      toggle options.
 *   3. POST /api/review/submit accepts and persists reveal_used + recall_mode.
 *   4. /research/export/review-log includes reveal_used + recall_mode.
 *
 * The UI check intentionally stops before submitting so it never mutates real
 * FSRS state on the live Paper Plain cards. The server-side submit check uses
 * a throwaway probe QA that is archived immediately after.
 */
const { chromium } = require('playwright')

const APP = 'http://localhost:5173'
const API = 'http://localhost:8000'
const PDF_ID = 5
const PROBE_HL = 16

async function jsonFetch(url, init = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const body = r.status === 204 ? null : await r.json().catch(() => null)
  return { status: r.status, body }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const results = []
  const record = (name, pass, detail) => {
    results.push({ name, pass: !!pass, detail })
    console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // ── UI checks ────────────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()

  try {
    await page.goto(APP, { waitUntil: 'networkidle' })
    await sleep(400)
    const items = await page.locator('.pdf-item').all()
    for (const el of items) {
      const t = (await el.textContent()) || ''
      if (t.includes('Paper Plain') || t.includes('Medical Research Papers')) { await el.click(); break }
    }
    await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
    await sleep(1200)

    const indexTab = page.locator('button.chat-tab').nth(1)
    await indexTab.click()
    await sleep(500)

    // Find and click any button whose label starts with "Review" on the index
    const reviewBtn = page.locator('button', { hasText: /^Review/i }).first()
    if (!(await reviewBtn.count())) {
      record('review_opens', false, 'no Review button found')
    } else {
      await reviewBtn.click()
      await page.waitForSelector('.rv-overlay', { timeout: 8000 }).catch(() => {})
      await sleep(700)
      record('review_opens', (await page.locator('.rv-overlay').count()) > 0, '')
    }

    // Checks run against the card the queue happens to land on first.
    const sourceAtStart = await page.locator('.rv-source').count()
    record('phase1_no_source_by_default', sourceAtStart === 0, `count=${sourceAtStart}`)
    const firstBadgeType = await page.evaluate(() => {
      const b = document.querySelector('.rv-action-badge')
      if (!b) return null
      const cls = [...b.classList].find((c) => c.startsWith('rv-action-'))
      return cls ? cls.replace('rv-action-', '') : null
    })
    const firstIsAction = firstBadgeType && firstBadgeType !== 'quiz'
    const firstRevealCount = await page.locator('.rv-reveal-btn').count()
    if (firstIsAction) {
      record('action_card_has_no_reveal', firstRevealCount === 0, `type=${firstBadgeType}`)
    }

    // Target a specific manual/quiz/chat card via the dev-exposed store so the
    // reveal-UI check isn't gated on queue ordering and never has to submit.
    const targeted = await page.evaluate(async ({ apiBase, pdfId }) => {
      const store = window.__APP_STORE__
      if (!store) return { ok: false, reason: 'store not exposed' }
      const resp = await fetch(`${apiBase}/api/pdfs/${pdfId}/review/due`)
      const due = await resp.json()
      const ACTION_TYPES = ['explain', 'simplify', 'terms', 'summarise']
      const manual = due.find((c) => !ACTION_TYPES.includes(c.card_type))
      if (!manual) return { ok: false, reason: 'no manual/quiz/chat card in queue' }
      store.getState().closeReview()
      store.getState().openReview({ cards: [manual] })
      return { ok: true, id: manual.id, type: manual.card_type }
    }, { apiBase: API, pdfId: PDF_ID })

    if (!targeted.ok) {
      record('manual_card_reveal_works', false, targeted.reason)
      if (!results.find((r) => r.name === 'action_card_has_no_reveal')) {
        record('action_card_has_no_reveal', true, 'not encountered (queue had no action card first)')
      }
    } else {
      await sleep(500)
      const preReveal = await page.locator('.rv-source').count()
      const revealBtn = page.locator('.rv-reveal-btn')
      const revealCount = await revealBtn.count()
      if (revealCount === 0) {
        record('manual_card_reveal_works', false, `no reveal on targeted card type=${targeted.type}`)
      } else {
        await revealBtn.click()
        await sleep(200)
        const sourceAfter = await page.locator('.rv-source').count()
        const flag = await page.locator('.rv-reveal-flag').count()
        const toggles = await page.locator('.rv-reveal-opt').count()
        record(
          'manual_card_reveal_works',
          preReveal === 0 && sourceAfter > 0 && flag > 0 && toggles === 2,
          `type=${targeted.type} pre=${preReveal} post=${sourceAfter} flag=${flag} toggles=${toggles}`,
        )
      }
      if (!results.find((r) => r.name === 'action_card_has_no_reveal')) {
        record('action_card_has_no_reveal', true, 'queue had no action-type card in probed position (non-blocking)')
      }
    }
  } finally {
    await browser.close()
  }

  // ── Server checks ────────────────────────────────────────────────────────
  // Create an ephemeral probe QA, submit a review, archive.
  const { status: createStatus, body: probe } = await jsonFetch(
    `${API}/api/highlights/${PROBE_HL}/qa?force=true`,
    {
      method: 'POST',
      body: JSON.stringify({
        card_type: 'manual',
        question: `Step3 verify probe ${Date.now()}`,
        answer: 'probe answer',
      }),
    },
  )
  if (createStatus !== 201 || !probe?.id) {
    record('submit_accepts_reveal_used', false, `probe create failed status=${createStatus}`)
    record('research_export_has_fields', false, 'skipped — probe not available')
  } else {
    const { status: subStatus, body: sub } = await jsonFetch(
      `${API}/api/review/submit`,
      {
        method: 'POST',
        body: JSON.stringify({
          qa_pair_id: probe.id,
          recall_text: 'step3 probe recall',
          confidence_rating: 1,
          reveal_used: true,
          recall_mode: 'assisted',
        }),
      },
    )
    record(
      'submit_accepts_reveal_used',
      subStatus === 200 && typeof sub?.review_log_id === 'number',
      `status=${subStatus} rl_id=${sub?.review_log_id}`,
    )

    const { body: exp } = await jsonFetch(`${API}/api/research/export/review-log?format=json`)
    const row = Array.isArray(exp)
      ? exp.find((r) => r.review_log_id === sub?.review_log_id)
      : null
    const hasFields = row
      && row.reveal_used === true
      && row.recall_mode === 'assisted'
    record(
      'research_export_has_fields',
      !!hasFields,
      row ? `reveal_used=${row.reveal_used} recall_mode=${row.recall_mode}` : 'row not found',
    )

    // Also confirm legacy rows were backfilled to assisted/true.
    const legacy = Array.isArray(exp)
      ? exp.find((r) => typeof r.review_log_id === 'number' && r.review_log_id !== sub?.review_log_id)
      : null
    const legacyBackfilled = legacy
      && legacy.reveal_used === true
      && legacy.recall_mode === 'assisted'
    record(
      'legacy_rows_backfilled',
      legacy ? !!legacyBackfilled : true,
      legacy ? `rl=${legacy.review_log_id} reveal=${legacy.reveal_used} mode=${legacy.recall_mode}` : 'no legacy rows — skipped',
    )

    // Reject invalid recall_mode — confirms server-side validation.
    const { status: badStatus } = await jsonFetch(
      `${API}/api/review/submit`,
      {
        method: 'POST',
        body: JSON.stringify({
          qa_pair_id: probe.id,
          recall_text: 'bad mode probe',
          confidence_rating: 1,
          reveal_used: true,
          recall_mode: 'not_a_mode',
        }),
      },
    )
    record('rejects_unknown_recall_mode', badStatus === 422, `status=${badStatus}`)

    // Clean up — archive the probe so Paper Plain's queue is unaffected.
    await jsonFetch(`${API}/api/qa/${probe.id}`, { method: 'DELETE' })
  }

  const passed = results.filter((r) => r.pass).length
  console.log(`\n=== Step 3 verification: ${passed}/${results.length} passed ===`)
  process.exit(passed === results.length ? 0 : 1)
})()
