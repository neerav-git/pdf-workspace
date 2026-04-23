const { chromium } = require('playwright')

async function selectTextOnPage(page, targetPage, minTextLen = 40) {
  // Navigate
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await page.waitForTimeout(200)
  const nav = await page.$('.viewer-page-input')
  if (nav) {
    await nav.click({ clickCount: 3 })
    await nav.fill(String(targetPage))
    await nav.press('Enter')
    await page.waitForTimeout(2500)
  }
  // Find a good span
  const span = await page.evaluate((minLen) => {
    const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
    for (const s of spans) {
      const t = s.textContent.trim()
      if (t.length < minLen) continue
      const r = s.getBoundingClientRect()
      if (r.y > 80 && r.y < 750 && r.width > 100 && r.x > 400) {
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: t.slice(0, 80) }
      }
    }
    return null
  }, minTextLen)
  if (!span) return null
  // Drag select
  await page.mouse.move(span.x + 4, span.y + span.h / 2)
  await page.mouse.down()
  await page.mouse.move(span.x + Math.min(span.w - 4, 220), span.y + span.h / 2, { steps: 15 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  const selected = await page.evaluate(() => window.getSelection()?.toString().trim())
  return { span, selected }
}

async function waitForResponse(page, minMsgCount, maxWait = 35000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    await page.waitForTimeout(500)
    const loading = await page.locator('.message-loading, [class*="loading"], [class*="typing"]').count()
    const msgs = await page.locator('.message').count()
    if (msgs >= minMsgCount && loading === 0) return true
  }
  return false
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.on('pageerror', e => console.log('[JS ERR] ' + e.message))

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await page.waitForTimeout(1500)

  // ═══════════════════════════════════════════════════════════════════
  // PHASE A: Inspect the sel-menu structure in detail
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== PHASE A: Selection menu anatomy ===')
  const sel1 = await selectTextOnPage(page, 15, 40)
  console.log('Selected: "' + sel1?.selected?.slice(0, 60) + '"')
  await page.screenshot({ path: '/tmp/s30_sel_menu_visible.png' })

  const menuAnatomy = await page.evaluate(() => {
    const menu = document.querySelector('.sel-menu')
    if (!menu) return null
    const s = getComputedStyle(menu)
    const r = menu.getBoundingClientRect()
    const btns = Array.from(menu.querySelectorAll('button, [role="button"], [class*="btn"], [class*="action"]'))
      .map(b => ({
        text: b.textContent?.trim().slice(0, 50),
        cls: b.className?.slice(0, 60),
        title: b.title || b.getAttribute('aria-label'),
        disabled: b.disabled
      }))
    const sections = Array.from(menu.querySelectorAll('[class*="section"], [class*="group"], div > div'))
      .slice(0, 5)
      .map(d => ({ cls: d.className?.slice(0, 50), text: d.textContent?.trim().slice(0, 80), childCount: d.children.length }))
    return {
      position: s.position,
      bg: s.backgroundColor,
      borderRadius: s.borderRadius,
      boxShadow: s.boxShadow ? 'yes' : 'no',
      size: { w: Math.round(r.width), h: Math.round(r.height) },
      pos: { x: Math.round(r.x), y: Math.round(r.y) },
      buttonCount: btns.length,
      buttons: btns,
      html_snippet: menu.innerHTML?.slice(0, 600)
    }
  })
  console.log('Menu anatomy: ' + JSON.stringify(menuAnatomy, null, 2))

  // Selection strip at bottom
  const selStrip = await page.evaluate(() => {
    const strip = document.querySelector('[class*="selection"]')
    if (!strip) return null
    return {
      cls: strip.className,
      text: strip.textContent?.trim().slice(0, 120),
      pos: { x: Math.round(strip.getBoundingClientRect().x), y: Math.round(strip.getBoundingClientRect().y) }
    }
  })
  console.log('Selection strip: ' + JSON.stringify(selStrip))

  // ═══════════════════════════════════════════════════════════════════
  // PHASE B: Click "Explain" and observe the chat response
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== PHASE B: Click Explain ===')
  const explainBtn = await page.locator('.sel-menu button, .sel-menu [class*="btn"]').filter({ hasText: /Explain/i }).first()
  const explainVisible = await explainBtn.isVisible().catch(() => false)
  console.log('Explain button visible: ' + explainVisible)
  if (explainVisible) {
    const msgsBefore = await page.locator('.message').count()
    await explainBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/s31_explain_clicked.png' })
    const ok = await waitForResponse(page, msgsBefore + 2)
    await page.screenshot({ path: '/tmp/s32_explain_response.png' })
    const msgsAfter = await page.locator('.message').count()
    console.log('Messages before/after Explain: ' + msgsBefore + ' → ' + msgsAfter)

    // Inspect the response
    const lastResp = await page.evaluate(() => {
      const msgs = document.querySelectorAll('.message-bubble')
      const last = msgs[msgs.length - 1]
      return {
        text: last?.textContent?.trim().slice(0, 300),
        hasMarkdown: !!last?.querySelector('strong, em, ul, ol, h1, h2, h3'),
        hasList: !!last?.querySelector('ul, ol')
      }
    })
    console.log('Explain response: ' + JSON.stringify(lastResp))

    const sources = await page.evaluate(() => {
      const s = document.querySelectorAll('.message-sources .source-badge')
      return Array.from(s).map(b => b.textContent?.trim())
    })
    console.log('Source badges: ' + JSON.stringify(sources))
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE C: Test source badge click (navigate PDF to page)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== PHASE C: Source badge click ===')
  const sourceBadges = await page.locator('.source-badge').all()
  console.log('Total source badges visible: ' + sourceBadges.length)
  if (sourceBadges.length > 0) {
    const badge = sourceBadges[0]
    const badgeText = await badge.textContent()
    const pageInfoBefore = await page.locator('.viewer-page-info').first().textContent()
    console.log('Clicking badge: "' + badgeText + '" (viewer at ' + pageInfoBefore + ')')
    await badge.click()
    await page.waitForTimeout(1500)
    const pageInfoAfter = await page.locator('.viewer-page-info').first().textContent()
    console.log('Viewer page after badge click: ' + pageInfoAfter)
    await page.screenshot({ path: '/tmp/s33_badge_navigate.png' })

    const navigated = pageInfoBefore !== pageInfoAfter
    console.log('Badge click navigated viewer: ' + navigated)
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE D: Select new text and click Save to Index (📌 or 📚)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== PHASE D: Save to Index ===')
  const sel2 = await selectTextOnPage(page, 20, 50)
  console.log('Selected for index: "' + sel2?.selected?.slice(0, 60) + '"')
  await page.waitForTimeout(500)

  // Find Save/Index button
  const saveBtn = await page.locator('.sel-menu button, .sel-menu [class*="btn"]')
    .filter({ hasText: /save|index|📌|📚/i }).first()
  const saveBtnText = await saveBtn.textContent().catch(() => '')
  console.log('Save button text: "' + saveBtnText + '"')

  const indexCountBefore = await page.locator('.idx-entry').count()
  console.log('Index entries before save: ' + indexCountBefore)

  const saveBtnVisible = await saveBtn.isVisible().catch(() => false)
  if (saveBtnVisible) {
    await saveBtn.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: '/tmp/s34_after_save.png' })

    // Switch to Index panel
    await page.click('button.chat-tab:last-child')
    await page.waitForTimeout(500)
    const indexCountAfter = await page.locator('.idx-entry').count()
    console.log('Index entries after save: ' + indexCountAfter)
    await page.screenshot({ path: '/tmp/s35_index_after_save.png' })

    // Inspect the new entry
    const newEntry = await page.evaluate(() => {
      const entries = document.querySelectorAll('.idx-entry')
      const last = entries[entries.length - 1]
      if (!last) return null
      return {
        text: last.textContent?.trim().slice(0, 200),
        hasConcepts: !!last.querySelector('.idx-concept-tag'),
        hasQA: !!last.querySelector('.idx-qa'),
        hasMeta: !!last.querySelector('.idx-entry-meta')
      }
    })
    console.log('New index entry: ' + JSON.stringify(newEntry))
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE E: In the index, click a Q&A action from hover menu (Quiz Me)
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== PHASE E: Hover menu Quiz Me action ===')
  // Go back to PDF, select new text, click Quiz Me
  await page.click('button.chat-tab:first-child') // back to chat view
  await page.waitForTimeout(300)

  const sel3 = await selectTextOnPage(page, 25, 50)
  console.log('Selected for Quiz: "' + sel3?.selected?.slice(0, 60) + '"')

  const quizBtn = await page.locator('.sel-menu button').filter({ hasText: /quiz/i }).first()
  const quizVisible = await quizBtn.isVisible().catch(() => false)
  console.log('Quiz Me visible: ' + quizVisible)
  if (quizVisible) {
    const msgsBefore = await page.locator('.message').count()
    await quizBtn.click()
    await waitForResponse(page, msgsBefore + 2)
    const lastResp = await page.evaluate(() => {
      const bubbles = document.querySelectorAll('.message-bubble')
      return bubbles[bubbles.length - 1]?.textContent?.trim().slice(0, 250)
    })
    console.log('Quiz response: "' + lastResp + '"')
    await page.screenshot({ path: '/tmp/s36_quiz_response.png' })
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE F: Check voice button functionality
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== PHASE F: Voice / mic button ===')
  // Check sel-menu "Ask by voice" option
  const sel4 = await selectTextOnPage(page, 25, 30)
  const voiceBtn = await page.locator('.sel-menu button').filter({ hasText: /voice/i }).first()
  const voiceBtnVisible = await voiceBtn.isVisible().catch(() => false)
  console.log('Ask by voice visible: ' + voiceBtnVisible)

  // Also check the global mic button in the input bar
  const micBtn = await page.locator('.mic-btn').first()
  const micVisible = await micBtn.isVisible().catch(() => false)
  const micTitle = await micBtn.getAttribute('title').catch(() => '')
  console.log('Global mic button visible: ' + micVisible + ' title: "' + micTitle + '"')

  // Click mic and see what happens (just inspect, no actual audio)
  if (micVisible) {
    await page.mouse.move(0, 0) // dismiss selection first
    await page.waitForTimeout(300)
    await micBtn.click()
    await page.waitForTimeout(800)
    const micState = await page.evaluate(() => {
      const m = document.querySelector('.mic-btn')
      return { cls: m?.className, isRecording: m?.classList.contains('recording') || m?.classList.contains('active') }
    })
    console.log('Mic state after click: ' + JSON.stringify(micState))
    // Dismiss
    await micBtn.click()
    await page.waitForTimeout(300)
  }
  await page.screenshot({ path: '/tmp/s37_final.png' })

  // ═══════════════════════════════════════════════════════════════════
  // PHASE G: sel-menu visual/UX audit
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== PHASE G: sel-menu UX audit ===')
  const sel5 = await selectTextOnPage(page, 30, 40)
  const menuUX = await page.evaluate(() => {
    const menu = document.querySelector('.sel-menu')
    if (!menu) return 'not found'
    const r = menu.getBoundingClientRect()
    const s = getComputedStyle(menu)
    // Check if menu clips outside viewport
    const clipsRight = r.right > window.innerWidth
    const clipsBottom = r.bottom > window.innerHeight
    const clipsTop = r.top < 0
    return {
      position: { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      clipsRight, clipsBottom, clipsTop,
      zIndex: s.zIndex,
      bg: s.backgroundColor,
      border: s.border,
    }
  })
  console.log('Menu UX: ' + JSON.stringify(menuUX, null, 2))
  await page.screenshot({ path: '/tmp/s38_menu_ux.png' })

  await browser.close()
  console.log('\n=== STEP 3 COMPLETE ===')
})()
