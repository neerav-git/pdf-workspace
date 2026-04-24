const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: /Reader/i }).waitFor({ timeout: 10000 })
  await page.getByText('Research Sessions').waitFor({ timeout: 10000 })
  await page.locator('.chat-tab').filter({ hasText: 'Chat' }).waitFor({ timeout: 10000 })

  await page.locator('.workspace-tab').filter({ hasText: 'Index' }).click()
  await page.getByRole('heading', { name: 'Knowledge Map' }).waitFor({ timeout: 10000 })
  await page.getByText('Visible index entries').waitFor({ timeout: 10000 })

  await page.locator('.workspace-tab').filter({ hasText: 'Compare' }).click()
  await page.getByText('Full-Page Compare').waitFor({ timeout: 10000 })

  await page.locator('.workspace-tab').filter({ hasText: 'Review' }).click()
  await page.getByRole('heading', { name: 'Study Queues' }).waitFor({ timeout: 10000 })
  await page.getByText('Review All Due').waitFor({ timeout: 10000 })

  await page.locator('.workspace-tab').filter({ hasText: 'Reader' }).click()
  await page.locator('.app-layout').waitFor({ timeout: 10000 })
  await page.locator('.sidebar').waitFor({ timeout: 10000 })
  await page.locator('.chat-tab').filter({ hasText: 'Chat' }).waitFor({ timeout: 10000 })

  const activeTab = await page.locator('.workspace-tab.active span').textContent()
  console.log('active workspace tab:', activeTab)
  if (activeTab !== 'Reader') throw new Error(`Expected Reader tab active, got ${activeTab}`)

  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
