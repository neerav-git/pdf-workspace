#!/bin/bash
# ─────────────────────────────────────────────────────────────
# pdf-workspace — check service status
# ─────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

port_in_use() { lsof -Pi ":$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

check() {
  local name=$1 port=$2 note=$3
  if port_in_use "$port"; then
    echo -e "  ${GREEN}✓${NC}  $name  (:$port)  $note"
  else
    echo -e "  ${RED}✗${NC}  $name  (:$port)  — NOT running"
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  pdf-workspace  —  service status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
check "PostgreSQL" 5432 ""
check "ChromaDB  " 8001 ""
check "Backend   " 8000 "FastAPI / uvicorn"
check "Frontend  " 5173 "Vite → http://localhost:5173"
echo ""

# Show recent errors from logs if services are down
ROOT="$(cd "$(dirname "$0")" && pwd)"
for svc in backend chroma frontend; do
  log="$ROOT/logs/$svc.log"
  if [ -f "$log" ] && ! port_in_use "$([ "$svc" = backend ] && echo 8000 || [ "$svc" = chroma ] && echo 8001 || echo 5173)" 2>/dev/null; then
    echo "  Last 5 lines of logs/$svc.log:"
    tail -5 "$log" | sed 's/^/    /'
    echo ""
  fi
done
