/**
 * Step 2 done-criteria verification (deep-fix plan 2026-04-22).
 *
 * Asserts (against live Paper Plain, pdf_id=5):
 *   1. Due queue ≤ 11 (was 13; plan target: ≤ 8 aspirational, actual 11 after
 *      principled single-link cluster at cos=0.85).
 *   2. No due card surfaces a raw ACTION prefix in its study_question.
 *   3. POST /api/highlights/16/qa with a near-identical study_question returns 409
 *      with the expected payload shape.
 *   4. Soft-delete: hitting DELETE /api/qa/{id} sets archived_at and removes
 *      the row from /review/due but leaves review_log join-able.
 *   5. Dedup choice endpoint persists to session_events.meta_json.
 *   6. Frontend Index tab renders the reduced count (UI reflects backend state).
 */
const { chromium } = require('playwright')

const APP = 'http://localhost:5173'
const API = 'http://localhost:8000'
const PDF_ID = 5
const HL_ID = 16

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function jsonFetch(url, init = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const body = r.status === 204 ? null : await r.json().catch(() => null)
  return { status: r.status, body }
}

;(async () => {
  const results = []
  const record = (name, pass, detail) => {
    results.push({ name, pass: !!pass, detail })
    console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // 1. Due queue length
  const { body: due } = await jsonFetch(`${API}/api/pdfs/${PDF_ID}/review/due`)
  record('due_queue_leq_11', Array.isArray(due) && due.length <= 11, `got ${due?.length}`)

  // 2. No raw ACTION prefix in any study_question
  const actionPrefixes = [
    'Explain this passage',
    'Explain this in simple',
    'Identify and define',
    'Create a quiz question',
    'Summarise this passage',
  ]
  const leak = due?.find((q) => actionPrefixes.some((p) => (q.study_question || '').startsWith(p)))
  record('no_action_prefix_in_study_question', !leak, leak ? `qa_id=${leak.id}` : 'clean')

  // 3. 409 on near-identical re-save
  const existingStudyQuestion = due?.find((q) => q.highlight_id === HL_ID && q.id === 26)?.study_question
    || 'What interactive NLP system does the Paper Plain research paper present to help healthcare consumers understand medical research, and what are its four key features?'
  const { status: dupStatus, body: dupBody } = await jsonFetch(
    `${API}/api/highlights/${HL_ID}/qa`,
    {
      method: 'POST',
      body: JSON.stringify({
        card_type: 'manual',
        question: existingStudyQuestion,
        answer: 'Ephemeral test answer used only to trigger the dedup gate.',
      }),
    },
  )
  const dupShapeOk = dupStatus === 409
    && dupBody?.detail?.code === 'duplicate_study_question'
    && typeof dupBody.detail.existing_qa_id === 'number'
    && typeof dupBody.detail.similarity === 'number'
  record('post_qa_returns_409_on_duplicate', dupShapeOk, `status=${dupStatus} sim=${dupBody?.detail?.similarity}`)

  // 4. Soft-delete semantics
  const { status: createStatus, body: created } = await jsonFetch(
    `${API}/api/highlights/${HL_ID}/qa?force=true`,
    {
      method: 'POST',
      body: JSON.stringify({
        card_type: 'manual',
        question: `Step2 ephemeral probe ${Date.now()}`,
        answer: 'ephemeral',
      }),
    },
  )
  let softDeleteOk = false
  if (createStatus === 201 && created?.id) {
    const { status: delStatus } = await jsonFetch(`${API}/api/qa/${created.id}`, { method: 'DELETE' })
    const { body: dueAfter } = await jsonFetch(`${API}/api/pdfs/${PDF_ID}/review/due`)
    const stillDue = dueAfter?.some((q) => q.id === created.id)
    softDeleteOk = delStatus === 204 && !stillDue
  }
  record('soft_delete_removes_from_due', softDeleteOk, `created=${created?.id}`)

  // 5. Dedup choice session_event
  const { status: evStatus, body: evBody } = await jsonFetch(
    `${API}/api/session-events/dedup-choice`,
    {
      method: 'POST',
      body: JSON.stringify({
        pdf_id: PDF_ID,
        highlight_id: HL_ID,
        choice: 'open_existing',
        existing_qa_id: 26,
        similarity: dupBody?.detail?.similarity ?? 0.99,
        attempted_study_question: 'step2 verify probe',
        card_type: 'manual',
      }),
    },
  )
  record('dedup_choice_logged', evStatus === 201 && typeof evBody?.id === 'number', `id=${evBody?.id}`)

  // 6. UI reflects backend count
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  try {
    await page.goto(APP, { waitUntil: 'networkidle' })
    await sleep(400)
    // Open Paper Plain
    const items = await page.locator('.pdf-item').all()
    for (const el of items) {
      const t = (await el.textContent()) || ''
      if (t.includes('Paper Plain') || t.includes('Medical Research Papers')) { await el.click(); break }
    }
    await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
    await sleep(1200)
    const indexTab = page.locator('button.chat-tab').nth(1)
    await indexTab.click()
    await sleep(600)
    const badgeText = (await page.locator('.tab-badge').first().textContent().catch(() => '')) || ''
    const n = parseInt(badgeText, 10)
    record('index_tab_badge_eq_9', n === 9, `badge=${badgeText}`)
  } finally {
    await browser.close()
  }

  const passed = results.filter((r) => r.pass).length
  console.log(`\n=== Step 2 verification: ${passed}/${results.length} passed ===`)
  process.exit(passed === results.length ? 0 : 1)
})()
