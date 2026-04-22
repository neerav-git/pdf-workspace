from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.db.session import engine, Base, SessionLocal
# Import models so SQLAlchemy registers them before create_all
import app.models.pdf       # noqa: F401
import app.models.highlight  # noqa: F401
import app.models.review     # noqa: F401
from app.routers import pdfs, chat, voice, highlights, review, research
from app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Lightweight schema evolution — kept as belt-and-braces even after Alembic
    # migrations land, so fresh checkouts still self-repair on boot.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE qa_pairs ADD COLUMN IF NOT EXISTS original_question TEXT"))
        conn.execute(text("ALTER TABLE highlight_entries ADD COLUMN IF NOT EXISTS deep_synthesis TEXT"))
    # Seed default rubric + prompt versions for grading (Research B4, C4)
    from app.services.grading_service import ensure_default_rubric_version
    db = SessionLocal()
    try:
        ensure_default_rubric_version(db)
    finally:
        db.close()
    yield


app = FastAPI(title="PDF Workspace API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pdfs.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(highlights.router)
app.include_router(review.router)
app.include_router(research.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/health/detailed")
async def health_detailed():
    """
    Deep health check — hit this URL and paste the JSON to Claude when debugging.
    Returns connectivity status for every service the backend depends on.
    """
    results = {}

    # ── Postgres ──────────────────────────────────────────────
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        results["postgres"] = {"ok": True}
    except Exception as e:
        results["postgres"] = {"ok": False, "error": str(e)}

    # ── ChromaDB ──────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(
                f"http://{settings.CHROMA_HOST}:{settings.CHROMA_PORT}/api/v1/heartbeat"
            )
        results["chromadb"] = {"ok": r.status_code == 200, "status_code": r.status_code}
    except Exception as e:
        results["chromadb"] = {"ok": False, "error": str(e)}

    # ── S3 ────────────────────────────────────────────────────
    try:
        import boto3
        from app.core.config import settings as s
        boto3.client(
            "s3",
            aws_access_key_id=s.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=s.AWS_SECRET_ACCESS_KEY,
        ).head_bucket(Bucket=s.S3_BUCKET_NAME)
        results["s3"] = {"ok": True, "bucket": s.S3_BUCKET_NAME}
    except Exception as e:
        results["s3"] = {"ok": False, "error": str(e)}

    # ── API keys present (not validated, just existence check) ─
    results["api_keys"] = {
        "anthropic": bool(settings.ANTHROPIC_API_KEY),
        "openai":    bool(settings.OPENAI_API_KEY),
        "tavily":    bool(settings.TAVILY_API_KEY),
    }

    overall = all(v.get("ok", False) for k, v in results.items() if k != "api_keys")
    return {"status": "ok" if overall else "degraded", "services": results}
