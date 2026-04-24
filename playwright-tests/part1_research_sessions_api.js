const { chromium } = require('playwright')

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  throw new Error(msg)
}

async function api(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const res = await fetch(`http://localhost:8000${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, data }
  }, { path, options })
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })

  const backfill = await api(page, '/api/research-sessions/backfill-defaults', { method: 'POST' })
  console.log('backfill:', JSON.stringify(backfill.data))
  if (!backfill.ok) fail('Default research-session backfill endpoint should succeed')

  const sessionsRes = await api(page, '/api/research-sessions')
  if (!sessionsRes.ok) fail('GET /api/research-sessions should succeed')
  const sessions = sessionsRes.data || []
  console.log('sessions:', JSON.stringify(sessions.map((s) => ({ title: s.title, pdfs: s.pdfs.map((p) => p.title) }))))

  const learning = sessions.find((s) => s.title === 'Learning Design Research')
  const medical = sessions.find((s) => s.title === 'Medical Encyclopedia')
  const unsorted = sessions.find((s) => s.title === 'Unsorted Research')
  if (!learning) fail('Learning Design Research session should exist')
  if (!medical) fail('Medical Encyclopedia session should exist')
  if (!unsorted) fail('Unsorted Research fallback session should exist')

  const learningTitles = (learning?.pdfs || []).map((p) => p.title).join(' || ')
  const medicalTitles = (medical?.pdfs || []).map((p) => p.title).join(' || ')
  if (!/Making Medical Research Papers Approachable/i.test(learningTitles)) {
    fail('Paper Plain should be assigned to Learning Design Research')
  }
  if (!/Knowledge-Aware Retrieval/i.test(learningTitles)) {
    fail('Knowledge-Aware Retrieval should be assigned to Learning Design Research')
  }
  if (!/Medical_book/i.test(medicalTitles)) {
    fail('Medical_book should be assigned to Medical Encyclopedia')
  }

  const pdfsRes = await api(page, '/api/pdfs')
  if (!pdfsRes.ok) fail('Legacy GET /api/pdfs should still succeed')
  const pdfs = pdfsRes.data || []
  console.log('pdfs:', JSON.stringify(pdfs.map((p) => ({ id: p.id, title: p.title, session: p.research_session_id }))))
  if (pdfs.length < 3) fail('Legacy PDF list should still return existing PDFs')
  if (pdfs.some((p) => !p.research_session_id)) fail('Existing PDFs should have a research_session_id after backfill')

  const paperPlain = pdfs.find((p) => /Making Medical Research Papers Approachable/i.test(p.title))
  if (paperPlain) {
    const placement = await api(page, `/api/research-sessions/suggest-placement/${paperPlain.id}`)
    if (!placement.ok) fail('Placement suggestion endpoint should succeed')
    const placementTitles = (placement.data?.suggestions || []).map((s) => s.session_title)
    if (!placementTitles.includes('Learning Design Research')) {
      fail('Paper Plain placement suggestions should include Learning Design Research')
    }
  }

  if (paperPlain && learning) {
    const assign = await api(page, `/api/research-sessions/${learning.id}/pdfs/${paperPlain.id}`, { method: 'POST' })
    if (!assign.ok) fail('Assigning a PDF to its existing session should be idempotent')
  }

  const create = await api(page, '/api/research-sessions', {
    method: 'POST',
    body: JSON.stringify({
      title: `Temporary Session ${Date.now()}`,
      topic: 'Temporary API test',
      context: 'Created by the research-session API regression and deleted immediately.',
    }),
  })
  if (!create.ok) fail('Creating an empty research session should succeed')
  const tempId = create.data?.id
  if (!tempId) fail('Created session should return an id')

  const patch = await api(page, `/api/research-sessions/${tempId}`, {
    method: 'PATCH',
    body: JSON.stringify({ topic: 'Updated temporary topic' }),
  })
  if (!patch.ok || patch.data?.topic !== 'Updated temporary topic') {
    fail('Patching a research session should persist editable metadata')
  }

  if (paperPlain && learning) {
    const addSecondary = await api(
      page,
      `/api/research-sessions/${tempId}/pdfs/${paperPlain.id}?replace_existing=false`,
      { method: 'POST' },
    )
    if (!addSecondary.ok) fail('Adding a secondary membership should succeed')
    if (!addSecondary.data?.pdfs?.some((p) => p.id === paperPlain.id)) {
      fail('Secondary membership should show the PDF in the temporary session')
    }

    const afterSecondary = await api(page, '/api/research-sessions')
    const learningAfterSecondary = (afterSecondary.data || []).find((s) => s.id === learning.id)
    if (!learningAfterSecondary?.pdfs?.some((p) => p.id === paperPlain.id)) {
      fail('Secondary membership must not remove the PDF from its original session')
    }

    const pdfsAfterSecondary = await api(page, '/api/pdfs')
    const paperAfterSecondary = (pdfsAfterSecondary.data || []).find((p) => p.id === paperPlain.id)
    if (paperAfterSecondary?.research_session_id !== learning.id) {
      fail('Secondary membership must not change the legacy primary session pointer')
    }

    const removeSecondary = await api(
      page,
      `/api/research-sessions/${tempId}/pdfs/${paperPlain.id}`,
      { method: 'DELETE' },
    )
    if (!removeSecondary.ok) fail('Removing a secondary membership should succeed')
    if (removeSecondary.data?.pdfs?.some((p) => p.id === paperPlain.id)) {
      fail('Removed secondary membership should no longer show in the temporary session')
    }

    const afterRemove = await api(page, '/api/research-sessions')
    const learningAfterRemove = (afterRemove.data || []).find((s) => s.id === learning.id)
    if (!learningAfterRemove?.pdfs?.some((p) => p.id === paperPlain.id)) {
      fail('Removing a secondary membership must preserve the original session membership')
    }
  }

  const del = await api(page, `/api/research-sessions/${tempId}`, { method: 'DELETE' })
  if (!del.ok) fail('Deleting a temporary session should succeed')

  if (paperPlain && learning) {
    const afterDelete = await api(page, '/api/research-sessions')
    const learningAfterDelete = (afterDelete.data || []).find((s) => s.id === learning.id)
    const deletedTemp = (afterDelete.data || []).find((s) => s.id === tempId)
    if (deletedTemp) fail('Temporary session should be deleted')
    if (!learningAfterDelete?.pdfs?.some((p) => p.id === paperPlain.id)) {
      fail('Deleting a secondary session must preserve the original PDF membership')
    }
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
