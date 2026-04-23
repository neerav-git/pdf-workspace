const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.on('pageerror', e => console.log('[JS ERR] ' + e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('[CONSOLE ERR] ' + m.text()) })

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await page.waitForTimeout(1500)

  // ── Navigate to page 8 (has body text paragraphs) ────────────────────────
  console.log('\n=== PHASE 1: Navigate to body-text page ===')
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await page.waitForTimeout(200)
  const navInput = await page.$('.viewer-page-input')
  if (navInput) {
    await navInput.click({ clickCount: 3 })
    await navInput.fill('8')
    await navInput.press('Enter')
    await page.waitForTimeout(3000)
  }
  await page.screenshot({ path: '/tmp/s20_page8.png' })
  console.log('Navigated to page 8')

  // ── Inspect what text is actually on screen ───────────────────────────────
  console.log('\n=== PHASE 2: Text layer analysis ===')
  const textData = await page.evaluate(() => {
    const layers = document.querySelectorAll('.react-pdf__Page__textContent')
    const result = []
    layers.forEach((layer, li) => {
      const spans = Array.from(layer.querySelectorAll('span[role="presentation"], span'))
        .filter(s => s.textContent.trim().length > 10)
      result.push({
        layerIdx: li,
        spanCount: layer.querySelectorAll('span').length,
        nonEmptySpans: spans.length,
        samples: spans.slice(0, 8).map(s => {
          const r = s.getBoundingClientRect()
          return { text: s.textContent.trim().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }
        })
      })
    })
    return result
  })
  console.log('Text layers: ' + JSON.stringify(textData, null, 2))

  // ── Attempt drag-selection on visible text span ───────────────────────────
  console.log('\n=== PHASE 3: Text drag selection ===')

  // Find first span with enough text to select
  const spanPos = await page.evaluate(() => {
    const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
    for (const span of spans) {
      const t = span.textContent.trim()
      if (t.length < 20) continue
      const r = span.getBoundingClientRect()
      if (r.y > 60 && r.y < 800 && r.width > 100) {
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: t.slice(0, 60) }
      }
    }
    return null
  })
  console.log('First good span: ' + JSON.stringify(spanPos))

  if (spanPos) {
    // Drag across the span
    await page.mouse.move(spanPos.x + 5, spanPos.y + spanPos.h / 2)
    await page.mouse.down()
    await page.mouse.move(spanPos.x + Math.min(spanPos.w, 250), spanPos.y + spanPos.h / 2, { steps: 20 })
    await page.mouse.up()
    await page.waitForTimeout(1200)

    const selected = await page.evaluate(() => window.getSelection()?.toString().trim().slice(0, 100))
    console.log('Selected text: "' + selected + '"')
    await page.screenshot({ path: '/tmp/s21_after_selection.png' })

    // Wait for hover menu with retries
    let menuFound = null
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.waitForTimeout(300)
      menuFound = await page.evaluate(() => {
        const candidates = [
          '.hover-menu', '[class*="hover-menu"]',
          '.selection-toolbar', '[class*="selection"]',
          '[class*="text-menu"]', '[class*="TextMenu"]',
          '[class*="popup"]', '[class*="Popup"]',
        ]
        for (const sel of candidates) {
          const el = document.querySelector(sel)
          if (!el) continue
          const s = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          if (s.display !== 'none' && r.width > 10 && r.height > 10) {
            return { sel, text: el.textContent?.trim().slice(0, 200), w: r.width, h: r.height, x: r.x, y: r.y }
          }
        }
        return null
      })
      if (menuFound) break
    }
    console.log('Hover menu found: ' + JSON.stringify(menuFound))

    // Broader scan — anything new and floating
    const floating = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).filter(el => {
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return (s.position === 'fixed' || s.position === 'absolute') &&
          r.width > 40 && r.height > 20 && r.y > 40 && r.y < 860 &&
          r.x > 0 && el.textContent.trim().length > 0 &&
          !el.closest('.viewer-toolbar') && !el.closest('.viewer-toc')
      }).map(el => ({
        cls: el.className?.toString().slice(0, 80),
        text: el.textContent?.trim().slice(0, 100),
        pos: { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y) },
        size: { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }
      })).slice(0, 20)
    })
    console.log('Floating elements: ' + JSON.stringify(floating, null, 2))
  }

  // ── Try a different page (page 15 — definite prose) ──────────────────────
  console.log('\n=== PHASE 4: Try page 15 with mouse-move hover ===')
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await page.waitForTimeout(200)
  const nav2 = await page.$('.viewer-page-input')
  if (nav2) {
    await nav2.click({ clickCount: 3 })
    await nav2.fill('15')
    await nav2.press('Enter')
    await page.waitForTimeout(3000)
  }
  await page.screenshot({ path: '/tmp/s22_page15.png' })

  const span15 = await page.evaluate(() => {
    const spans = document.querySelectorAll('.react-pdf__Page__textContent span')
    for (const span of spans) {
      const t = span.textContent.trim()
      if (t.length < 30) continue
      const r = span.getBoundingClientRect()
      if (r.y > 80 && r.y < 750 && r.width > 150) {
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: t.slice(0, 80) }
      }
    }
    return null
  })
  console.log('Span on page 15: ' + JSON.stringify(span15))

  if (span15) {
    // Triple click to select line
    await page.mouse.click(span15.x + 20, span15.y + span15.h / 2, { clickCount: 3 })
    await page.waitForTimeout(1200)
    const sel15 = await page.evaluate(() => window.getSelection()?.toString().trim().slice(0, 100))
    console.log('Triple-click selection: "' + sel15 + '"')
    await page.screenshot({ path: '/tmp/s23_triple_click.png' })

    // Scan for menus again
    const menu15 = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).filter(el => {
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return (s.position === 'fixed' || s.position === 'absolute') &&
          r.width > 40 && r.height > 20 && r.y > 40 && r.y < 860 &&
          r.x > 0 && el.textContent.trim().length > 3 &&
          !el.closest('.viewer-toolbar') && !el.closest('.viewer-toc') &&
          !el.closest('.viewer-canvas-wrap') // exclude page wrappers
      }).map(el => ({
        cls: el.className?.toString().slice(0, 80),
        text: el.textContent?.trim().slice(0, 80),
        pos: { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y) },
        size: { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }
      })).slice(0, 15)
    })
    console.log('Floating elements page 15: ' + JSON.stringify(menu15, null, 2))
  }

  // ── Check how hover menu is triggered — look at event listeners ──────────
  console.log('\n=== PHASE 5: Hover menu trigger mechanism ===')
  const triggerMechanism = await page.evaluate(() => {
    // Check if there's a mouseup listener on the document or text layer
    const textLayers = document.querySelectorAll('.react-pdf__Page__textContent')
    return {
      textLayerCount: textLayers.length,
      // Check for any element with class containing 'hover' that exists but is hidden
      hiddenHoverMenus: Array.from(document.querySelectorAll('[class*="hover"]')).map(el => ({
        cls: el.className.slice(0, 60),
        display: getComputedStyle(el).display,
        visibility: getComputedStyle(el).visibility,
        opacity: getComputedStyle(el).opacity,
        text: el.textContent?.trim().slice(0, 60)
      })).filter(x => x.text.length > 0)
    }
  })
  console.log('Trigger mechanism: ' + JSON.stringify(triggerMechanism, null, 2))

  // ── Check React component names via __reactFiber ─────────────────────────
  console.log('\n=== PHASE 6: React component tree scan ===')
  const reactComponents = await page.evaluate(() => {
    const names = new Set()
    document.querySelectorAll('[class]').forEach(el => {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))
      if (!key) return
      let fiber = el[key]
      while (fiber) {
        if (fiber.type && typeof fiber.type === 'function' && fiber.type.name) {
          names.add(fiber.type.name)
        }
        fiber = fiber.return
        if (names.size > 40) break
      }
    })
    return Array.from(names).sort()
  })
  console.log('React components on page: ' + JSON.stringify(reactComponents))

  await page.screenshot({ path: '/tmp/s24_final_state.png' })
  await browser.close()
  console.log('\n=== PHASE 1-6 COMPLETE ===')
})()
