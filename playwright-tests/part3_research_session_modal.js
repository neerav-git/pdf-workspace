const { chromium } = require('playwright')

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

async function cleanupTempSessions(page, titlePrefix) {
  const sessionsRes = await api(page, '/api/research-sessions')
  if (!sessionsRes.ok) return
  for (const session of sessionsRes.data || []) {
    if (session.title?.startsWith(titlePrefix)) {
      await api(page, `/api/research-sessions/${session.id}`, { method: 'DELETE' })
    }
  }
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const titlePrefix = 'Temporary UI Session'
  const tempTitle = `${titlePrefix} ${Date.now()}`

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
  await page.locator('.session-title').filter({ hasText: 'Learning Design Research' }).waitFor({ timeout: 10000 })
  await cleanupTempSessions(page, titlePrefix)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.session-title').filter({ hasText: 'Learning Design Research' }).waitFor({ timeout: 10000 })

  await page.getByRole('button', { name: '+ Session' }).click()
  await page.getByText('Add Research Session').waitFor({ timeout: 10000 })
  await page.getByText(/Short sidebar and report label/i).waitFor({ timeout: 10000 })
  await page.getByText(/concept tagging, recommendations, and future gap analysis/i).waitFor({ timeout: 10000 })
  await page.getByText(/A PDF can belong to multiple sessions/i).waitFor({ timeout: 10000 })
  await page.locator('.session-pdf-option').filter({ hasText: /Making Medical Research Papers Approachable/i }).click()
  await page.locator('.session-pdf-option').filter({ hasText: /Knowledge-Aware Retrieval/i }).click()
  await page.getByRole('button', { name: 'Suggest from PDFs' }).click()
  await page.locator('.session-modal .session-field input').first().waitFor({ timeout: 10000 })
  await page.waitForFunction(() => document.querySelector('.session-suggestion-note')?.textContent?.includes('learning'))

  const suggestedTitle = await page.locator('.session-modal .session-field input').first().inputValue()
  console.log('suggested title:', suggestedTitle)
  if (suggestedTitle !== 'Learning Design Research') {
    throw new Error(`Expected learning-design suggestion, got ${suggestedTitle}`)
  }

  await page.locator('.session-modal-close').click()
  await page.getByRole('button', { name: '+ Session' }).click()
  await page.locator('.session-modal .session-field input').first().fill(tempTitle)
  await page.locator('.session-modal .session-field input').nth(1).fill('Temporary learning workflow test')
  await page.locator('.session-modal .session-field textarea').fill('Temporary session created by Playwright to verify create and edit flow.')
  await page.getByRole('button', { name: 'Save session' }).click()
  await page.locator('.session-title').filter({ hasText: tempTitle }).waitFor({ timeout: 10000 })

  const tempGroup = page.locator('.session-group').filter({ hasText: tempTitle })
  await tempGroup.hover()
  await tempGroup.locator('.session-edit').click({ force: true })
  await page.locator('.session-modal .session-field textarea').fill('Updated temporary context from the edit flow.')
  await page.getByRole('button', { name: 'Save session' }).click()
  await page.locator('.session-title').filter({ hasText: tempTitle }).waitFor({ timeout: 10000 })

  const sessionsRes = await api(page, '/api/research-sessions')
  const temp = (sessionsRes.data || []).find((session) => session.title === tempTitle)
  console.log('temporary session:', JSON.stringify({ title: temp?.title, context: temp?.context, pdf_count: temp?.pdf_count }))
  if (!temp || temp.context !== 'Updated temporary context from the edit flow.') {
    throw new Error('Temporary session edit did not persist')
  }
  if (temp.pdf_count !== 0) {
    throw new Error('Temporary session should not move existing PDFs unless explicitly checked and saved')
  }

  await cleanupTempSessions(page, titlePrefix)
  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
