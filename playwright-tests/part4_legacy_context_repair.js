const { chromium } = require('playwright')

const APP = 'http://localhost:5173'
const API = 'http://localhost:8000'
const PDF_ID = 5

async function jsonFetch(url, init = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = r.status === 204 ? null : await r.json().catch(() => null)
  return { status: r.status, body }
}

;(async () => {
  const results = []
  const record = (name, pass, detail = '') => {
    results.push({ name, pass: !!pass, detail })
    console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  }

  let tempHighlightId = null
  let tempQaId = null

  try {
    const createHighlight = await jsonFetch(`${API}/api/pdfs/${PDF_ID}/highlights`, {
      method: 'POST',
      body: JSON.stringify({
        page_number: 1,
        highlight_text: 'Legacy repair probe passage about improving context quality in scientific reading.',
        highlight_texts: ['Legacy repair probe passage about improving context quality in scientific reading.'],
        section_title: 'Probe Section',
        section_path: [{ title: 'Probe Section', level: 1 }],
        concepts: [],
        note: '',
      }),
    })
    tempHighlightId = createHighlight.body?.id
    record('temp_highlight_created', createHighlight.status === 201 && typeof tempHighlightId === 'number', `status=${createHighlight.status}`)
    if (!tempHighlightId) throw new Error('temp highlight not created')

    const createQa = await jsonFetch(`${API}/api/highlights/${tempHighlightId}/qa`, {
      method: 'POST',
      body: JSON.stringify({
        card_type: 'chat',
        question: 'what is an insightful result from the paper',
        original_question: 'what is an insightful result from the paper',
        answer: 'The paper argues that layered scaffolding helps readers move from confusing source text to usable understanding.',
      }),
    })
    tempQaId = createQa.body?.id
    record('legacy_style_chat_card_created', createQa.status === 201 && typeof tempQaId === 'number', `status=${createQa.status}`)
    if (!tempQaId) throw new Error('temp qa not created')

    record(
      'chat_card_has_generated_context',
      Boolean(createQa.body?.question_context?.context_summary),
      `status=${createQa.body?.question_context?.context_status || 'none'}`,
    )

    const repair = await jsonFetch(`${API}/api/qa/${tempQaId}/repair-context`, { method: 'POST' })
    record(
      'repair_context_preserves_question',
      repair.status === 200 && repair.body?.original_question === 'what is an insightful result from the paper',
      `status=${repair.status}`,
    )
    record(
      'repair_context_generates_summary',
      repair.status === 200 && Boolean(repair.body?.question_context?.context_summary),
      repair.body?.question_context?.context_status || 'none',
    )

    const reframe = await jsonFetch(`${API}/api/qa/${tempQaId}/reframe-study-question`, { method: 'POST' })
    record(
      'reframe_preserves_original_question',
      reframe.status === 200 && reframe.body?.original_question === 'what is an insightful result from the paper',
      `status=${reframe.status}`,
    )
    record(
      'reframe_sets_study_question',
      reframe.status === 200 && Boolean(reframe.body?.study_question),
      reframe.body?.study_question || 'none',
    )

    const attach = await jsonFetch(`${API}/api/qa/${tempQaId}/attach-source`, { method: 'POST' })
    record(
      'attach_source_adds_passage',
      attach.status === 200 && Boolean(attach.body?.question_context?.source_excerpt_full),
      attach.body?.question_context?.context_status || 'none',
    )

    const convert = await jsonFetch(`${API}/api/qa/${tempQaId}/convert-to-note`, { method: 'POST' })
    record(
      'convert_to_note_archives_card',
      convert.status === 200 && !((convert.body?.qa_pairs || []).some((qa) => qa.id === tempQaId)),
      `status=${convert.status}`,
    )
    record(
      'convert_to_note_preserves_content_as_note',
      convert.status === 200 && /Study note/.test(convert.body?.note || '') && /what is an insightful result from the paper/i.test(convert.body?.note || ''),
      '',
    )

    const backfill = await jsonFetch(`${API}/api/pdfs/${PDF_ID}/legacy-context-backfill`, { method: 'POST' })
    record('pdf_backfill_endpoint_runs', backfill.status === 200, `updated=${backfill.body?.qas_updated ?? 'n/a'}`)

    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    await page.goto(APP, { waitUntil: 'networkidle' })
    const learning = page.locator('.session-group').filter({ hasText: 'Learning Design Research' })
    await learning.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
    await page.locator('.viewer-title').filter({ hasText: /Making Medic/i }).waitFor({ timeout: 10000 })

    await page.locator('.workspace-tab').filter({ hasText: 'Index' }).click()
    await page.getByRole('heading', { name: 'Knowledge Map' }).waitFor({ timeout: 10000 })
    await page.locator('.workspace-index-entry-card').first().waitFor({ timeout: 10000 })
    const beforeCount = await page.locator('.workspace-index-entry-card').count()
    await page.getByRole('button', { name: /Backfill legacy context/i }).click()
    await page.getByText(/Updated .* legacy cards|Backfill failed/).waitFor({ timeout: 10000 })
    const afterCount = await page.locator('.workspace-index-entry-card').count()
    record('legacy_items_survive_backfill', beforeCount > 0 && afterCount === beforeCount, `before=${beforeCount} after=${afterCount}`)

    await page.locator('.workspace-index-entry-actions button').filter({ hasText: /Show details|Hide details/ }).first().click()
    await page.locator('.workspace-inline-actions--repair button').filter({ hasText: 'Repair context' }).first().waitFor({ timeout: 10000 })
    await page.locator('.workspace-inline-actions--repair button').filter({ hasText: 'Reframe as study question' }).first().waitFor({ timeout: 10000 })
    await page.locator('.workspace-inline-actions--repair button').filter({ hasText: 'Attach source' }).first().waitFor({ timeout: 10000 })
    await page.locator('.workspace-inline-actions--repair button').filter({ hasText: 'Convert to note' }).first().waitFor({ timeout: 10000 })
    record('repair_tools_visible_in_full_page_index', true)

    await page.locator('.workspace-tab').filter({ hasText: 'Reader' }).click()
    await page.locator('button.chat-tab').filter({ hasText: 'Index' }).click()
    const preferredEntry = page.locator('.idx-entry').filter({ hasText: /how does the paper tackle this problem/i }).first()
    const indexedEntry = (await preferredEntry.count()) > 0 ? preferredEntry : page.locator('.idx-entry').nth(0)
    await indexedEntry.locator('.idx-entry-header').waitFor({ timeout: 10000 })
    await indexedEntry.locator('.idx-entry-header').click()
    await indexedEntry.locator('.idx-qa-row').first().waitFor({ timeout: 10000 })
    await indexedEntry.locator('.idx-qa-row').first().click()
    await indexedEntry.locator('.idx-expand-btn').filter({ hasText: 'Open in Index tab' }).first().click()
    await page.locator('.workspace-tab.active').filter({ hasText: 'Index' }).waitFor({ timeout: 10000 })
    record('panel_to_full_page_index_jump_still_works', true)

    await browser.close()
  } finally {
    if (tempHighlightId) {
      await jsonFetch(`${API}/api/highlights/${tempHighlightId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const passed = results.filter((r) => r.pass).length
  console.log(`\n=== Part 4 legacy repair verification: ${passed}/${results.length} passed ===`)
  process.exit(passed === results.length ? 0 : 1)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
