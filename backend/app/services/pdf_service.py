from dataclasses import dataclass
import fitz  # PyMuPDF
import tiktoken


@dataclass
class PageText:
    page_number: int  # 1-indexed
    text: str


@dataclass
class Chunk:
    text: str
    page_number: int
    chunk_index: int


def extract_pages(pdf_bytes: bytes) -> list[PageText]:
    """Extract text from each page of a PDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages: list[PageText] = []
    for i, page in enumerate(doc):
        text = page.get_text("text")
        if text.strip():
            pages.append(PageText(page_number=i + 1, text=text))
    doc.close()
    return pages


def get_page_count(pdf_bytes: bytes) -> int:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    count = len(doc)
    doc.close()
    return count


def chunk_pages(
    pages: list[PageText],
    chunk_size: int = 512,
    overlap: int = 50,
) -> list[Chunk]:
    """
    Tokenise each page's text and emit overlapping chunks.
    Chunks carry the page number of the page they started on.
    """
    enc = tiktoken.get_encoding("cl100k_base")
    chunks: list[Chunk] = []
    chunk_index = 0

    for page in pages:
        tokens = enc.encode(page.text)
        start = 0
        while start < len(tokens):
            end = min(start + chunk_size, len(tokens))
            chunk_text = enc.decode(tokens[start:end]).strip()
            if chunk_text:
                chunks.append(
                    Chunk(
                        text=chunk_text,
                        page_number=page.page_number,
                        chunk_index=chunk_index,
                    )
                )
                chunk_index += 1
            start += chunk_size - overlap

    return chunks
