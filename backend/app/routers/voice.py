from fastapi import APIRouter, File, HTTPException, UploadFile
from openai import AsyncOpenAI
from app.core.config import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])


def _is_supported_type(content_type: str) -> bool:
    ct = (content_type or "").lower().split(";")[0].strip()
    return ct in {
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/mpeg",
        "audio/mp4",
        "video/webm",
    }


def _get_client() -> AsyncOpenAI:
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured.")
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not _is_supported_type(file.content_type):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio type: {file.content_type}. Expected webm/ogg/wav/mp3.",
        )

    audio_bytes = await file.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file is too short or empty.")

    client = _get_client()
    try:
        # Pass as (filename, bytes, content_type) tuple — required by OpenAI SDK
        response = await client.audio.transcriptions.create(
            model="whisper-1",
            file=("recording.webm", audio_bytes, "audio/webm"),
        )
        return {"text": response.text.strip()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc
