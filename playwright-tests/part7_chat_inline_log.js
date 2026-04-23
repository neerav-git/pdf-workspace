const { chromium } = require('playwright')

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

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1550, height: 920 } })

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
  await page.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 20000 })
  await page.waitForTimeout(1200)

  const q1 = 'How did the authors evaluate whether Paper Plain helps readers?'
  let assistantBefore = await page.locator('.message-assistant .message-bubble').count()
  await page.locator('.chat-input').fill(q1)
  await page.locator('.chat-send').click()
  if (!(await waitForAssistantResponse(page, assistantBefore))) fail('First grounded answer did not complete')

  const logButtonsAfterFirst = await page.locator('.message-assistant .message-log-btn').count()
  console.log('log buttons after first answer:', logButtonsAfterFirst)
  if (logButtonsAfterFirst < 1) fail('First grounded answer should expose an inline log button')

  const q2 = 'what did that show?'
  assistantBefore = await page.locator('.message-assistant .message-bubble').count()
  await page.locator('.chat-input').fill(q2)
  await page.locator('.chat-send').click()
  if (!(await waitForAssistantResponse(page, assistantBefore))) fail('Follow-up grounded answer did not complete')

  const logButtonsAfterSecond = await page.locator('.message-assistant .message-log-btn').count()
  console.log('log buttons after second answer:', logButtonsAfterSecond)
  if (logButtonsAfterSecond < 2) fail('Each grounded assistant response should keep its own inline log button')

  const lastLogBtn = page.locator('.message-assistant .message-log-btn').last()
  await lastLogBtn.click()
  await page.waitForTimeout(1400)

  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(800)

  const firstQALabel = await page.locator('.idx-qa-q-text').first().textContent().catch(() => '')
  console.log('saved QA label:', firstQALabel)
  if (!firstQALabel) fail('Saved inline chat card did not appear in the index')
  if (/^what did that show\??$/i.test((firstQALabel || '').trim())) {
    fail('Saved chat card question should be reframed into a clearer standalone study question')
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
