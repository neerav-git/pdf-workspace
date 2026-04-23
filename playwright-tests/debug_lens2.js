const { chromium } = require('playwright')
const path = require('path')
const SS = path.join(__dirname, 'screenshots')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  // Capture console logs
  page.on('console', msg => console.log('BROWSER:', msg.type(), msg.text()))

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // Click first PDF
  await page.locator('.pdf-item').first().click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${SS}/dbg2_01.png` })

  // Check store state
  const storeState = await page.evaluate(() => {
    const state = window.__zustand_store?.getState?.()
    if (!state) {
      // Try to get it from React devtools or any global
      return { error: 'no __zustand_store' }
    }
    return {
      highlightIndexLen: state.highlightIndex?.length,
      selectedPdfId: state.selectedPdf?.id,
    }
  })
  console.log('Store state attempt:', JSON.stringify(storeState))

  // Check localStorage for Zustand persist
  const lsKeys = await page.evaluate(() => Object.keys(localStorage))
  console.log('localStorage keys:', lsKeys)

  // Check if there's highlight data in localStorage
  const appStorage = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.toLowerCase().includes('pdf') || k.toLowerCase().includes('highlight') || k.toLowerCase().includes('app')) {
        return { key: k, value: localStorage.getItem(k)?.slice(0, 500) }
      }
    }
    return null
  })
  console.log('App storage:', JSON.stringify(appStorage))

  // Text layer count
  const tlCount = await page.locator('.react-pdf__Page__textContent span').count()
  console.log('Text layer spans:', tlCount)

  // Click lens
  const lensBtn = page.locator('.viewer-lens-btn')
  if (await lensBtn.count() > 0) {
    await lensBtn.click()
    await page.waitForTimeout(2000)
    console.log('Clicked lens')
  } else {
    console.log('NO LENS BUTTON')
  }

  const overlays = await page.locator('.pdf-hl-overlay').count()
  console.log('Overlays after lens click:', overlays)

  // Check page wrapper
  const wrappers = await page.locator('.viewer-page-wrapper').count()
  console.log('Page wrappers:', wrappers)

  await page.screenshot({ path: `${SS}/dbg2_02.png` })
  await browser.close()
})()
