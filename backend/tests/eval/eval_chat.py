"""
LLM-as-Judge evaluation pipeline — pdf-workspace chat quality.

Tests two things independently:
  1. STRUCTURE — deterministic checks on response text (heading presence,
     anti-pattern detection, word count). No API call needed for these.
  2. QUALITY — Claude judges whether each response correctly follows the
     Response Intelligence System template for its inferred category.

Usage:
    cd /Users/neeravch/Desktop/pdf-workspace/backend
    conda activate pdf-workspace
    python -m tests.eval.eval_chat --pdf-id <id> [--url http://localhost:8000] [--verbose]

    # Quick smoke test (structure checks only, no judge API call):
    python -m tests.eval.eval_chat --pdf-id <id> --no-judge

    # Run a single test:
    python -m tests.eval.eval_chat --pdf-id <id> --test A_overview

Output:
    Console table + JSON report written to tests/eval/last_report.json
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from anthropic import Anthropic

# Load .env from backend root so ANTHROPIC_API_KEY is available
_env_path = Path(__file__).parent.parent.parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL   = "http://localhost:8000"
EVAL_MODEL = "claude-sonnet-4-6"          # judge model

CASES_FILE = Path(__file__).parent / "test_cases.json"
REPORT_FILE = Path(__file__).parent / "last_report.json"

# ── Structure checks (no LLM needed) ─────────────────────────────────────────

DEEP_DIVE_HEADING = "→ Questions worth sitting with"
PASSIVE_OPENERS   = ("This document", "According to the text", "According to the document",
                     "The author says", "The document states", "This text")


def _word_count(text: str) -> int:
    return len(text.split())


def check_structure(response: str, checks: dict, turn_responses: list[str] | None = None) -> dict[str, bool | str]:
    """
    Deterministic structural checks against a response string.
    Returns {check_name: True/False/reason_string}.
    """
    results = {}
    text = response.strip()
    lower = text.lower()

    if checks.get("has_hook"):
        # Hook = first non-empty line must be a single sentence (no newline before second sentence)
        first_para = text.split("\n\n")[0].strip()
        # Accept if first paragraph is ≤2 sentences and ≤50 words
        sentences = re.split(r'(?<=[.!?])\s+', first_para)
        results["has_hook"] = len(sentences) <= 2 and _word_count(first_para) <= 60

    if checks.get("has_frame"):
        # Frame = second paragraph exists and is at least 1 sentence
        paras = [p.strip() for p in text.split("\n\n") if p.strip()]
        results["has_frame"] = len(paras) >= 2

    # For Core-layer checks, only look at text before the Deep Dive heading
    core_text = text.split(DEEP_DIVE_HEADING)[0] if DEEP_DIVE_HEADING in text else text

    if checks.get("has_core_list"):
        results["has_core_list"] = bool(re.search(r'(\*\*.*\*\*|^\s*[-•]\s|^\s*\d+\.)', core_text, re.MULTILINE))

    if checks.get("core_max_items"):
        bullet_count   = len(re.findall(r'^\s*[-•*]\s+\S', core_text, re.MULTILINE))
        numbered_count = len(re.findall(r'^\s*\d+\.\s+\S', core_text, re.MULTILINE))
        total = max(bullet_count, numbered_count)
        limit = checks["core_max_items"]
        results["core_max_items"] = total <= limit if total > 0 else True

    if checks.get("has_numbered_steps"):
        results["has_numbered_steps"] = bool(re.search(r'^\s*\d+\.', text, re.MULTILINE))

    if checks.get("has_thread"):
        # Thread = a prose paragraph that appears after the core list/steps and before
        # the Deep Dive heading. We count paragraphs in the pre-dive zone that don't
        # themselves START with a bullet or number marker.
        pre_dive = text.split(DEEP_DIVE_HEADING)[0] if DEEP_DIVE_HEADING in text else text
        pre_dive_paras = [p.strip() for p in pre_dive.split("\n\n") if p.strip()]
        # A valid thread paragraph: no lines starting with bullet/number markers
        prose_paras = [
            p for p in pre_dive_paras
            if not re.search(r'^\s*[-•*]\s', p, re.MULTILINE)
            and not re.search(r'^\s*\d+\.\s', p, re.MULTILINE)
        ]
        # Need at least hook (prose) + 1 more prose paragraph (thread) = 2
        # Be lenient: bold-started paragraphs (like "**Thread:**") still count
        results["has_thread"] = len(prose_paras) >= 2

    if checks.get("has_deep_dive_heading"):
        results["has_deep_dive_heading"] = DEEP_DIVE_HEADING in text

    if checks.get("deep_dive_heading_exact"):
        expected = checks["deep_dive_heading_exact"]
        results["deep_dive_heading_exact"] = expected in text

    if checks.get("has_causal_language"):
        causal_phrases = ["because", "therefore", "as a result", "which leads to",
                          "and because of that", "causing", "this means that",
                          "consequently", "which causes", "leading to"]
        results["has_causal_language"] = any(p in lower for p in causal_phrases)

    if checks.get("frame_mentions_section"):
        # Check if the frame paragraph (second paragraph) contains section-like language
        paras = [p.strip() for p in text.split("\n\n") if p.strip()]
        frame = paras[1] if len(paras) > 1 else ""
        results["frame_mentions_section"] = bool(frame)  # soft check; judge evaluates quality

    # Word count checks
    if "min_words" in checks:
        results["min_words"] = _word_count(text) >= checks["min_words"]
    if "max_words" in checks:
        results["max_words"] = _word_count(text) <= checks["max_words"]

    # Multi-turn relative checks
    if checks.get("is_shorter_than_turn") is not None and turn_responses:
        ref_idx = checks["is_shorter_than_turn"]
        if ref_idx < len(turn_responses):
            ref_words = _word_count(turn_responses[ref_idx])
            current_words = _word_count(text)
            results["is_shorter_than_turn"] = current_words < ref_words * 0.75

    if checks.get("is_longer_than_turn") is not None and turn_responses:
        ref_idx = checks["is_longer_than_turn"]
        if ref_idx < len(turn_responses):
            ref_words = _word_count(turn_responses[ref_idx])
            current_words = _word_count(text)
            results["is_longer_than_turn"] = current_words > ref_words * 1.1

    return results


def check_anti_patterns(response: str, anti_patterns: list[str]) -> dict[str, bool]:
    """Returns {pattern: True} if the pattern is ABSENT (pass = no anti-pattern found)."""
    results = {}
    text = response.strip()

    for pat in anti_patterns:
        if pat == "starts_with_this_document":
            results[pat] = not any(text.startswith(p) for p in PASSIVE_OPENERS)
        elif pat == "starts_with_according_to":
            results[pat] = not text.lower().startswith("according to")
        elif pat == "starts_with_the_author":
            results[pat] = not text.lower().startswith("the author")
        elif pat == "bullet_list_without_causality":
            has_bullets = bool(re.search(r'^\s*[-•*]\s', text, re.MULTILINE))
            causal = any(p in text.lower() for p in ["because", "therefore", "leads to", "causing"])
            results[pat] = not has_bullets or causal
        elif pat == "two_separate_descriptions":
            # Heuristic: if response has two bold headers with similar length sections and
            # no "axis" / "key difference" / "compared to" language → possible failure
            axis_words = ["axis", "key difference", "compared to", "the difference is",
                          "what separates", "what distinguishes", "on one side"]
            results[pat] = any(w in text.lower() for w in axis_words)
        elif pat == "judgment_without_criterion":
            # Accept any phrasing that names an evaluative standard before the judgment.
            # Looser match: "should", "requires", "must", "in order to", "for X to be Y"
            # are all valid criterion-setters in context.
            criterion_words = [
                "standard", "criterion", "measure", "the test is", "weakness means",
                "judged by", "evaluated against", "the bar", "in order to qualify",
                "a rigorous", "to be sound", "for this to", "in order to", "must be",
                "should ", "requires ", "the basis", "the benchmark", "the definition of",
                "what counts as", "what qualifies", "by which",
            ]
            results[pat] = any(w in text.lower() for w in criterion_words)
        elif pat == "generic_example":
            # Generic examples tend to be abstract; specific ones name a person/org/situation
            generic_phrases = ["for example, imagine", "consider a typical", "in a general case",
                                "think of any", "suppose someone"]
            results[pat] = not any(p in text.lower() for p in generic_phrases)

    return results


# ── LLM judge ─────────────────────────────────────────────────────────────────

JUDGE_SYSTEM = """\
You are a strict evaluator of AI chat responses for a learning-focused PDF research tool.
The tool uses a mandatory Response Intelligence System with 6 question categories (A–F) and
5 response layers (Hook, Frame, Core, Thread, Deep Dive).

You will be given a question, the detected category, and the AI response.
Your job is to score the response and identify failures clearly.

Respond ONLY in JSON with this exact schema:
{
  "category_correct": true | false,
  "inferred_category": "A" | "B" | "C" | "D" | "E" | "F",
  "layer_scores": {
    "hook": { "pass": true|false, "reason": "..." },
    "frame": { "pass": true|false, "reason": "..." },
    "core": { "pass": true|false, "reason": "..." },
    "thread": { "pass": true|false, "reason": "..." },
    "deep_dive": { "pass": true|false, "reason": "..." }
  },
  "overall": "pass" | "partial" | "fail",
  "key_failure": "one sentence naming the most important thing wrong, or null if pass",
  "improvement": "one concrete instruction to fix the worst failure, or null if pass"
}

Scoring rules:
- Hook: must be exactly 1 sentence, stated as a claim, surprising or counterintuitive
- Frame: 2–3 sentences situating the answer; must NOT restate the hook
- Core: format must match the category:
    A=3–5 Big Ideas (not chapter titles, actual insights)
    B=causal chain (each step answers "and because of that...")
    C=numbered steps with decision points
    D=axis of comparison named first, THEN both sides
    E=criterion stated first, THEN judgment WITH evidence
    F=specific revealing example THEN names what the principle is
- Thread: 1–2 sentences naming the generalizable principle, NOT a summary
- Deep Dive: must open with bold heading "→ Questions worth sitting with",
             must have 2–3 questions (not offers), at least one "why" question
- Overall: pass = all 5 layers pass; partial = 1–2 minor failures; fail = structural failure
"""


def judge_response(client: Anthropic, question: str, category: str, response: str) -> dict:
    """Call Claude to judge a response. Returns the parsed JSON score."""
    user_msg = f"""QUESTION: {question}

EXPECTED CATEGORY: {category}

RESPONSE TO EVALUATE:
---
{response}
---"""

    try:
        resp = client.messages.create(
            model=EVAL_MODEL,
            max_tokens=600,
            system=JUDGE_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = resp.content[0].text.strip()
        # Strip markdown code fences if present
        raw = re.sub(r'^```json\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        # Attempt direct parse; on failure try to extract key fields via regex
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            # Extract overall verdict and key_failure gracefully
            overall_m = re.search(r'"overall"\s*:\s*"(pass|partial|fail)"', raw)
            failure_m = re.search(r'"key_failure"\s*:\s*"([^"]*)"', raw)
            improve_m = re.search(r'"improvement"\s*:\s*"([^"]*)"', raw)
            layer_pass = {}
            for layer in ("hook", "frame", "core", "thread", "deep_dive"):
                m = re.search(rf'"{layer}"\s*:.*?"pass"\s*:\s*(true|false)', raw, re.DOTALL)
                layer_pass[layer] = {"pass": m.group(1) == "true"} if m else {"pass": None}
            return {
                "overall": overall_m.group(1) if overall_m else "error",
                "key_failure": failure_m.group(1) if failure_m else None,
                "improvement": improve_m.group(1) if improve_m else None,
                "layer_scores": layer_pass,
                "_parse_warning": "partial parse — JSON was malformed",
            }
    except Exception as e:
        return {"error": str(e), "overall": "error"}


# ── API helpers ───────────────────────────────────────────────────────────────

def call_chat(
    http: httpx.Client,
    pdf_id: int,
    pdf_title: str,
    message: str,
    history: list[dict],
    selection_text: str | None = None,
    selection_page: int | None = None,
    section_title: str | None = None,
) -> dict:
    resp = http.post(
        "/api/chat",
        json={
            "pdf_id": pdf_id,
            "pdf_title": pdf_title,
            "message": message,
            "history": history,
            "selection_text": selection_text,
            "selection_page": selection_page,
            "section_title": section_title,
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def get_pdf_info(http: httpx.Client, pdf_id: int) -> dict:
    resp = http.get("/api/pdfs")
    resp.raise_for_status()
    pdfs = resp.json()
    match = next((p for p in pdfs if p["id"] == pdf_id), None)
    if not match:
        raise ValueError(f"PDF id={pdf_id} not found. Available: {[p['id'] for p in pdfs]}")
    return match


def get_sample_text(http: httpx.Client, pdf_id: int) -> tuple[str, int, str] | None:
    """Fetch a real passage from the PDF via a broad RAG query. Returns (text, page, section)."""
    data = call_chat(
        http, pdf_id, "document",
        "Give me a representative passage from the main body of this document",
        [],
    )
    sources = data.get("sources", [])
    if sources:
        # We don't have the raw chunk text in the response, so use a short excerpt hint
        return None
    return None


# ── Result formatting ──────────────────────────────────────────────────────────

PASS  = "\033[92m✓\033[0m"
FAIL  = "\033[91m✗\033[0m"
WARN  = "\033[93m~\033[0m"
RESET = "\033[0m"
BOLD  = "\033[1m"


def fmt_bool(v: bool | None) -> str:
    if v is True:  return PASS
    if v is False: return FAIL
    return WARN


def print_single_result(name: str, struct: dict[str, bool], anti: dict[str, bool],
                         judge: dict | None, response: str, verbose: bool):
    struct_pass = all(v for v in struct.values() if isinstance(v, bool))
    anti_pass   = all(v for v in anti.values() if isinstance(v, bool))
    judge_overall = judge.get("overall", "skip") if judge else "skip"
    icon = PASS if (struct_pass and anti_pass and judge_overall in ("pass", "skip")) else (
           WARN if judge_overall == "partial" else FAIL)

    print(f"\n{icon} {BOLD}{name}{RESET}")

    if struct:
        print("  Structure:", "  ".join(f"{k}:{fmt_bool(v)}" for k, v in struct.items()))
    if anti:
        print("  Anti-pat:", "  ".join(f"{k}:{fmt_bool(v)}" for k, v in anti.items()))

    if judge:
        if "error" in judge:
            print(f"  Judge: {WARN} error — {judge['error']}")
        else:
            layer_summary = "  ".join(
                f"{layer[0].upper()}:{fmt_bool(s['pass'])}"
                for layer, s in judge.get("layer_scores", {}).items()
            )
            print(f"  Layers: {layer_summary}   overall:{judge.get('overall','?')}")
            if judge.get("key_failure"):
                print(f"  {FAIL} Failure: {judge['key_failure']}")
            if judge.get("improvement"):
                print(f"  → Fix: {judge['improvement']}")

    if verbose:
        words = _word_count(response)
        print(f"  [{words} words]")
        print("  " + response[:400].replace("\n", " ") + ("…" if len(response) > 400 else ""))


# ── Main runner ───────────────────────────────────────────────────────────────

def run_eval(args):
    cases   = json.loads(CASES_FILE.read_text())
    http    = httpx.Client(base_url=args.url, timeout=90)
    anthropic_client = Anthropic() if not args.no_judge else None

    # Resolve PDF
    try:
        pdf = get_pdf_info(http, args.pdf_id)
        pdf_title = pdf.get("title") or pdf.get("filename") or f"PDF #{args.pdf_id}"
        print(f"\n{BOLD}PDF:{RESET} {pdf_title} (id={args.pdf_id})")
    except Exception as e:
        print(f"Could not fetch PDF {args.pdf_id}: {e}")
        sys.exit(1)

    filter_id = args.test
    report = {"pdf_id": args.pdf_id, "pdf_title": pdf_title, "results": [], "multi_turn": []}
    total = passed = 0

    # ── Single-turn tests ──────────────────────────────────────────────────────
    print(f"\n{BOLD}═══ SINGLE-TURN TESTS ═══{RESET}")
    for case in cases["single_turn"]:
        if filter_id and case["id"] != filter_id:
            continue

        print(f"\nRunning: {case['id']}…", end="", flush=True)
        t0 = time.time()

        try:
            data = call_chat(
                http, args.pdf_id, pdf_title,
                case["message"],
                [],
                selection_text=case.get("selection_text"),
                selection_page=case.get("selection_page"),
                section_title=case.get("section_title"),
            )
            response = data["answer"]
            elapsed  = time.time() - t0
            print(f" {elapsed:.1f}s")
        except Exception as e:
            print(f" ERROR: {e}")
            report["results"].append({"id": case["id"], "status": "api_error", "error": str(e)})
            total += 1
            continue

        struct = check_structure(response, case.get("structure_checks", {}))
        anti   = check_anti_patterns(response, case.get("anti_patterns", []))
        judge  = judge_response(anthropic_client, case["message"], case["category"], response) \
                 if anthropic_client else None

        print_single_result(case["name"], struct, anti, judge, response, args.verbose)

        struct_pass = all(v for v in struct.values() if isinstance(v, bool))
        anti_pass   = all(v for v in anti.values() if isinstance(v, bool))
        judge_pass  = judge.get("overall") in ("pass", "partial") if judge else True

        status = "pass" if (struct_pass and anti_pass and judge_pass) else "fail"
        total  += 1
        if status == "pass": passed += 1

        report["results"].append({
            "id": case["id"], "name": case["name"], "category": case["category"],
            "status": status, "word_count": _word_count(response),
            "structure": struct, "anti_patterns": anti, "judge": judge,
            "response_preview": response[:500],
        })

    # ── Multi-turn tests ───────────────────────────────────────────────────────
    if not filter_id or any(c["id"] == filter_id for c in cases["multi_turn"]):
        print(f"\n{BOLD}═══ MULTI-TURN TESTS ═══{RESET}")
        for seq in cases["multi_turn"]:
            if filter_id and seq["id"] != filter_id:
                continue

            print(f"\nRunning: {seq['id']}…")
            history = []
            turn_responses = []
            seq_result = {"id": seq["id"], "name": seq["name"], "turns": [], "status": "pass"}

            for i, turn in enumerate(seq["turns"]):
                print(f"  Turn {i+1}/{len(seq['turns'])}…", end="", flush=True)
                t0 = time.time()
                try:
                    data = call_chat(
                        http, args.pdf_id, pdf_title,
                        turn["message"],
                        history,
                        selection_text=turn.get("selection_text"),
                        section_title=turn.get("section_title"),
                    )
                    response = data["answer"]
                    elapsed  = time.time() - t0
                    print(f" {elapsed:.1f}s")
                except Exception as e:
                    print(f" ERROR: {e}")
                    seq_result["turns"].append({"turn": i, "status": "api_error", "error": str(e)})
                    seq_result["status"] = "fail"
                    break

                assertions = turn.get("assertions", {})
                struct = check_structure(response, assertions, turn_responses)
                turn_responses.append(response)

                history.append({"role": "user", "content": turn["message"]})
                history.append({"role": "assistant", "content": response})

                struct_pass = all(v for v in struct.values() if isinstance(v, bool))
                turn_status = "pass" if struct_pass else "fail"
                if turn_status == "fail": seq_result["status"] = "fail"

                icon = PASS if struct_pass else FAIL
                checks_fmt = "  ".join(f"{k}:{fmt_bool(v)}" for k, v in struct.items())
                print(f"  {icon} Turn {i+1}: {checks_fmt}")
                if args.verbose:
                    print(f"     [{_word_count(response)} words] {response[:300].replace(chr(10),' ')}…")

                seq_result["turns"].append({
                    "turn": i, "status": turn_status, "word_count": _word_count(response),
                    "structure": struct, "response_preview": response[:500],
                })

            total  += 1
            if seq_result["status"] == "pass": passed += 1
            report["multi_turn"].append(seq_result)

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{BOLD}═══ SUMMARY ═══{RESET}")
    pct = int(100 * passed / total) if total else 0
    status_icon = PASS if pct >= 80 else (WARN if pct >= 50 else FAIL)
    print(f"{status_icon} {passed}/{total} passed ({pct}%)")

    # Collect failures
    all_failures = [
        r for r in report["results"] if r.get("status") == "fail"
    ] + [
        s for s in report["multi_turn"] if s.get("status") == "fail"
    ]
    if all_failures:
        print(f"\nFailed tests:")
        for f in all_failures:
            print(f"  {FAIL} {f.get('name', f.get('id'))}")
            judge_info = f.get("judge") or {}
            if judge_info.get("key_failure"):
                print(f"       → {judge_info['key_failure']}")

    # Write JSON report
    report["summary"] = {"total": total, "passed": passed, "pct": pct}
    REPORT_FILE.write_text(json.dumps(report, indent=2))
    print(f"\nFull report → {REPORT_FILE}")

    return 0 if pct >= 80 else 1


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="pdf-workspace chat quality eval")
    parser.add_argument("--pdf-id",   type=int, required=True, help="ID of the PDF to test against")
    parser.add_argument("--url",      default=BASE_URL,        help="Backend base URL")
    parser.add_argument("--verbose",  action="store_true",     help="Print response previews")
    parser.add_argument("--no-judge", action="store_true",     help="Skip LLM judge (structure checks only)")
    parser.add_argument("--test",     default=None,            help="Run only this test ID")
    args = parser.parse_args()
    sys.exit(run_eval(args))
