const { chromium } = require('playwright')

async function navTo(page, pageNum) {
  await page.click('.viewer-page-info.clickable').catch(() => {})
  await page.waitForTimeout(150)
  const nav = await page.$('.viewer-page-input')
  if (nav) {
    await nav.click({ clickCount: 3 })
    await nav.fill(String(pageNum))
    await nav.press('Enter')
    await page.waitForTimeout(2500)
  }
}

async function selectAndSave(page, pageNum, minLen = 50) {
  await navTo(page, pageNum)
  const span = await page.evaluate((minLen) => {
    for (const s of document.querySelectorAll('.react-pdf__Page__textContent span')) {
      const t = s.textContent.trim()
      if (t.length < minLen) continue
      const r = s.getBoundingClientRect()
      if (r.y > 80 && r.y < 720 && r.width > 120 && r.x > 400) {
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: t.slice(0, 80) }
      }
    }
    return null
  }, minLen)
  if (!span) return false
  await page.mouse.move(span.x + 4, span.y + span.h / 2)
  await page.mouse.down()
  await page.mouse.move(span.x + Math.min(span.w - 4, 200), span.y + span.h / 2, { steps: 15 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  // Click Save note to add to index directly
  const saveBtn = await page.locator('.sel-menu button[title="Save note"]').first()
  if (await saveBtn.isVisible().catch(() => false)) {
    await saveBtn.click()
    await page.waitForTimeout(800)
    return true
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

  // ═══════════════════════════════════════════════════════════════
  // PHASE A: Seed multiple entries across different pages
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE A: Seed index entries across pages ===')
  const pages = [15, 22, 35, 50]
  for (const p of pages) {
    const saved = await selectAndSave(page, p)
    console.log('Page ' + p + ' saved: ' + saved)
  }

  // Switch to Index tab
  await page.click('button.chat-tab:last-child')
  await page.waitForTimeout(600)

  const totalEntries = await page.locator('.idx-entry').count()
  console.log('Total index entries after seeding: ' + totalEntries)
  await page.screenshot({ path: '/tmp/s40_index_seeded.png' })

  // ═══════════════════════════════════════════════════════════════
  // PHASE B: By Page view — structure, layout, scroll
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE B: By Page view ===')
  // Should already be on By Page tab
  const byPageBtn = await page.locator('.idx-view-tab').filter({ hasText: /by page|page/i }).first()
  await byPageBtn.click().catch(() => {})
  await page.waitForTimeout(300)

  const pageViewData = await page.evaluate(() => {
    const sections = document.querySelectorAll('.idx-page-section')
    const result = []
    sections.forEach(sec => {
      const heading = sec.querySelector('.idx-page-num')
      const entries = sec.querySelectorAll('.idx-entry')
      result.push({
        pageLabel: heading?.textContent?.trim(),
        entryCount: entries.length,
        firstEntry: entries[0]?.querySelector('.idx-entry-text')?.textContent?.trim().slice(0, 60)
      })
    })
    return result
  })
  console.log('By Page sections: ' + JSON.stringify(pageViewData, null, 2))

  // Check sticky page heading
  const stickyCheck = await page.evaluate(() => {
    const heading = document.querySelector('.idx-page-heading')
    return heading ? getComputedStyle(heading).position : null
  })
  console.log('Page heading position (sticky?): ' + stickyCheck)

  // Stats bar
  const statsBar = await page.evaluate(() => {
    const s = document.querySelector('.idx-stats')
    return s?.textContent?.trim()
  })
  console.log('Stats bar text: ' + statsBar)

  // ═══════════════════════════════════════════════════════════════
  // PHASE C: By Section view
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE C: By Section view ===')
  const bySectionBtn = await page.locator('.idx-view-tab').filter({ hasText: /section/i }).first()
  await bySectionBtn.click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/s41_by_section.png' })

  const sectionViewData = await page.evaluate(() => {
    const h1s = document.querySelectorAll('.idx-h1-section')
    const result = []
    h1s.forEach(h1 => {
      const title = h1.querySelector('.idx-h1-title')?.textContent?.trim()
      const h2s = h1.querySelectorAll('.idx-h2-block')
      const entries = h1.querySelectorAll('.idx-entry')
      result.push({ h1: title, h2Count: h2s.length, entryCount: entries.length })
    })
    // Fallback: flat section view
    const flat = document.querySelectorAll('.idx-section-heading')
    const flatSections = Array.from(flat).map(s => s.textContent?.trim().slice(0, 60))
    return { h1Sections: result, flatSections }
  })
  console.log('By Section data: ' + JSON.stringify(sectionViewData, null, 2))

  // ═══════════════════════════════════════════════════════════════
  // PHASE D: Concepts view
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE D: Concepts view ===')
  const conceptsBtn = await page.locator('.idx-view-tab').filter({ hasText: /concept/i }).first()
  await conceptsBtn.click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/s42_concepts.png' })

  const conceptsData = await page.evaluate(() => {
    const chips = document.querySelectorAll('.idx-concept-chip')
    const bar = document.querySelector('.idx-concept-bar')
    return {
      chipCount: chips.length,
      chips: Array.from(chips).slice(0, 10).map(c => ({
        text: c.textContent?.trim(),
        active: c.classList.contains('active')
      })),
      barVisible: !!bar,
      hasEntries: !!document.querySelector('.idx-entry')
    }
  })
  console.log('Concepts view: ' + JSON.stringify(conceptsData, null, 2))

  // Click first concept chip
  const firstChip = await page.locator('.idx-concept-chip').first()
  if (await firstChip.isVisible().catch(() => false)) {
    const chipText = await firstChip.textContent()
    await firstChip.click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: '/tmp/s43_concept_filtered.png' })
    const filteredEntries = await page.locator('.idx-entry').count()
    console.log('Chip "' + chipText?.trim() + '" → filtered entries: ' + filteredEntries)
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE E: Curated / Starred view
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE E: Curated / Starred view ===')
  const curatedBtn = await page.locator('.idx-view-tab').filter({ hasText: /curated|starred/i }).first()
  await curatedBtn.click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/s44_curated.png' })

  const curatedData = await page.evaluate(() => {
    const items = document.querySelectorAll('.idx-starred-item')
    const empty = document.querySelector('.idx-empty')
    const filterBtns = document.querySelectorAll('.idx-filter-btn, [class*="filter"]')
    return {
      starredItemCount: items.length,
      emptyMessage: empty?.textContent?.trim().slice(0, 80),
      filterButtons: Array.from(filterBtns).map(b => b.textContent?.trim().slice(0, 30))
    }
  })
  console.log('Curated view: ' + JSON.stringify(curatedData))

  // ═══════════════════════════════════════════════════════════════
  // PHASE F: Entry expansion — full anatomy
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE F: Entry expansion anatomy ===')
  // Go back to By Page, expand first entry
  await byPageBtn.click()
  await page.waitForTimeout(300)

  const firstEntry = await page.locator('.idx-entry').first()
  await firstEntry.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/s45_entry_expanded.png' })

  const expandedData = await page.evaluate(() => {
    const entry = document.querySelector('.idx-entry')
    if (!entry) return null
    return {
      isOpen: entry.classList.contains('open') || !!entry.querySelector('.idx-qa-list'),
      hasCurationBar: !!entry.querySelector('.idx-curation-bar, .idx-curation-btn'),
      hasConceptChips: !!entry.querySelector('.idx-concept-tag'),
      hasQAList: !!entry.querySelector('.idx-qa-list'),
      hasNoteSection: !!entry.querySelector('.idx-note-wrap, .idx-note-add'),
      hasSynthesisSection: !!entry.querySelector('.idx-synthesis-wrap'),
      curationBtns: Array.from(entry.querySelectorAll('.idx-curation-btn')).map(b => ({
        title: b.title || b.textContent?.trim(),
        active: b.classList.contains('active') || b.classList.contains('on')
      })),
      qaCount: entry.querySelectorAll('.idx-qa').length,
      conceptCount: entry.querySelectorAll('.idx-concept-tag').length,
      metaText: entry.querySelector('.idx-entry-meta')?.textContent?.trim()
    }
  })
  console.log('Expanded entry: ' + JSON.stringify(expandedData, null, 2))

  // ═══════════════════════════════════════════════════════════════
  // PHASE G: Index → PDF navigation (passage click)
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE G: Index entry → PDF navigation ===')
  // Enable lens first
  const lensBtn = await page.$('.viewer-lens-btn')
  if (lensBtn) { await lensBtn.click(); await page.waitForTimeout(500) }

  const lensCount = await page.locator('.pdf-hl-overlay.pdf-hl-lens').count()
  console.log('Lens overlays before click: ' + lensCount)

  const entryTexts = await page.locator('.idx-entry-text').all()
  console.log('Clickable passage texts: ' + entryTexts.length)

  for (let i = 0; i < Math.min(entryTexts.length, 3); i++) {
    const textSnippet = await entryTexts[i].textContent()
    const pageInfoBefore = await page.locator('.viewer-page-info').first().textContent()
    await entryTexts[i].click()
    await page.waitForTimeout(1800)
    const pageInfoAfter = await page.locator('.viewer-page-info').first().textContent()
    const flashCount = await page.locator('.pdf-hl-overlay.pdf-hl-flash').count()
    console.log('Entry[' + i + '] "' + textSnippet?.trim().slice(0, 40) + '"')
    console.log('  page: ' + pageInfoBefore + ' → ' + pageInfoAfter + ' | flash overlays: ' + flashCount)
  }
  await page.screenshot({ path: '/tmp/s46_after_nav.png' })

  // ═══════════════════════════════════════════════════════════════
  // PHASE H: Review button — session entry flow
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE H: Review session flow ===')
  await page.click('button.chat-tab:last-child')
  await page.waitForTimeout(400)

  const reviewBtn = await page.locator('.idx-review-btn, button:has-text("Review")').first()
  const reviewVisible = await reviewBtn.isVisible().catch(() => false)
  console.log('Review button visible: ' + reviewVisible)

  const reviewBtnData = await page.evaluate(() => {
    const btn = document.querySelector('.idx-review-btn, [class*="review-btn"]')
    if (!btn) return null
    const s = getComputedStyle(btn)
    return {
      text: btn.textContent?.trim(),
      bg: s.backgroundColor,
      color: s.color,
      disabled: btn.disabled
    }
  })
  console.log('Review button data: ' + JSON.stringify(reviewBtnData))

  if (reviewVisible) {
    await reviewBtn.click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: '/tmp/s47_review_session.png' })

    const reviewState = await page.evaluate(() => {
      // Look for review modal, overlay, or changed panel
      const modal = document.querySelector('.review-modal, [class*="review-modal"], [class*="ReviewModal"]')
      const overlay = document.querySelector('[class*="review-overlay"], [class*="review-session"]')
      const anyNew = document.querySelector('[class*="flashcard"], [class*="FlashCard"], [class*="card-front"], [class*="rating"]')
      return {
        modalFound: !!modal,
        overlayFound: !!overlay,
        flashcardFound: !!anyNew,
        bodyHtml: document.body.innerHTML.slice(0, 500)
      }
    })
    console.log('Review session state: modal=' + reviewState.modalFound +
      ' overlay=' + reviewState.overlayFound +
      ' flashcard=' + reviewState.flashcardFound)

    // Capture all new visible elements
    const reviewElements = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[class*="review"], [class*="Review"], [class*="flashcard"], [class*="rating"]'))
        .filter(el => {
          const r = el.getBoundingClientRect()
          return r.width > 50 && r.height > 20
        })
        .map(el => ({ cls: el.className.slice(0, 80), text: el.textContent?.trim().slice(0, 100) }))
    })
    console.log('Review elements: ' + JSON.stringify(reviewElements, null, 2))
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE I: Persistence — reload and check index survives
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE I: Persistence after reload ===')
  const entriesBeforeReload = await page.locator('.idx-entry').count()
  console.log('Entries before reload: ' + entriesBeforeReload)

  await page.reload({ waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.click('button.chat-tab:last-child')
  await page.waitForTimeout(500)

  const entriesAfterReload = await page.locator('.idx-entry').count()
  console.log('Entries after reload: ' + entriesAfterReload)
  console.log('Persistence: ' + (entriesBeforeReload === entriesAfterReload ? 'PASS ✓' : 'FAIL ✗ (lost entries)'))
  await page.screenshot({ path: '/tmp/s48_after_reload.png' })

  // ═══════════════════════════════════════════════════════════════
  // PHASE J: Lens toggle — on/off states and overlay accuracy
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE J: Lens highlight system ===')
  await navTo(page, 7)

  const lensBtnState = await page.evaluate(() => {
    const btn = document.querySelector('.viewer-lens-btn')
    return { cls: btn?.className, active: btn?.classList.contains('active'), title: btn?.title }
  })
  console.log('Lens button state: ' + JSON.stringify(lensBtnState))

  // Enable lens
  const lensBtn2 = await page.$('.viewer-lens-btn')
  if (lensBtn2) {
    await lensBtn2.click()
    await page.waitForTimeout(1500)
  }

  const lensOverlays = await page.evaluate(() => {
    const all = document.querySelectorAll('.pdf-hl-overlay')
    const byClass = {}
    all.forEach(el => {
      const extra = Array.from(el.classList).filter(c => c !== 'pdf-hl-overlay').join('.')
      byClass[extra] = (byClass[extra] || 0) + 1
    })
    return { total: all.length, byClass }
  })
  console.log('Lens overlays: ' + JSON.stringify(lensOverlays))

  // Verify overlay positioning (are they on top of text or wildly off?)
  const overlayPositions = await page.evaluate(() => {
    const overlays = Array.from(document.querySelectorAll('.pdf-hl-overlay')).slice(0, 5)
    return overlays.map(el => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.y > 0 && r.y < window.innerHeight }
    })
  })
  console.log('Overlay positions (first 5): ' + JSON.stringify(overlayPositions))

  await page.screenshot({ path: '/tmp/s49_lens_on.png' })

  // Toggle lens off
  await lensBtn2.click()
  await page.waitForTimeout(800)
  const lensAfterOff = await page.locator('.pdf-hl-overlay.pdf-hl-lens').count()
  console.log('Lens overlays after toggle OFF: ' + lensAfterOff)
  await page.screenshot({ path: '/tmp/s50_lens_off.png' })

  // ═══════════════════════════════════════════════════════════════
  // PHASE K: Full panel visual audit
  // ═══════════════════════════════════════════════════════════════
  console.log('\n=== PHASE K: Full index panel visual audit ===')
  await page.click('button.chat-tab:last-child')
  await page.waitForTimeout(300)

  const visualAudit = await page.evaluate(() => {
    const checks = [
      { sel: '.idx-stats',          name: 'Stats bar' },
      { sel: '.idx-view-tab.active',name: 'Active tab' },
      { sel: '.idx-view-tab:not(.active)', name: 'Inactive tab' },
      { sel: '.idx-page-num',       name: 'Page badge' },
      { sel: '.idx-entry-text',     name: 'Passage text' },
      { sel: '.idx-entry-meta',     name: 'Entry meta' },
      { sel: '.idx-concept-tag',    name: 'Concept tag' },
      { sel: '.idx-synthesis-text', name: 'Synthesis text' },
      { sel: '.idx-review-btn, [class*="review-btn"]', name: 'Review btn' },
      { sel: '.idx-curation-btn',   name: 'Curation btn' },
    ]
    return checks.map(({ sel, name }) => {
      const el = document.querySelector(sel)
      if (!el) return { name, found: false }
      const s = getComputedStyle(el)
      return { name, found: true, color: s.color, bg: s.backgroundColor, size: s.fontSize }
    })
  })
  visualAudit.forEach(({ name, found, color, bg, size }) => {
    if (!found) { console.log('NOT FOUND: ' + name); return }
    console.log(name + ': color=' + color + ' | bg=' + bg + ' | ' + size)
  })

  await page.screenshot({ path: '/tmp/s51_index_final.png' })
  await browser.close()
  console.log('\n=== STEP 4 COMPLETE ===')
})()
