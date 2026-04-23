const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // ── Fix 1: "Save note" renamed to "Note only" ─────────────────────────────
  // We can't easily trigger the selection menu without a PDF loaded,
  // so check the source code change instead
  const fs = require('fs')
  const selMenuSrc = fs.readFileSync('/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/SelectionMenu.jsx', 'utf8')

  const fix1Pass = selMenuSrc.includes("label: 'Note only'") && !selMenuSrc.includes("label: 'Save note'")
  console.log(`Fix 1 - "Note only" label: ${fix1Pass ? 'PASS ✓' : 'FAIL ✗'}`)

  const fix1bPass = selMenuSrc.includes("tooltip: 'Saves text as annotation")
  console.log(`Fix 1b - tooltip on Note only: ${fix1bPass ? 'PASS ✓' : 'FAIL ✗'}`)

  // ── Fix 2: "Index (empty)" → "Add to Index" ───────────────────────────────
  const fix2Pass = selMenuSrc.includes("'Add to Index'") && !selMenuSrc.includes("'Index (empty)'")
  console.log(`Fix 2 - "Add to Index" label: ${fix2Pass ? 'PASS ✓' : 'FAIL ✗'}`)

  const fix2bPass = selMenuSrc.includes("Ask a question about this passage")
  console.log(`Fix 2b - empty index tooltip: ${fix2bPass ? 'PASS ✓' : 'FAIL ✗'}`)

  // ── Fix 3: Quiz prompt improved ───────────────────────────────────────────
  const fix3Pass = selMenuSrc.includes('<your question here>') && selMenuSrc.includes('<your answer here>')
  console.log(`Fix 3 - Quiz prompt uses angle-bracket placeholders: ${fix3Pass ? 'PASS ✓' : 'FAIL ✗'}`)
  const fix3bNoOld = !selMenuSrc.includes('[the question]') && !selMenuSrc.includes('[the answer]')
  console.log(`Fix 3b - Old bracket placeholders removed: ${fix3bNoOld ? 'PASS ✓' : 'FAIL ✗'}`)

  // ── Fix 4: log-prompt outside .chat-messages ──────────────────────────────
  const chatPanelSrc = fs.readFileSync('/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/ChatPanel.jsx', 'utf8')
  // Check that log-prompt comes after </div> (closing chat-messages) and before selection-chip
  const messagesClose = chatPanelSrc.indexOf('<div ref={bottomRef} />')
  const logPromptPos = chatPanelSrc.indexOf('{/* Log-to-index prompt')
  const selectionChipPos = chatPanelSrc.indexOf('{/* Selection context chip')
  const fix4Pass = logPromptPos > messagesClose && logPromptPos < selectionChipPos
  console.log(`Fix 4 - log-prompt outside scroll area: ${fix4Pass ? 'PASS ✓' : 'FAIL ✗'}`)

  // ── Fix 5: log-prompt CSS — no position sticky, has border-top ─────────────
  const chatPanelCss = fs.readFileSync('/Users/neeravch/Desktop/pdf-workspace/frontend/src/components/ChatPanel.css', 'utf8')
  const logPromptCssBlock = chatPanelCss.slice(chatPanelCss.indexOf('.log-prompt {'), chatPanelCss.indexOf('\n}', chatPanelCss.indexOf('.log-prompt {')))
  const fix5Pass = logPromptCssBlock.includes('border-top') && !logPromptCssBlock.includes('position: sticky')
  console.log(`Fix 5 - log-prompt CSS (border-top, no sticky): ${fix5Pass ? 'PASS ✓' : 'FAIL ✗'}`)

  await browser.close()
})()
