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

async function waitForEither(page, selectors, timeoutMs = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const selector of selectors) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) {
        return selector
      }
    }
    await page.waitForTimeout(400)
  }
  return null
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1550, height: 920 } })

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
  await page.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 20000 })
  await page.waitForTimeout(1200)

  const chatQuestion = 'How did the authors evaluate whether Paper Plain helps readers?'
  const assistantBefore = await page.locator('.message-assistant .message-bubble').count()
  await page.locator('.chat-input').fill(chatQuestion)
  await page.locator('.chat-send').click()

  const gotAnswer = await waitForAssistantResponse(page, assistantBefore)
  if (!gotAnswer) fail('Chat question did not produce a completed assistant response')

  const lastAnswer = await page.locator('.message-assistant .message-bubble').last().textContent()
  const sources = await page.locator('.message-sources .source-badge').allTextContents().catch(() => [])
  console.log('answer preview:', (lastAnswer || '').slice(0, 280))
  console.log('sources:', JSON.stringify(sources))
  if (!/study|participants|evaluation|comprehension|survey|interview/i.test(lastAnswer || '')) {
    fail('Chat answer did not look relevant to the evaluation question')
  }
  if (sources.length === 0) fail('Chat answer should expose grounding sources')

  const inlineLogBtn = page.locator('.message-assistant .message-log-btn').last()
  const inlineLogText = await inlineLogBtn.textContent().catch(() => '')
  console.log('inline log button:', inlineLogText)
  if (!/Log to Index/i.test(inlineLogText || '')) fail('Non-selection chat should expose inline log-to-index action')

  await inlineLogBtn.click()
  await page.waitForTimeout(1200)

  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(900)

  const qTextVisible = await page.locator('.idx-qa-q-text').filter({ hasText: /How did the authors evaluate whether Paper Plain helps readers/i }).first().isVisible().catch(() => false)
  console.log('manual question visible in index:', qTextVisible)
  if (!qTextVisible) fail('Saved chat Q&A should appear in the index with the original question as label')

  const synthesisSelector = await waitForEither(page, ['.idx-synthesis-trigger', '.idx-synthesis-deep-btn'], 8000)
  if (!synthesisSelector) fail('No synthesis action was available in the index')

  if (synthesisSelector === '.idx-synthesis-trigger') {
    await page.locator('.idx-synthesis-trigger').first().click()
    const deepButtonSelector = await waitForEither(page, ['.idx-synthesis-deep-btn'], 45000)
    if (!deepButtonSelector) fail('Summary synthesis did not complete')
  }

  const deepButton = page.locator('.idx-synthesis-deep-btn').filter({ hasText: /Dive deeper/i }).first()
  const deepButtonVisible = await deepButton.isVisible().catch(() => false)
  if (!deepButtonVisible) fail('Dive deeper control was not available after summary synthesis')

  await deepButton.click()
  const deepBlockSelector = await waitForEither(page, ['.idx-synthesis-deep-block'], 45000)
  if (!deepBlockSelector) fail('Deep synthesis did not render')

  const deepLabel = await page.locator('.idx-synthesis-deep-label').first().textContent().catch(() => '')
  const deepText = await page.locator('.idx-synthesis-deep-text').first().textContent().catch(() => '')
  console.log('deep synthesis label:', deepLabel)
  console.log('deep synthesis preview:', (deepText || '').slice(0, 280))
  if (!/Deep synthesis/i.test(deepLabel || '')) fail('Deep synthesis block should be labeled clearly')
  if ((deepText || '').length < 120) fail('Deep synthesis should contain a materially expanded summary')

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
