#!/bin/bash
# ─────────────────────────────────────────────────────────────
# pdf-workspace — start all services
# Run from the repo root: ./start.sh
# ─────────────────────────────────────────────────────────────

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"

CONDA_BASE=/opt/anaconda3
CONDA_ENV=pdf-workspace

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
info() { echo -e "  $1"; }

port_in_use() { lsof -Pi ":$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  pdf-workspace  —  starting services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. PostgreSQL (5432) ──────────────────────────────────────
if port_in_use 5432; then
  ok "PostgreSQL already running (:5432)"
else
  warn "PostgreSQL not detected on :5432"
  info "Start it with:  brew services start postgresql"
  info "Or:             pg_ctl -D /usr/local/var/postgresql start"
  echo ""
  read -p "  Continue anyway? (y/n) " -n 1 -r; echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# ── 2. ChromaDB (8001) ────────────────────────────────────────
if port_in_use 8001; then
  ok "ChromaDB already running (:8001)"
else
  info "Starting ChromaDB on :8001…"
  chroma run --path "$ROOT/chroma_data" --port 8001 \
    > "$LOGS/chroma.log" 2>&1 &
  echo $! > "$LOGS/chroma.pid"
  sleep 2
  if port_in_use 8001; then
    ok "ChromaDB started (PID $(cat "$LOGS/chroma.pid"), log: logs/chroma.log)"
  else
    echo -e "${RED}✗ ChromaDB failed to start — check logs/chroma.log${NC}"
    exit 1
  fi
fi

# ── 3. Backend / FastAPI (8000) ───────────────────────────────
if port_in_use 8000; then
  ok "Backend already running (:8000)"
else
  info "Starting FastAPI backend on :8000…"
  source "$CONDA_BASE/etc/profile.d/conda.sh"
  conda activate "$CONDA_ENV"
  cd "$ROOT/backend"
  info "Applying Alembic migrations…"
  alembic upgrade head >> "$LOGS/backend.log" 2>&1 || \
    warn "Alembic upgrade returned non-zero — backend will still start (lifespan self-repairs schema)."
  uvicorn app.main:app --reload --port 8000 \
    >> "$LOGS/backend.log" 2>&1 &
  echo $! > "$LOGS/backend.pid"
  sleep 3
  if port_in_use 8000; then
    ok "Backend started (PID $(cat "$LOGS/backend.pid"), log: logs/backend.log)"
  else
    echo -e "${RED}✗ Backend failed to start — check logs/backend.log${NC}"
    exit 1
  fi
  cd "$ROOT"
fi

# ── 4. Frontend / Vite (5173) ─────────────────────────────────
if port_in_use 5173; then
  ok "Frontend already running (:5173)"
else
  info "Starting Vite dev server on :5173…"
  cd "$ROOT/frontend"
  npm run dev > "$LOGS/frontend.log" 2>&1 &
  echo $! > "$LOGS/frontend.pid"
  sleep 3
  if port_in_use 5173; then
    ok "Frontend started (PID $(cat "$LOGS/frontend.pid"), log: logs/frontend.log)"
  else
    echo -e "${RED}✗ Frontend failed to start — check logs/frontend.log${NC}"
    exit 1
  fi
  cd "$ROOT"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}All services up.${NC}"
echo "  Open: http://localhost:5173"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Useful commands:"
echo "    ./status.sh   — check what's running"
echo "    ./stop.sh     — stop all services"
echo "    tail -f logs/backend.log   — watch backend"
echo "    tail -f logs/chroma.log    — watch chromadb"
echo ""
