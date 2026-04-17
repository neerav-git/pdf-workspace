#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# pdf-workspace — diagnose.sh
#
# Smoke-tests every service and API endpoint. Reports what's broken and why.
# Usage:
#   ./diagnose.sh           # read-only check + curl smoke tests
#   ./diagnose.sh --fix     # same, then attempt to restart failed services
#   ./diagnose.sh --tests   # also run the full pytest suite after checks
#   ./diagnose.sh --fix --tests   # fix + run tests
# ─────────────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/logs"
CONDA_BASE=/opt/anaconda3
CONDA_ENV=pdf-workspace

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

MODE_FIX=false
MODE_TESTS=false
for arg in "$@"; do
  [[ "$arg" == "--fix" ]]   && MODE_FIX=true
  [[ "$arg" == "--tests" ]] && MODE_TESTS=true
done

PASS=0
FAIL=0
WARN=0
FIXES_ATTEMPTED=()

# ── helpers ───────────────────────────────────────────────────────────────────

ok()   { echo -e "  ${GREEN}✓${NC}  $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${NC}  $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}!${NC}  $1"; ((WARN++)); }
info() { echo -e "      ${CYAN}$1${NC}"; }
hdr()  { echo -e "\n${BOLD}$1${NC}"; }

port_in_use() { lsof -Pi ":$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

http_get() {
  # http_get <url> — returns HTTP status code
  curl -s -o /tmp/diag_resp.json -w "%{http_code}" --max-time 5 "$1" 2>/dev/null
}

last_log_lines() {
  local log="$LOGS/$1.log"
  [ -f "$log" ] && tail -8 "$log" | sed 's/^/        /' || echo "        (no log file)"
}

fix_service() {
  # fix_service <name> <port> <start_command...>
  local name=$1 port=$2; shift 2
  if $MODE_FIX; then
    warn "$name is down — attempting restart…"
    eval "$@"
    sleep 3
    if port_in_use "$port"; then
      ok "$name restarted successfully"
      FIXES_ATTEMPTED+=("$name: restarted")
    else
      fail "$name failed to restart"
      FIXES_ATTEMPTED+=("$name: restart FAILED")
    fi
  else
    info "Run with --fix to attempt automatic restart"
  fi
}

# ── banner ────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  pdf-workspace  —  diagnostics"
$MODE_FIX   && echo "  mode: --fix enabled (will restart failed services)"
$MODE_TESTS && echo "  mode: --tests enabled (pytest will run after checks)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Service port checks ────────────────────────────────────────────────────

hdr "1/5  Service port checks"

if port_in_use 5432; then
  ok "PostgreSQL      :5432"
else
  fail "PostgreSQL      :5432  — not listening"
  info "Fix: brew services start postgresql"
  info "  or: pg_ctl -D /usr/local/var/postgresql start"
  last_log_lines "backend"
  if $MODE_FIX; then
    brew services start postgresql 2>/dev/null || true
    sleep 2
    port_in_use 5432 && { ok "PostgreSQL restarted"; FIXES_ATTEMPTED+=("postgres: restarted"); } \
                      || { fail "PostgreSQL still down after restart attempt"; FIXES_ATTEMPTED+=("postgres: restart FAILED"); }
  fi
fi

if port_in_use 8001; then
  ok "ChromaDB        :8001"
else
  fail "ChromaDB        :8001  — not listening"
  info "Fix: chroma run --path ./chroma_data --port 8001"
  last_log_lines "chroma"
  fix_service "ChromaDB" 8001 \
    "chroma run --path '$ROOT/chroma_data' --port 8001 > '$LOGS/chroma.log' 2>&1 & echo \$! > '$LOGS/chroma.pid'"
fi

if port_in_use 8000; then
  ok "Backend (FastAPI):8000"
else
  fail "Backend (FastAPI):8000  — not listening"
  info "Fix: cd backend && conda activate pdf-workspace && uvicorn app.main:app --reload"
  last_log_lines "backend"
  fix_service "Backend" 8000 \
    "source '$CONDA_BASE/etc/profile.d/conda.sh' && conda activate '$CONDA_ENV' && cd '$ROOT/backend' && uvicorn app.main:app --reload --port 8000 > '$LOGS/backend.log' 2>&1 & echo \$! > '$LOGS/backend.pid' && cd '$ROOT'"
fi

if port_in_use 5173; then
  ok "Frontend (Vite)  :5173"
else
  fail "Frontend (Vite)  :5173  — not listening"
  info "Fix: cd frontend && npm run dev"
  last_log_lines "frontend"
  fix_service "Frontend" 5173 \
    "cd '$ROOT/frontend' && npm run dev > '$LOGS/frontend.log' 2>&1 & echo \$! > '$LOGS/frontend.pid' && cd '$ROOT'"
fi

# ── 2. Backend health endpoints ───────────────────────────────────────────────

hdr "2/5  Backend health endpoints"

if ! port_in_use 8000; then
  warn "Backend is down — skipping HTTP checks"
else
  STATUS=$(http_get "http://localhost:8000/health")
  if [ "$STATUS" = "200" ]; then
    ok "GET /health  →  200"
  else
    fail "GET /health  →  $STATUS (expected 200)"
  fi

  STATUS=$(http_get "http://localhost:8000/health/detailed")
  if [ "$STATUS" = "200" ]; then
    DETAIL=$(cat /tmp/diag_resp.json)
    OVERALL=$(echo "$DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null)
    if [ "$OVERALL" = "ok" ]; then
      ok "GET /health/detailed  →  status: ok"
    else
      warn "GET /health/detailed  →  status: $OVERALL"
      # Print per-service breakdown
      echo "$DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for svc, v in d.get('services',{}).items():
    if isinstance(v, dict):
        status = '✓' if v.get('ok', True) else '✗'
        err = v.get('error','')
        print(f'        {status} {svc}' + (f': {err}' if err else ''))
" 2>/dev/null
    fi

    # Individual service check results
    echo "$DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)
svcs = d.get('services', {})
checks = {
    'postgres':  ('Postgres',  svcs.get('postgres',  {}).get('ok', False), svcs.get('postgres',  {}).get('error','')),
    'chromadb':  ('ChromaDB',  svcs.get('chromadb',  {}).get('ok', False), svcs.get('chromadb',  {}).get('error','')),
    's3':        ('S3',        svcs.get('s3',        {}).get('ok', False), svcs.get('s3',        {}).get('error','')),
}
for k, (name, ok, err) in checks.items():
    sym = '✓' if ok else '✗'
    line = f'  {sym}  {name} connectivity'
    if not ok and err:
        line += f'  — {err}'
    print(line)
" 2>/dev/null

    # API key presence
    echo "$DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)
keys = d.get('services', {}).get('api_keys', {})
for k, v in keys.items():
    sym = '✓' if v else '✗'
    print(f'  {sym}  {k} API key present' if v else f'  ✗  {k} API key MISSING from .env')
" 2>/dev/null
  else
    fail "GET /health/detailed  →  $STATUS"
  fi
fi

# ── 3. PDF API smoke tests ────────────────────────────────────────────────────

hdr "3/5  PDF API smoke tests"

if ! port_in_use 8000; then
  warn "Backend is down — skipping PDF API checks"
else
  STATUS=$(http_get "http://localhost:8000/api/pdfs")
  if [ "$STATUS" = "200" ]; then
    COUNT=$(python3 -c "import json; d=json.load(open('/tmp/diag_resp.json')); print(len(d))" 2>/dev/null || echo "?")
    ok "GET /api/pdfs  →  200  ($COUNT PDFs in library)"
  else
    fail "GET /api/pdfs  →  $STATUS"
  fi

  # Try to get first PDF id for further tests
  FIRST_ID=$(python3 -c "
import json
try:
    d = json.load(open('/tmp/diag_resp.json'))
    print(d[0]['id'] if d else '')
except:
    print('')
" 2>/dev/null)

  if [ -n "$FIRST_ID" ]; then
    STATUS=$(http_get "http://localhost:8000/api/pdfs/$FIRST_ID/url")
    [ "$STATUS" = "200" ] && ok "GET /api/pdfs/$FIRST_ID/url  →  200" \
                           || fail "GET /api/pdfs/$FIRST_ID/url  →  $STATUS"

    STATUS=$(http_get "http://localhost:8000/api/pdfs/$FIRST_ID/toc")
    if [ "$STATUS" = "200" ]; then
      MODE=$(python3 -c "import json; d=json.load(open('/tmp/diag_resp.json')); print(d.get('mode','?'))" 2>/dev/null)
      ITEMS=$(python3 -c "import json; d=json.load(open('/tmp/diag_resp.json')); print(len(d.get('items',[])))" 2>/dev/null)
      ok "GET /api/pdfs/$FIRST_ID/toc  →  200  (mode=$MODE, $ITEMS items)"
    else
      fail "GET /api/pdfs/$FIRST_ID/toc  →  $STATUS"
    fi

    # Test 404 on non-existent id
    STATUS=$(http_get "http://localhost:8000/api/pdfs/999999/url")
    [ "$STATUS" = "404" ] && ok "404 on missing PDF id  →  correct" \
                           || fail "404 on missing PDF id  →  got $STATUS (expected 404)"
  else
    warn "No PDFs in library — skipping per-PDF endpoint checks"
    info "Upload a PDF via the UI or:  curl -X POST http://localhost:8000/api/pdfs/upload -F 'file=@yourfile.pdf'"
  fi
fi

# ── 4. Environment / config checks ───────────────────────────────────────────

hdr "4/5  Environment checks"

ENV_FILE="$ROOT/backend/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env file exists at backend/.env"
  for key in ANTHROPIC_API_KEY OPENAI_API_KEY AWS_ACCESS_KEY_ID AWS_BUCKET_NAME DATABASE_URL; do
    if grep -q "^${key}=.\+" "$ENV_FILE" 2>/dev/null; then
      ok "$key  is set"
    else
      fail "$key  is MISSING or empty in backend/.env"
      info "Add it to backend/.env:  $key=<value>"
    fi
  done
else
  fail "backend/.env file not found"
  info "Copy the template:  cp backend/.env.example backend/.env  and fill in values"
fi

# Check conda env
if command -v conda &>/dev/null; then
  if conda env list 2>/dev/null | grep -q "$CONDA_ENV"; then
    ok "conda env '$CONDA_ENV' exists"
  else
    fail "conda env '$CONDA_ENV' not found"
    info "Create it:  conda create -n $CONDA_ENV python=3.12 && conda activate $CONDA_ENV && cd backend && pip install -r requirements.txt"
  fi
else
  warn "conda not found in PATH — backend may not start correctly"
fi

# Check node/npm
if command -v node &>/dev/null; then
  ok "node $(node --version)"
else
  warn "node not in PATH — frontend may not start"
  info "Load nvm:  export NVM_DIR=\"\$HOME/.nvm\" && source \"\$NVM_DIR/nvm.sh\""
fi

# ── 5. Log tail for running services ─────────────────────────────────────────

hdr "5/5  Recent log activity"

for svc in backend chroma frontend; do
  LOG="$LOGS/$svc.log"
  if [ -f "$LOG" ]; then
    ERRORS=$(grep -ciE "error|exception|traceback|failed|critical" "$LOG" 2>/dev/null || echo 0)
    LINES=$(wc -l < "$LOG" 2>/dev/null || echo 0)
    if [ "$ERRORS" -gt 0 ]; then
      warn "$svc.log  ($LINES lines, ${RED}$ERRORS error/exception lines${NC}${YELLOW})"
      grep -iE "error|exception|traceback|failed|critical" "$LOG" | tail -3 | sed 's/^/        /'
    else
      ok "$svc.log  ($LINES lines, no errors)"
    fi
  else
    info "$svc.log not found (service hasn't been started via start.sh)"
  fi
done

# ── 6. pytest suite (optional) ───────────────────────────────────────────────

if $MODE_TESTS; then
  hdr "6/6  pytest suite"
  if ! port_in_use 8000; then
    fail "Backend not running — cannot run tests"
  else
    source "$CONDA_BASE/etc/profile.d/conda.sh" 2>/dev/null
    conda activate "$CONDA_ENV" 2>/dev/null
    if ! python -c "import pytest" 2>/dev/null; then
      warn "pytest not installed — installing now…"
      pip install pytest httpx --quiet
    fi
    cd "$ROOT/backend"
    echo ""
    pytest tests/ -v --tb=short 2>&1
    cd "$ROOT"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Results: ${GREEN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YELLOW}$WARN warnings${NC}"

if [ ${#FIXES_ATTEMPTED[@]} -gt 0 ]; then
  echo ""
  echo "  Auto-fix attempts:"
  for f in "${FIXES_ATTEMPTED[@]}"; do
    echo "    • $f"
  done
fi

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "  Quick reference:"
  echo "    All services:   ./start.sh"
  echo "    Backend logs:   tail -f logs/backend.log"
  echo "    ChromaDB logs:  tail -f logs/chroma.log"
  echo "    Full fix pass:  ./diagnose.sh --fix --tests"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Exit non-zero if anything failed (useful in CI or scripted contexts)
[ "$FAIL" -eq 0 ]
