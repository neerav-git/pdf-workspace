#!/bin/bash
# ─────────────────────────────────────────────────────────────
# pdf-workspace — stop all services
# ─────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/logs"

GREEN='\033[0;32m'
NC='\033[0m'

kill_pid_file() {
  local name=$1 file="$LOGS/$2.pid"
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo -e "  ${GREEN}✓${NC} Stopped $name (PID $pid)"
    fi
    rm -f "$file"
  fi
}

echo ""
echo "Stopping pdf-workspace services…"
echo ""
kill_pid_file "Frontend (Vite)"    frontend
kill_pid_file "Backend (uvicorn)"  backend
kill_pid_file "ChromaDB"           chroma
echo ""
echo "Done. Run ./start.sh to restart."
echo ""
