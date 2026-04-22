from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.session import get_db
from app.models.pdf import PDFDocument
from app.services import chat_service
from app.services.chat_service import extract_concepts, synthesize_entry, prepare_study_card_question

router = APIRouter(prefix="/api/chat", tags=["chat"])


class HistoryMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    pdf_id: int
    message: str
    history: list[HistoryMessage] = []
    selection_text: str | None = None
    selection_page: int | None = None
    section_title: str | None = None   # ToC section the selection falls under
    mode: str | None = None            # 'quick' → skip deep-dive layers for short queries


class Source(BaseModel):
    page_number: int | None
    chunk_index: int | None
    distance: float | None
    chunk_id: str | None = None
    text: str | None = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    web_search_triggered: bool
    web_results: list[dict] | None = None


class ConceptRequest(BaseModel):
    highlight_text: str
    answer: str


class SynthesizeRequest(BaseModel):
    highlight_text: str
    qa_pairs: list[dict]   # [{ question: str, answer: str }, ...]
    user_note: str = ""
    mode: str = "summary"


class StudyCardQuestionRequest(BaseModel):
    question: str
    answer: str
    source_text: str = ""


@router.post("/extract-concepts")
def concepts(req: ConceptRequest):
    """Extract 2–4 concept tags from a highlighted passage and its Q&A answer."""
    return {"concepts": extract_concepts(req.highlight_text, req.answer)}


@router.post("/synthesize-entry")
def synthesize(req: SynthesizeRequest):
    """
    Distil all Q&A exchanges about a passage into a 2–3 sentence synthesis of
    what the learner now understands.  Uses Haiku; called on-demand from the index.
    """
    text = synthesize_entry(req.highlight_text, req.qa_pairs, req.user_note, req.mode)
    return {"synthesis": text}


@router.post("/prepare-study-card")
def prepare_study_card(req: StudyCardQuestionRequest):
    return {
        "question": prepare_study_card_question(req.question, req.answer, req.source_text)
    }


@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    doc = db.get(PDFDocument, req.pdf_id)
    if not doc:
        raise HTTPException(status_code=404, detail="PDF not found.")

    result = await chat_service.chat(
        pdf_id=req.pdf_id,
        pdf_title=doc.title,
        message=req.message,
        history=[h.model_dump() for h in req.history],
        selection_text=req.selection_text,
        selection_page=req.selection_page,
        section_title=req.section_title,
        mode=req.mode,
    )
    return result
