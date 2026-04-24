const { chromium } = require('playwright')

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  throw new Error(msg)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })

  await page.getByText('Research Sessions').waitFor({ timeout: 10000 })
  await page.locator('.session-title').filter({ hasText: 'Learning Design Research' }).waitFor({ timeout: 10000 })

  const sessionTitles = await page.locator('.session-title').allTextContents()
  console.log('sessions:', JSON.stringify(sessionTitles))
  for (const expected of ['Learning Design Research', 'Medical Encyclopedia', 'Unsorted Research']) {
    if (!sessionTitles.includes(expected)) fail(`Missing session: ${expected}`)
  }

  const learningGroup = page.locator('.session-group').filter({ hasText: 'Learning Design Research' })
  const medicalGroup = page.locator('.session-group').filter({ hasText: 'Medical Encyclopedia' })
  await learningGroup.getByText(/Making Medical Research Papers Approachable/i).waitFor({ timeout: 10000 })
  await learningGroup.getByText(/Knowledge-Aware Retrieval/i).waitFor({ timeout: 10000 })
  await medicalGroup.getByText(/Medical_book/i).waitFor({ timeout: 10000 })

  const paperPlain = learningGroup.locator('.pdf-item').filter({ hasText: /Making Medical Research Papers Approachable/i }).first()
  await paperPlain.click()
  await page.locator('.viewer-title').filter({ hasText: /Making Medic/i }).waitFor({ timeout: 10000 })
  await page.locator('.chat-tab').filter({ hasText: 'Index' }).click()
  await page.locator('.idx-stats').filter({ hasText: /passages/i }).waitFor({ timeout: 10000 })

  const selectedCount = await page.locator('.pdf-item.selected').count()
  console.log('selected pdf items:', selectedCount)
  if (selectedCount !== 1) fail('Selecting a nested PDF should mark exactly one PDF item selected')

  const sidebarLabel = await page.locator('.sidebar-title').textContent()
  console.log('sidebar label:', sidebarLabel)
  const placementToggle = page.locator('.placement-toggle input')
  const toggleChecked = await placementToggle.isChecked()
  console.log('placement suggestion default:', toggleChecked)
  if (toggleChecked) fail('Upload placement suggestions should be off by default')
  await browser.close()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
