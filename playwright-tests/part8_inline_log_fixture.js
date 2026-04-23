const { chromium } = require('playwright')
const fs = require('fs')

const FIXTURE_PATH = '/tmp/chat-inline-fixture.pdf'

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exitCode = 1
}

async function waitForAssistantResponse(page, previousCount, timeoutMs = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const loading = await page.locator('.message-loading, .typing, [class*="typing"]').count()
    const bubbles = await page.locator('.message-assistant .message-bubble').count()
    if (bubbles > previousCount && loading === 0) return true
    await page.waitForTimeout(500)
  }
  return false
}

async function ensureFixturePdfSelected(page) {
  const existing = page.locator('.pdf-item').filter({ hasText: /chat-inline-fixture/i }).first()
  if (await existing.isVisible().catch(() => false)) {
    await existing.click()
    return
  }

  await page.locator('input[type=\"file\"]').setInputFiles(FIXTURE_PATH)
  await page.locator('.pdf-item').filter({ hasText: /chat-inline-fixture/i }).first().click({ timeout: 45000 })
}

async function ensureSecondFixturePdf(page) {
  const existing = page.locator('.pdf-item').filter({ hasText: /chat-inline-fixture-b/i }).first()
  if (await existing.isVisible().catch(() => false)) return

  await page.locator('input[type="file"]').setInputFiles({
    name: 'chat-inline-fixture-b.pdf',
    mimeType: 'application/pdf',
    buffer: fs.readFileSync(FIXTURE_PATH),
  })
  await page.locator('.pdf-item').filter({ hasText: /chat-inline-fixture-b/i }).first().waitFor({ timeout: 45000 })
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1550, height: 920 } })

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  await ensureFixturePdfSelected(page)
  await ensureSecondFixturePdf(page)
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 30000 })
  await page.waitForTimeout(1200)

  const q1 = 'How was the system evaluated?'
  let assistantBefore = await page.locator('.message-assistant .message-bubble').count()
  await page.locator('.chat-input').fill(q1)
  await page.locator('.chat-send').click()
  if (!(await waitForAssistantResponse(page, assistantBefore))) fail('First fixture question did not produce a completed answer')

  await page.locator('.pdf-item').filter({ hasText: /chat-inline-fixture-b/i }).first().click()
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 30000 })
  await page.waitForTimeout(800)
  await page.locator('.pdf-item').filter({ hasText: /chat-inline-fixture/i }).first().click()
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 30000 })
  await page.waitForTimeout(800)

  const restoredUserQuestion = await page.locator('.message-user .message-bubble').filter({ hasText: q1 }).count()
  console.log('restored user questions:', restoredUserQuestion)
  if (restoredUserQuestion < 1) fail('Chat history should persist when switching away from a PDF and back')

  const q2 = 'what did that show?'
  assistantBefore = await page.locator('.message-assistant .message-bubble').count()
  await page.locator('.chat-input').fill(q2)
  await page.locator('.chat-send').click()
  if (!(await waitForAssistantResponse(page, assistantBefore))) fail('Follow-up fixture question did not produce a completed answer')

  const logButtons = await page.locator('.message-assistant .message-log-btn').count()
  console.log('fixture log button count:', logButtons)
  if (logButtons < 2) fail('Each grounded assistant response should keep its own inline log button on the fixture document')

  await page.locator('.message-assistant .message-log-btn').last().click()
  await page.waitForTimeout(1500)

  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(800)

  const firstQALabel = await page.locator('.idx-qa-q-text').first().textContent().catch(() => '')
  const derivedQuestion = await page.locator('.idx-qa-derived-question').first().textContent().catch(() => '')
  console.log('fixture saved QA label:', firstQALabel)
  console.log('fixture derived question:', derivedQuestion)
  if (!firstQALabel) fail('Inline log action did not create an index Q&A on the fixture document')
  if (!/^what did that show\??$/i.test((firstQALabel || '').trim())) {
    fail('Index should preserve the original chat question for recognizability')
  }
  if (!/Saved as:/i.test(derivedQuestion || '')) {
    fail('Index should also expose the reframed study question after logging')
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
