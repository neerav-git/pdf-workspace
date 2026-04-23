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

async function jumpToPage(page, pageNum) {
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await page.waitForTimeout(150)
  const nav = await page.$('.viewer-page-input')
  if (!nav) return
  await nav.click({ clickCount: 3 })
  await nav.fill(String(pageNum))
  await nav.press('Enter')
  await page.waitForTimeout(2200)
}

async function programmaticSelect(page, startIdx, endIdx) {
  return page.evaluate(({ startIdx, endIdx }) => {
    const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
    if (!spans[startIdx] || !spans[endIdx]) return { ok: false, reason: 'missing spans' }
    const startNode = spans[startIdx].firstChild || spans[startIdx]
    const endNode = spans[endIdx].firstChild || spans[endIdx]
    const range = document.createRange()
    range.setStart(startNode, 0)
    range.setEnd(endNode, (endNode.textContent || '').length)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    const rect = range.getBoundingClientRect()
    const canvasWrap = document.querySelector('.viewer-canvas-wrap')
    canvasWrap?.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 4, clientY: rect.bottom - 2 }),
    )
    return { ok: true, text: sel.toString().trim().slice(0, 200) }
  }, { startIdx, endIdx })
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1550, height: 920 } })

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
  await page.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first().click()
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 20000 })
  await page.waitForTimeout(1200)

  // 1. Ask a representative document question and ensure it is grounded.
  const chatQuestion = 'What are the four NLP-powered features of Paper Plain?'
  const assistantBefore = await page.locator('.message-assistant .message-bubble').count()
  await page.locator('.chat-input').fill(chatQuestion)
  await page.locator('.chat-send').click()
  const gotAnswer = await waitForAssistantResponse(page, assistantBefore)
  if (!gotAnswer) fail('Document question did not produce a completed assistant response')

  const lastAnswer = await page.locator('.message-assistant .message-bubble').last().textContent()
  const sources = await page.locator('.message-sources .source-badge').allTextContents().catch(() => [])
  console.log('answer preview:', (lastAnswer || '').slice(0, 280))
  console.log('sources:', JSON.stringify(sources))
  if (!/definitions|summaries|questions|gists|features/i.test(lastAnswer || '')) {
    fail('Representative paper question did not return a recognizably relevant answer')
  }
  if (sources.length === 0) fail('Representative paper question should expose grounding sources')

  // 2. Create a retrieval-oriented study card from a passage using Quiz Me.
  await jumpToPage(page, 3)
  const candidateRanges = [
    [20, 28],
    [28, 36],
    [36, 44],
    [44, 52],
  ]
  let selection = null
  let quizVisible = false
  for (const [startIdx, endIdx] of candidateRanges) {
    selection = await programmaticSelect(page, startIdx, endIdx)
    console.log('selection attempt:', JSON.stringify({ startIdx, endIdx, selection }))
    await page.waitForTimeout(700)
    quizVisible = await page.locator('.sel-menu button').filter({ hasText: 'Quiz Me' }).first().isVisible().catch(() => false)
    if (selection.ok && quizVisible) break
  }
  if (!selection?.ok) fail('Could not establish a text selection for Quiz Me workflow')
  if (!quizVisible) fail('Selection menu did not expose Quiz Me')

  const assistantBeforeQuiz = await page.locator('.message-assistant .message-bubble').count()
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.sel-menu button'))
      .find((el) => /quiz me/i.test(el.textContent || ''))
    btn?.click()
  })
  const quizAnswered = await waitForAssistantResponse(page, assistantBeforeQuiz)
  if (!quizAnswered) fail('Quiz Me did not produce a completed assistant response')

  const quizResponse = await page.locator('.message-assistant .message-bubble').last().textContent()
  console.log('quiz response preview:', (quizResponse || '').slice(0, 280))
  if (!/Question:|Question|Answer:/i.test(quizResponse || '')) {
    fail('Quiz Me response did not contain a recognizable question/answer structure')
  }

  const inlineLogBtn = page.locator('.message-assistant .message-log-btn').last()
  const inlineLogText = await inlineLogBtn.textContent().catch(() => '')
  console.log('inline log button:', inlineLogText)
  if (!/Log to Index/i.test(inlineLogText || '')) fail('Quiz response should expose inline log-to-index action')

  await inlineLogBtn.click()
  await page.waitForTimeout(1200)

  // 3. Verify the saved card appears in the index with retrieval-oriented labeling.
  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.waitForTimeout(600)

  const reviewBar = await page.locator('.idx-review-bar').textContent()
  console.log('review bar after save:', reviewBar)
  if (!/Review This PDF/i.test(reviewBar || '')) fail('Index should still show PDF-scoped review CTA after saving a quiz card')

  const focusTitles = await page.locator('.idx-entry-focus-title').allTextContents()
  const focusSubtitles = await page.locator('.idx-entry-focus-subtitle').allTextContents()
  console.log('focus titles:', JSON.stringify(focusTitles))
  console.log('focus subtitles:', JSON.stringify(focusSubtitles))
  if (!focusSubtitles.some((t) => /Retrieval practice/i.test(t))) {
    fail('Index should contain at least one retrieval-oriented study card subtitle after Quiz Me save')
  }

  // 4. Verify the review flow opens with the correct scope from the paper index.
  await page.locator('.idx-review-btn').first().click()
  await page.waitForTimeout(800)
  const scopeLabel = await page.locator('.rv-scope-label').textContent().catch(() => '')
  console.log('review scope label:', scopeLabel)
  if (!/Due Cards for This PDF/i.test(scopeLabel || '')) {
    fail('PDF-scoped review should open with the correct scope label')
  }

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
