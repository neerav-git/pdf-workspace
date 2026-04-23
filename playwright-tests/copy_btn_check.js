const { chromium } = require('playwright')
const fs = require('fs')
const SCREENSHOTS = '/Users/neeravch/Desktop/pdf-workspace/playwright-tests/screenshots'

;(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  await page.locator('.pdf-item').first().click()
  await page.waitForSelector('.react-pdf__Page__textContent span', { timeout: 20000 })
  await page.waitForTimeout(2000)

  // Send a quick message to get an assistant bubble
  await page.locator('.chat-input').fill('hi')
  await page.keyboard.press('Enter')
  try { await page.waitForSelector('.message-bubble.typing', { timeout: 5000 }) } catch {}
  await page.waitForSelector('.message-bubble.typing', { state: 'detached', timeout: 30000 })
  await page.waitForTimeout(500)

  const chatClip = async () => {
    const box = await page.locator('.chat-panel').boundingBox()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  // Dismiss log banner if present
  if (await page.locator('.log-prompt').isVisible().catch(() => false)) {
    await page.locator('.log-prompt-skip').click()
    await page.waitForTimeout(300)
  }

  // Screenshot without hover (button should be invisible)
  await page.mouse.move(300, 400)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SCREENSHOTS}/copy_01_no_hover.png`, clip: await chatClip() })
  console.log('Screenshot 1: no hover (button invisible)')

  // Hover the assistant message
  await page.locator('.message-assistant').first().hover()
  await page.waitForTimeout(400)

  // Check computed styles
  const styles = await page.locator('.message-copy-btn').first().evaluate(el => {
    const s = window.getComputedStyle(el)
    return { opacity: s.opacity, background: s.backgroundColor, border: s.borderColor, color: s.color }
  })
  console.log('Copy btn on hover:', styles)

  await page.screenshot({ path: `${SCREENSHOTS}/copy_02_hover.png`, clip: await chatClip() })
  console.log('Screenshot 2: hover (button visible with pill bg)')

  // Click
  await page.locator('.message-copy-btn').first().click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SCREENSHOTS}/copy_03_clicked.png`, clip: await chatClip() })
  console.log('Screenshot 3: clicked (green ✓)')

  await browser.close()
})()
