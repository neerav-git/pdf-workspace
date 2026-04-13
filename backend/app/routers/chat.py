from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.session import get_db
from app.models.pdf import PDFDocument
from app.services import chat_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


class HistoryMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    pdf_id: int
    message: str
    history: list[HistoryMessage] = []


class Source(BaseModel):
    page_number: int | None
    chunk_index: int | None
    distance: float | None


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    web_search_triggered: bool
    web_results: list[dict] | None = None


@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    doc = db.get(PDFDocument, req.pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")

    result = await chat_service.chat(
        pdf_id=req.pdf_id,
        message=req.message,
        history=[h.model_dump() for h in req.history],
    )
    return result
