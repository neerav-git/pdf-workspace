/**
 * Inject diagnostic hooks into the running app to trace applyLensToPage.
 */
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

  const logs = []
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await page.waitForTimeout(1500)

  // Navigate to page 7
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await page.waitForTimeout(200)
  const input = await page.$('.viewer-page-input')
  if (input) {
    await input.click({ clickCount: 3 })
    await input.fill('7')
    await input.press('Enter')
  }
  await page.waitForTimeout(3000)

  // Enable lens
  await page.click('.viewer-lens-btn').catch(() => {})
  await page.waitForTimeout(1500)

  // Run the full overlay creation manually in the browser using the exact same
  // logic as applyLensToPage, with verbose logging at each step.
  const result = await page.evaluate(() => {
    const log = []

    // ── Replicate the exact logic of applyLensToPage ──────────────────────────
    // 1. Find all viewer-page-wrapper divs and their page numbers
    const wrappers = Array.from(document.querySelectorAll('.viewer-page-wrapper'))
    log.push(`Found ${wrappers.length} page wrappers`)

    // 2. Check what data-page attribute or index they have
    wrappers.forEach((w, i) => {
      const tl = w.querySelector('.textLayer')
      const spans = tl ? tl.querySelectorAll('span').length : 0
      log.push(`  wrapper[${i}] data-page=${w.dataset.page} spans=${spans} pos=${getComputedStyle(w).position}`)
    })

    // 3. Try to find the wrapper for page 7
    const p7wrapper = document.querySelector('[data-page="7"]')
    log.push(`Wrapper for page 7: ${p7wrapper ? 'FOUND' : 'NOT FOUND'}`)
    if (!p7wrapper) return { log }

    const tl7 = p7wrapper.querySelector('.textLayer')
    log.push(`Text layer in page 7 wrapper: ${tl7 ? 'FOUND' : 'NOT FOUND'}`)
    if (!tl7) return { log }

    const spans7 = tl7.querySelectorAll('span').length
    log.push(`Spans in page 7 text layer: ${spans7}`)

    // 4. Run findTextRange manually with strategy 3
    const searchText = 'A preliminary list of diseases, disorders, tests and treatments was compiled from a wide variety of sources, including professional medical guides and textbooks as well as consumer guides and encyclopedias.'
    const anchor60 = searchText.replace(/[\s-]/g, '').slice(0, 60).toLowerCase()

    // Walk text nodes
    const walker = document.createTreeWalker(tl7, NodeFilter.SHOW_TEXT)
    const nodes = []
    let n
    while ((n = walker.nextNode())) nodes.push(n)
    log.push(`Text nodes in page 7 layer: ${nodes.length}`)

    let flat = ''
    for (const nd of nodes) flat += nd.textContent
    const flatDehyph = flat.replace(/[\s-]/g, '').toLowerCase()
    const idx = flatDehyph.indexOf(anchor60)
    log.push(`Strategy 3 match at index: ${idx} (flat length: ${flat.length})`)
    log.push(`Flat text sample: "${flat.slice(0, 80)}"`)
    log.push(`Dehyph anchor: "${anchor60.slice(0, 40)}..."`)

    if (idx === -1) {
      log.push('Strategy 3 FAILED — text not found')
      return { log }
    }

    // 5. Try creating a range and get rects
    // Find flat→node mapping
    const src = []
    for (const nd of nodes) {
      for (let ci = 0; ci < nd.textContent.length; ci++) {
        src.push({ node: nd, offset: ci })
      }
    }

    // strip mapping
    const i2f = []
    let stripped = ''
    for (let fi = 0; fi < flat.length; fi++) {
      if (!/[\s-]/.test(flat[fi])) { stripped += flat[fi]; i2f.push(fi) }
    }
    const anchorS = searchText.slice(0, 60).replace(/[\s-]/g, '')
    const si2 = stripped.toLowerCase().indexOf(anchorS.toLowerCase())
    log.push(`Stripped index: ${si2}`)

    if (si2 === -1) { log.push('Stripped search failed'); return { log } }

    const fullS = searchText.replace(/[\s-]/g, '').slice(0, 300)
    const flatStart = i2f[si2]
    const flatEnd = i2f[Math.min(si2 + fullS.length - 1, i2f.length - 1)]
    log.push(`flatStart: ${flatStart}, flatEnd: ${flatEnd}`)

    if (flatStart === undefined || flatEnd === undefined) { log.push('Index out of range'); return { log } }

    const sn = src[flatStart]
    const en = src[flatEnd]
    log.push(`Start node text: "${sn?.node?.textContent?.slice(0,20)}", End node text: "${en?.node?.textContent?.slice(0,20)}"`)

    let range = null
    try {
      range = document.createRange()
      range.setStart(sn.node, sn.offset)
      range.setEnd(en.node, Math.min(en.offset + 1, en.node.textContent.length))
      log.push('Range created successfully')
    } catch(e) {
      log.push(`Range creation failed: ${e.message}`)
      return { log }
    }

    // 6. Get client rects
    const rects = range.getClientRects()
    log.push(`getClientRects returned ${rects.length} rects`)
    const wrapperRect = p7wrapper.getBoundingClientRect()
    log.push(`Wrapper rect: left=${Math.round(wrapperRect.left)} top=${Math.round(wrapperRect.top)} w=${Math.round(wrapperRect.width)} h=${Math.round(wrapperRect.height)}`)

    const validRects = []
    for (const r of rects) {
      if (r.width >= 1 && r.height >= 1) {
        validRects.push({ l: Math.round(r.left - wrapperRect.left), t: Math.round(r.top - wrapperRect.top), w: Math.round(r.width), h: Math.round(r.height) })
      }
    }
    log.push(`Valid rects (w>=1, h>=1): ${validRects.length}`)
    if (validRects.length) {
      log.push(`First rect: ${JSON.stringify(validRects[0])}`)
      log.push(`Last rect: ${JSON.stringify(validRects[validRects.length-1])}`)
    }

    // 7. Create overlay divs manually
    if (validRects.length > 0) {
      validRects.slice(0, 3).forEach((r) => {
        const div = document.createElement('div')
        div.className = 'pdf-hl-overlay pdf-hl-flash TEST-MANUAL'
        div.style.cssText = `position:absolute;left:${r.l}px;top:${r.t}px;width:${r.w}px;height:${r.h}px;background:rgba(255,0,0,0.7);pointer-events:none;z-index:10;`
        p7wrapper.appendChild(div)
      })
      log.push(`Created ${Math.min(3, validRects.length)} TEST overlay divs`)
    }

    const totalOverlays = document.querySelectorAll('.pdf-hl-overlay').length
    log.push(`Total overlays in DOM now: ${totalOverlays}`)

    return { log, validRects: validRects.slice(0, 3) }
  })

  console.log('=== DIAGNOSTIC LOG ===')
  result.log.forEach(l => console.log(l))
  if (result.validRects) {
    console.log('\nValid rects:', JSON.stringify(result.validRects, null, 2))
  }

  // Final overlay check
  const finalOverlays = await page.evaluate(() => document.querySelectorAll('.pdf-hl-overlay').length)
  console.log(`\nFinal overlay count in DOM: ${finalOverlays}`)

  // App console logs (may include errors from applyLensToPage)
  console.log('\n── App logs ──')
  const appLogs = logs.filter(l => !l.includes('[vite]') && !l.includes('DevTools'))
  appLogs.forEach(l => console.log(l))

  await browser.close()
})()
