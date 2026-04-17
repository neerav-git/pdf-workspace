"""
Browser UI eval — pdf-workspace visual/interaction regression tests.

Uses Playwright (Python) to drive a real browser against the running dev app.
Tests: layout, hover menu, selection flow, index save, tab switching, markdown rendering.

Usage:
    cd /Users/neeravch/Desktop/pdf-workspace/backend
    pip install playwright
    playwright install chromium
    conda activate pdf-workspace
    python -m tests.eval.eval_ui [--url http://localhost:5173] [--screenshot-dir /tmp/screens]

Outputs:
    - Console pass/fail table
    - Screenshots saved to --screenshot-dir for visual inspection
    - tests/eval/last_ui_report.json

Note: Requires the full stack running (frontend on 5173, backend on 8000).
      A PDF must already be uploaded. Tests will use the first available PDF.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

try:
    from playwright.async_api import async_playwright, Page, BrowserContext
except ImportError:
    print("playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

import httpx

FRONTEND_URL = "http://localhost:5173"
BACKEND_URL  = "http://localhost:8000"
REPORT_FILE  = Path(__file__).parent / "last_ui_report.json"

PASS  = "\033[92m✓\033[0m"
FAIL  = "\033[91m✗\033[0m"
WARN  = "\033[93m~\033[0m"
BOLD  = "\033[1m"
RESET = "\033[0m"


# ── Helpers ───────────────────────────────────────────────────────────────────

async def screenshot(page: Page, name: str, out_dir: Path):
    path = out_dir / f"{name}.png"
    await page.screenshot(path=str(path), full_page=False)
    return str(path)


async def wait_for_chat_response(page: Page, timeout: float = 30):
    """Wait until the loading dots disappear and an assistant message appears."""
    await page.wait_for_selector(".message-assistant:not(.message-assistant:last-child .typing)", timeout=int(timeout * 1000))
    # Extra wait for markdown render
    await page.wait_for_timeout(500)


def get_first_pdf(backend_url: str) -> dict | None:
    try:
        resp = httpx.get(f"{backend_url}/api/pdfs", timeout=10)
        pdfs = resp.json()
        return pdfs[0] if pdfs else None
    except Exception:
        return None


# ── Individual tests ──────────────────────────────────────────────────────────

async def test_app_loads(page: Page, out_dir: Path) -> dict:
    """App renders without JS errors."""
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(FRONTEND_URL)
    await page.wait_for_load_state("networkidle")
    await screenshot(page, "01_app_loads", out_dir)
    return {
        "name": "App loads without JS errors",
        "pass": len(errors) == 0,
        "detail": errors[:3] if errors else None,
    }


async def test_pdf_list_visible(page: Page, out_dir: Path) -> dict:
    """PDF list sidebar is visible and contains at least one PDF."""
    try:
        await page.wait_for_selector(".pdf-item, .pdf-list-item, [data-testid='pdf-item']", timeout=5000)
        count = await page.locator(".pdf-item, .pdf-list-item").count()
        await screenshot(page, "02_pdf_list", out_dir)
        return {"name": "PDF list visible", "pass": count > 0, "detail": f"{count} PDFs found"}
    except Exception as e:
        return {"name": "PDF list visible", "pass": False, "detail": str(e)}


async def test_pdf_select_loads_viewer(page: Page, out_dir: Path) -> dict:
    """Clicking a PDF opens the viewer and shows pages."""
    try:
        # Click the first PDF
        first = page.locator(".pdf-item, .pdf-list-item").first
        await first.click()
        # Wait for the PDF canvas or page indicator
        await page.wait_for_selector("canvas, .pdf-page, .react-pdf__Page", timeout=15000)
        await screenshot(page, "03_pdf_viewer", out_dir)
        return {"name": "PDF select loads viewer", "pass": True}
    except Exception as e:
        return {"name": "PDF select loads viewer", "pass": False, "detail": str(e)}


async def test_chat_panel_visible(page: Page, out_dir: Path) -> dict:
    """Chat panel is visible with input area."""
    try:
        await page.wait_for_selector(".chat-input", timeout=5000)
        await screenshot(page, "04_chat_panel", out_dir)
        return {"name": "Chat panel with input visible", "pass": True}
    except Exception as e:
        return {"name": "Chat panel with input visible", "pass": False, "detail": str(e)}


async def test_chat_sends_and_receives(page: Page, out_dir: Path) -> dict:
    """Type a message, send it, receive a response with markdown."""
    try:
        textarea = page.locator(".chat-input")
        await textarea.fill("What is this document about?")
        await page.keyboard.press("Enter")

        # Wait for loading indicator to appear then disappear
        await page.wait_for_selector(".typing", timeout=10000)
        await page.wait_for_selector(".typing", state="detached", timeout=45000)
        await page.wait_for_timeout(500)

        # Check that a response appeared and contains markdown (bold, etc.)
        response_els = await page.locator(".message-assistant .message-bubble").all()
        has_response = len(response_els) > 0

        # Check for markdown rendering (strong tags from **bold**)
        has_markdown = await page.locator(".message-assistant strong").count() > 0

        # Check for deep dive heading
        content = await page.locator(".message-assistant .message-bubble").last.inner_text()
        has_deep_dive = "Questions worth sitting with" in content

        await screenshot(page, "05_chat_response", out_dir)
        return {
            "name": "Chat sends and receives formatted response",
            "pass": has_response and has_markdown,
            "detail": {
                "has_response": has_response,
                "has_markdown_bold": has_markdown,
                "has_deep_dive_heading": has_deep_dive,
            },
        }
    except Exception as e:
        await screenshot(page, "05_chat_response_error", out_dir)
        return {"name": "Chat sends and receives formatted response", "pass": False, "detail": str(e)}


async def test_source_badges_appear(page: Page, out_dir: Path) -> dict:
    """Source page badges appear below the last assistant response."""
    try:
        badges = await page.locator(".source-badge").all()
        count = len(badges)
        await screenshot(page, "06_source_badges", out_dir)
        return {
            "name": "Source page badges visible",
            "pass": count > 0,
            "detail": f"{count} badges",
        }
    except Exception as e:
        return {"name": "Source page badges visible", "pass": False, "detail": str(e)}


async def test_index_tab_switches(page: Page, out_dir: Path) -> dict:
    """Index tab exists and switching to it renders the index view."""
    try:
        index_tab = page.locator("button.chat-tab", has_text="Index")
        await index_tab.click()
        await page.wait_for_timeout(400)
        # Index renders either the populated view (.highlight-index) or the empty state (.idx-empty)
        # Both are valid — the tab switching is what we're testing here
        populated = await page.locator(".highlight-index").is_visible()
        empty     = await page.locator(".idx-empty").is_visible()
        index_visible = populated or empty
        await screenshot(page, "07_index_tab", out_dir)
        # Switch back to chat
        chat_tab = page.locator("button.chat-tab", has_text="Chat")
        await chat_tab.click()
        return {
            "name": "Index tab switches correctly",
            "pass": index_visible,
            "detail": "populated" if populated else ("empty-state" if empty else "not found"),
        }
    except Exception as e:
        return {"name": "Index tab switches correctly", "pass": False, "detail": str(e)}


async def test_chat_conciseness_followup(page: Page, out_dir: Path) -> dict:
    """
    Send a detailed question, then ask for a shorter version.
    Verify the second response is measurably shorter.
    """
    try:
        textarea = page.locator(".chat-input")

        # Turn 1
        await textarea.fill("Explain the main mechanism described in this document in detail")
        await page.keyboard.press("Enter")
        await page.wait_for_selector(".typing", timeout=10000)
        await page.wait_for_selector(".typing", state="detached", timeout=45000)
        await page.wait_for_timeout(500)

        bubbles_after_1 = await page.locator(".message-assistant .message-bubble").all()
        t1_text = await bubbles_after_1[-1].inner_text()
        t1_words = len(t1_text.split())

        # Turn 2 — ask for shorter
        await textarea.fill("That's too long. Give me just the 2-sentence version.")
        await page.keyboard.press("Enter")
        await page.wait_for_selector(".typing", timeout=10000)
        await page.wait_for_selector(".typing", state="detached", timeout=45000)
        await page.wait_for_timeout(500)

        bubbles_after_2 = await page.locator(".message-assistant .message-bubble").all()
        t2_text = await bubbles_after_2[-1].inner_text()
        t2_words = len(t2_text.split())

        is_shorter = t2_words < t1_words * 0.7

        await screenshot(page, "08_conciseness_followup", out_dir)
        return {
            "name": "Conciseness follow-up: second response shorter",
            "pass": is_shorter,
            "detail": {
                "turn_1_words": t1_words,
                "turn_2_words": t2_words,
                "ratio": round(t2_words / t1_words, 2) if t1_words else None,
            },
        }
    except Exception as e:
        return {"name": "Conciseness follow-up", "pass": False, "detail": str(e)}


async def test_viewport_layout(page: Page, out_dir: Path) -> dict:
    """
    Check that key panels don't overflow the viewport.
    Tests both 1440px desktop and 1024px laptop widths.
    """
    results = {}
    for width in [1440, 1024]:
        await page.set_viewport_size({"width": width, "height": 900})
        await page.wait_for_timeout(300)

        # Check nothing is horizontally clipped
        overflow = await page.evaluate("""() => {
            const body = document.body;
            return body.scrollWidth > window.innerWidth;
        }""")
        results[f"no_overflow_{width}"] = not overflow
        await screenshot(page, f"09_viewport_{width}", out_dir)

    all_pass = all(results.values())
    return {"name": "Viewport layout — no horizontal overflow", "pass": all_pass, "detail": results}


# ── Runner ─────────────────────────────────────────────────────────────────────

async def run_ui_eval(args):
    out_dir = Path(args.screenshot_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pdf = get_first_pdf(BACKEND_URL)
    if not pdf:
        print(f"{FAIL} No PDFs found in backend. Upload at least one PDF before running UI eval.")
        sys.exit(1)
    print(f"\n{BOLD}Testing against:{RESET} {pdf.get('title', pdf.get('filename'))} (id={pdf['id']})")

    report = {"pdf_id": pdf["id"], "results": []}
    total = passed = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context: BrowserContext = await browser.new_context(viewport={"width": 1440, "height": 900})
        page: Page = await context.new_page()

        tests = [
            test_app_loads,
            test_pdf_list_visible,
            test_pdf_select_loads_viewer,
            test_chat_panel_visible,
            test_chat_sends_and_receives,
            test_source_badges_appear,
            test_index_tab_switches,
            test_chat_conciseness_followup,
            test_viewport_layout,
        ]

        print(f"\n{BOLD}═══ UI TESTS ═══{RESET}")
        for test_fn in tests:
            try:
                result = await test_fn(page, out_dir)
            except Exception as e:
                result = {"name": test_fn.__name__, "pass": False, "detail": f"Uncaught: {e}"}

            icon = PASS if result["pass"] else FAIL
            detail_str = ""
            if not result["pass"] and result.get("detail"):
                detail_str = f" — {result['detail']}"
            elif result.get("detail") and isinstance(result["detail"], dict):
                detail_str = f" — {result['detail']}"

            print(f"  {icon} {result['name']}{detail_str}")
            total  += 1
            if result["pass"]: passed += 1
            report["results"].append(result)

        await browser.close()

    print(f"\n{BOLD}═══ SUMMARY ═══{RESET}")
    pct = int(100 * passed / total) if total else 0
    icon = PASS if pct >= 80 else (WARN if pct >= 50 else FAIL)
    print(f"{icon} {passed}/{total} passed ({pct}%)")
    print(f"Screenshots → {out_dir}")

    report["summary"] = {"total": total, "passed": passed, "pct": pct}
    REPORT_FILE.write_text(json.dumps(report, indent=2))
    print(f"Report → {REPORT_FILE}")
    return 0 if pct >= 80 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="pdf-workspace UI eval")
    parser.add_argument("--url",            default=FRONTEND_URL)
    parser.add_argument("--screenshot-dir", default="/tmp/pdf-workspace-ui-eval")
    args = parser.parse_args()
    sys.exit(asyncio.run(run_ui_eval(args)))
