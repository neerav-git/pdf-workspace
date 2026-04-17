"""
Extract or generate a table of contents from a PDF.

Strategy:
1. Use PyMuPDF's built-in outline (bookmarks) if present — always preferred.
2. Otherwise, two-pass font-size heuristic across ALL pages.

Granularity is chosen automatically based on PDF length:
  ≤ 150 pages  →  fine-grained: H1 (≥1.6×) + H2 (≥1.25×), levels preserved
  > 150 pages  →  chapter-level: H1 only (≥1.6×)

This means a 5-page web article gets every subheading; a 600-page encyclopedia
gets only chapter/entry-level titles (which is all that's useful at that scale).

Deduplication: last-occurrence wins — the actual content page beats any
front-matter printed ToC page that lists the same heading.
No item cap.

get_page_heading_path() supplements the ToC with deep per-page heading
detection using font-size, bold flag, and ALL-CAPS heuristics — capturing
body-level subheadings (e.g. "Inclusion Criteria", "Precautions") that never
appear in the outline because they are not chapter-level entries.
"""
from __future__ import annotations
import statistics
import fitz  # PyMuPDF

# Page count thresholds
FINE_GRAINED_MAX_PAGES = 150   # ≤ this → include H2 subheadings
H1_RATIO = 1.6                 # ≥ body_median × this → level 1
H2_RATIO = 1.25                # ≥ body_median × this → level 2 (fine-grained only)


def get_toc(pdf_bytes: bytes) -> dict:
    """
    Return {
      "items":     [{"level": 1|2, "title": str, "page": int}, ...],
      "generated": bool,   # False = native outline, True = font heuristic
      "mode":      str,    # "native" | "fine" | "chapter"
    }
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # ── 1. Try built-in outline ──────────────────────────────────────────────
    outline = doc.get_toc(simple=True)  # [(level, title, page), ...]
    if outline:
        doc.close()
        return {
            "items": [
                {"level": lvl, "title": title.strip(), "page": page}
                for lvl, title, page in outline
                if title.strip()
            ],
            "generated": False,
            "mode": "native",
        }

    num_pages = len(doc)
    fine_grained = num_pages <= FINE_GRAINED_MAX_PAGES
    mode = "fine" if fine_grained else "chapter"

    # ── 2a. Pass 1: collect font sizes ────────────────────────────────────────
    all_sizes: list[float] = []
    for i in range(num_pages):
        for block in doc[i].get_text("dict", flags=0)["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    sz = span.get("size", 0)
                    if sz > 0:
                        all_sizes.append(sz)

    if not all_sizes:
        doc.close()
        return {"items": [], "generated": True, "mode": mode}

    body_median = statistics.median(all_sizes)
    h1_threshold = body_median * H1_RATIO
    h2_threshold = body_median * H2_RATIO  # only used in fine-grained mode

    # ── 2b. Pass 2: scan all pages, keep LAST occurrence of each title ────────
    # last_page[title] = most recent page → actual content page beats front-matter ToC
    last_page: dict[str, int] = {}
    last_level: dict[str, int] = {}
    insertion_order: list[str] = []

    for i in range(num_pages):
        page_num = i + 1
        for block in doc[i].get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                line_text = ""
                max_sz = 0.0
                for span in line.get("spans", []):
                    line_text += span["text"]
                    sz = span.get("size", 0)
                    max_sz = max(max_sz, sz)

                # Determine level (or skip entirely)
                if max_sz >= h1_threshold:
                    level = 1
                elif fine_grained and max_sz >= h2_threshold:
                    level = 2
                else:
                    continue

                text = line_text.strip()
                if not text:
                    continue
                if len(text) > 100 or text.count(",") > 2 or text.endswith("."):
                    continue

                if text not in last_page:
                    insertion_order.append(text)
                last_page[text] = page_num   # last occurrence wins
                last_level[text] = level

    doc.close()

    items = sorted(
        [
            {"level": last_level[t], "title": t, "page": last_page[t]}
            for t in insertion_order
        ],
        key=lambda x: x["page"],
    )
    return {"items": items, "generated": True, "mode": mode}


# ── Deep per-page heading extraction ─────────────────────────────────────────
# Supplements the global ToC with body-level subheadings (H2–H4) that are
# present in the PDF text as bold or oversized lines but never appear in the
# outline because they are not chapter-level entries.
#
# Typical targets:
#   Medical encyclopedia  → "Precautions", "Description", "Definition"
#   Academic book         → "Inclusion Criteria", "Scope", "Background"
#   Technical manual      → "Installation", "Configuration", "Troubleshooting"


_ROMAN = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
          "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"}


def _is_heading_noise(text: str) -> bool:
    """Return True for text that looks like a heading visually but carries no meaning."""
    if len(text) <= 1:
        return True                        # single-letter section dividers (A, B, C…)
    if text.replace(" ", "").isdigit():
        return True                        # pure page numbers
    if text.upper() in _ROMAN:
        return True                        # roman numeral page numbers
    if len(text) > 80:
        return True                        # too long — body text, not a heading
    if text.endswith(".") or text.endswith(","):
        return True                        # sentence fragment or list item
    if text.count(",") >= 2:
        return True                        # credential strings (DAPA, DABFC, DABCI) or comma-lists
    return False


def _classify_heading(max_sz: float, is_bold: bool, text: str, body_median: float) -> int | None:
    """
    Return heading level (1–4) or None if this line is not a heading.

    Level assignment:
      1  — font ≥ 1.5× body median (chapter / entry titles)
      2  — font ≥ 1.2× body median, OR all-caps short text
      3  — bold text, short (< 60 chars), not all-caps
      4  — bold text, shorter still (< 40 chars) — fine-grained sub-items
    """
    if max_sz >= body_median * 1.5:
        return 1
    if max_sz >= body_median * 1.2:
        return 2
    if text.isupper() and 2 < len(text) < 40:
        return 2   # ALL-CAPS short line → section heading regardless of size
    if is_bold and len(text) < 30 and ',' not in text:
        # Short, comma-free bold text → section subheading (e.g. "Precautions", "Description").
        # len<30 filters body-text fragments; comma filter removes author names & credential strings.
        return 3
    return None


def get_page_heading_path(
    pdf_bytes: bytes,
    target_page: int,
    lookback: int = 8,
    anchor_text: str | None = None,
) -> list[dict]:
    """
    Return the full section heading path active at *target_page*.

    Parameters
    ----------
    pdf_bytes    : raw PDF bytes
    target_page  : 1-indexed page where the highlight lives
    lookback     : how many pages before target_page to scan for H1 context
    anchor_text  : if provided, scan the target page in reading order and stop
                   when this text is first encountered — gives exact attribution
                   when a single page contains multiple sections (e.g. a page
                   that has both "SCOPE" and "INCLUSION CRITERIA" on it).

    Strategy
    --------
    Two-phase scan:

    Phase 1 — lookback pages (target_page-lookback … target_page-1):
        Collect all headings to establish higher-level context (H1 chapter).
        Use the classic ancestor-chain algorithm from the ToC service.

    Phase 2 — target page, reading order:
        Maintain a live heading stack as blocks are processed top-to-bottom.
        If anchor_text is given, stop the scan at first match so the stack
        reflects exactly what headings were active above the highlight.
        If no anchor_text, run to end of page.

    The two phases are merged: Phase 1 supplies the H1 backbone; Phase 2
    supplies the accurate H2/H3 context from the target page itself.

    Returns [{level: int, title: str}, …] root→leaf, or [].
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    window_start = max(1, target_page - lookback)

    # ── 1. Compute local body-text median ─────────────────────────────────────
    sizes: list[float] = []
    for i in range(window_start - 1, min(target_page, len(doc))):
        for block in doc[i].get_text("dict", flags=0)["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    sz = span.get("size", 0)
                    if sz > 0:
                        sizes.append(sz)

    body_median = statistics.median(sizes) if sizes else 10.0

    # ── Phase 1: lookback pages → ancestor-chain headings ─────────────────────
    # Only go up to (but not including) the target page.
    lookback_headings: list[dict] = []

    for i in range(window_start - 1, target_page - 1):   # excludes target page
        if i >= len(doc):
            break
        page_num = i + 1
        page_obj = doc[i]
        ph = page_obj.rect.height or 792.0
        p1_footer_cutoff = ph * 0.88
        p1_header_cutoff = ph * 0.08

        for block in page_obj.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
            if block.get("type") != 0:
                continue
            # Skip header and footer bands (running page numbers, series titles, etc.)
            by = block.get("bbox", [0, 0, 0, 0])[1]
            if by <= p1_header_cutoff or by >= p1_footer_cutoff:
                continue

            for line in block.get("lines", []):
                line_text = ""
                max_sz = 0.0
                is_bold = False
                for span in line.get("spans", []):
                    line_text += span.get("text", "")
                    sz = span.get("size", 0)
                    if sz > 0:
                        max_sz = max(max_sz, sz)
                    flags = span.get("flags", 0)
                    font = span.get("font", "").lower()
                    if (flags & 16) or "bold" in font:
                        is_bold = True

                text = line_text.strip()
                if _is_heading_noise(text):
                    continue
                level = _classify_heading(max_sz, is_bold, text, body_median)
                # Only L1/L2 from lookback pages — L3 (bold short text) is too
                # noisy across pages (author names, credentials, captions, etc.)
                if level is None or level > 2:
                    continue
                lookback_headings.append({"level": level, "title": text, "page": page_num, "y": by})

    # Build ancestor chain from lookback pages: walk in forward page/visual order so
    # that when a new L1 appears it resets all deeper context (prevents cross-reference
    # entries or section headers from a previous article from polluting the current path).
    lookback_headings.sort(key=lambda h: (h["page"], h.get("y", 0)))
    prior_path: dict[int, str] = {}   # level → most-recent title within current L1 scope
    for h in lookback_headings:
        lvl = h["level"]
        prior_path[lvl] = h["title"]
        # Reset all deeper levels — new L1 means new article; new L2 means new section
        for deeper in [l for l in list(prior_path.keys()) if l > lvl]:
            del prior_path[deeper]

    # ── Phase 2: target page — visual-order scan, stop at anchor ─────────────
    # PDFs with multi-column layouts or decorative titles store blocks in
    # non-visual order (e.g. a spanning chapter title can be block 16 even
    # though it renders at y=94 near the top of the page).
    #
    # Strategy:
    #   a) Collect ALL blocks from the target page with their y-coordinates.
    #   b) Filter out header/footer bands (top 8% and bottom 12% of page height).
    #   c) Find the y-coordinate of the anchor text (if given).
    #   d) Sort remaining blocks by y-coordinate (top → bottom visual order).
    #   e) Walk in visual order, maintaining a heading stack, stopping when the
    #      anchor text is encountered.
    live_stack: dict[int, str] = {}

    if target_page - 1 < len(doc):
        target_page_obj = doc[target_page - 1]
        page_height = target_page_obj.rect.height or 792.0
        footer_y_cutoff = page_height * 0.88   # bottom 12% = running footers
        header_y_cutoff = page_height * 0.08   # top 8% = running page numbers / headers

        anchor_short = anchor_text[:80].lower() if anchor_text else None
        anchor_y: float | None = None

        # Gather all text blocks as (y_top, block) pairs, skip H/F bands
        raw_blocks = target_page_obj.get_text(
            "dict", flags=fitz.TEXT_PRESERVE_WHITESPACE
        )["blocks"]

        # First pass: find anchor y-position (so we know where to stop)
        if anchor_short:
            for block in raw_blocks:
                if block.get("type") != 0:
                    continue
                block_text = "".join(
                    span.get("text", "")
                    for line in block.get("lines", [])
                    for span in line.get("spans", [])
                ).strip().lower()
                if anchor_short in block_text:
                    anchor_y = block.get("bbox", [0, 0, 0, 0])[1]  # y-top
                    break

        # Second pass: sort blocks by y-position and walk up to anchor_y
        content_blocks = [
            (b.get("bbox", [0, 0, 0, 0])[1], b)
            for b in raw_blocks
            if b.get("type") == 0
            and header_y_cutoff < b.get("bbox", [0, 0, 0, 0])[1] < footer_y_cutoff
        ]
        content_blocks.sort(key=lambda t: t[0])   # sort by y ascending

        for y_top, block in content_blocks:
            # Stop if we've reached or passed the anchor text position
            if anchor_y is not None and y_top >= anchor_y:
                break

            for line in block.get("lines", []):
                line_text = ""
                max_sz = 0.0
                is_bold = False
                for span in line.get("spans", []):
                    line_text += span.get("text", "")
                    sz = span.get("size", 0)
                    if sz > 0:
                        max_sz = max(max_sz, sz)
                    flags = span.get("flags", 0)
                    font = span.get("font", "").lower()
                    if (flags & 16) or "bold" in font:
                        is_bold = True

                text = line_text.strip()
                if _is_heading_noise(text):
                    continue
                level = _classify_heading(max_sz, is_bold, text, body_median)
                if level is None:
                    continue

                # Update stack: new heading supersedes all deeper levels
                live_stack[level] = text
                for deeper in [l for l in list(live_stack.keys()) if l > level]:
                    del live_stack[deeper]

    doc.close()

    # ── Merge Phase 1 + Phase 2 ───────────────────────────────────────────────
    # live_stack from target page overrides prior_path at the same levels.
    merged: dict[int, str] = {**prior_path, **live_stack}

    if not merged:
        return []

    # Build root→leaf path from merged (keep only ancestor chain: no level gaps
    # that would imply a missing parent)
    sorted_levels = sorted(merged.keys())
    path: list[dict] = []
    prev_level = 0
    for lvl in sorted_levels:
        # Accept level if it is the root level, or directly follows the previous
        # accepted level (no skip of more than 1 level in the chain)
        if prev_level == 0 or lvl <= prev_level + 2:
            path.append({"level": lvl, "title": merged[lvl]})
            prev_level = lvl

    return path
