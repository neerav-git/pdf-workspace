# pdf-workspace — Session Startup Guide

## Quickest way (one command)

```bash
cd ~/Desktop/pdf-workspace
./start.sh
```

Then open **http://localhost:5173**

---

## What needs to be running

| Service | Port | What it does |
|---|---|---|
| PostgreSQL | 5432 | PDF metadata, (future) highlights/notes |
| ChromaDB | 8001 | Vector embeddings for RAG search |
| Backend (FastAPI) | 8000 | API — upload, chat, voice, TOC |
| Frontend (Vite) | 5173 | The app UI |

Check status anytime: `./status.sh`
Stop everything: `./stop.sh`

---

## If start.sh fails — manual steps

Open **4 terminal tabs/windows** and run one command in each:

**Tab 1 — PostgreSQL** (may already be running as a system service)
```bash
brew services start postgresql
# or if that's not set up:
pg_ctl -D /usr/local/var/postgresql start
```

**Tab 2 — ChromaDB**
```bash
cd ~/Desktop/pdf-workspace
chroma run --path ./chroma_data --port 8001
```

**Tab 3 — Backend**
```bash
cd ~/Desktop/pdf-workspace/backend
conda activate pdf-workspace
uvicorn app.main:app --reload --port 8000
```

**Tab 4 — Frontend**
```bash
cd ~/Desktop/pdf-workspace/frontend
npm run dev
```

---

## Troubleshooting

**Port already in use**
```bash
# Find and kill what's on a port (e.g. 8000)
lsof -ti :8000 | xargs kill -9
```

**Backend crashes on start**
```bash
tail -50 logs/backend.log
# Most common cause: conda env not activated, or missing .env vars
```

**ChromaDB won't connect**
```bash
tail -20 logs/chroma.log
# Check it's on port 8001 (not the default 8000)
```

**"Module not found" in backend**
```bash
conda activate pdf-workspace
pip install -r backend/requirements.txt
```

**Frontend shows blank page after code changes**
```bash
# Hard refresh: Cmd+Shift+R
# Or restart: kill the Vite tab and re-run npm run dev
```

---

## .env checklist (backend/.env)

If the backend starts but features don't work, check these are set:

```
ANTHROPIC_API_KEY=        ← chat / Q&A
OPENAI_API_KEY=           ← voice transcription
TAVILY_API_KEY=           ← web search fallback
AWS_ACCESS_KEY_ID=        ← PDF file storage
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pdfworkspace
CHROMA_HOST=localhost
CHROMA_PORT=8001
```

---

## Debug endpoints (paste responses to Claude)

```
GET http://localhost:8000/health/detailed
```
Returns connectivity status for Postgres, ChromaDB, S3, and whether API keys are set.
Paste the JSON and I can tell you exactly what's broken.

```
GET http://localhost:8000/api/pdfs/{id}/toc/debug
```
Returns font-size statistics and the first/last 10 heading candidates found.
Useful when the generated ToC looks wrong or stops early.

---

## Logs

```
logs/backend.log    ← FastAPI errors, RAG queries
logs/chroma.log     ← ChromaDB server
logs/frontend.log   ← Vite build errors
```

Live-tail any log:
```bash
tail -f logs/backend.log
```
