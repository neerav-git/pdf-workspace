const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.click('.pdf-item')
  await page.waitForSelector('.react-pdf__Page__canvas', { timeout: 15000 })
  await page.waitForTimeout(1000)
  await page.click('button.chat-tab:last-child')
  await page.waitForTimeout(500)

  // Click first entry to expand it
  const headerSel = '.idx-entry-header, .idx-entry-wrap, .highlight-index > div > div'
  const firstHeader = await page.$(headerSel)
  if (firstHeader) { await firstHeader.click(); await page.waitForTimeout(300) }

  // Dump all idx- classes and their computed styles
  const audit = await page.evaluate(() => {
    const seen = {}
    document.querySelectorAll('[class]').forEach(el => {
      el.classList.forEach(c => {
        if (!c.startsWith('idx-') || seen[c]) return
        const s = getComputedStyle(el)
        seen[c] = {
          color: s.color,
          bg: s.backgroundColor,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          padding: s.padding,
          display: s.display,
        }
      })
    })
    return seen
  })

  console.log('=== idx- class styles ===')
  Object.entries(audit).sort(([a],[b]) => a.localeCompare(b)).forEach(([cls, s]) => {
    console.log(`\n.${cls}:`)
    console.log(`  color: ${s.color}  bg: ${s.bg}  size: ${s.fontSize}  weight: ${s.fontWeight}`)
    console.log(`  display: ${s.display}  padding: ${s.padding}`)
  })

  await browser.close()
})()
