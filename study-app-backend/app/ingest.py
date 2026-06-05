import logging
import re

import fitz  # pymupdf
from google.genai import types

from .clients import claude, gemini, STYLE_RULES, supabase
from .retry import QuotaExhausted, transient

log = logging.getLogger(__name__)

READ_PROMPT = (
    "Transcribe this page exactly. Keep the wording. "
    "For any math, write it in LaTeX. "
    "For any diagram or figure, give a short description inside [square brackets]."
)

OUTLINE_PROMPT = (
    "Read this study material and produce an outline of it. "
    "List the topics and sub-topics in the order they appear, "
    "like a table of contents. Keep it plain and short.\n\n"
    "OMIT non-content sections that exist for bookkeeping rather than "
    "teaching. Drop: front matter, foreword, preface, dedication, "
    "copyright page, table of contents, list of figures/tables, "
    "acknowledgments, about-the-author, glossary, index, "
    "bibliography, references, works cited, errata, colophon, and any "
    "appendix that is purely a lookup table (units, abbreviations, "
    "contact information). If a section is genuinely instructional, "
    "keep it even if it sits in the front matter.\n\n"
)

MODEL_FAST = "gemini-2.5-flash-lite"
MODEL_STRONG = "gemini-2.5-flash"


@transient()
def read_image(img_bytes: bytes, model: str = MODEL_FAST) -> str:
    resp = gemini.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
            READ_PROMPT,
        ],
    )
    return resp.text


def read_image_strong(img_bytes: bytes) -> str:
    """For handwriting and heavy math — uses gemini-2.5-flash, not flash-lite."""
    return read_image(img_bytes, model=MODEL_STRONG)


PAGE_TEXT_THRESHOLD = 200  # chars per page that count as "real text"


def extract_pages(file_bytes: bytes, filename: str,
                  doc_id: str | None = None) -> tuple[list[tuple[int, str]], str]:
    """Return (pages, source_type) where pages is a list of (page_number, text).

    Each page is decided independently: if it has substantial selectable text
    (≥ PAGE_TEXT_THRESHOLD chars), we use it directly; otherwise we OCR it.
    This handles mixed PDFs (mostly text with a few image pages) correctly and
    catches image-heavy PDFs with a thin text overlay.

    When `doc_id` is provided, emits `documents.progress` updates per page so
    the frontend's ingest screen can show OCR progress on long scanned PDFs
    (otherwise this stage looks frozen for minutes).
    """
    if not filename.lower().endswith(".pdf"):
        return [(1, read_image(file_bytes))], "image"

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    total = len(doc)
    pages = []
    ocr_pages = 0
    for i, page in enumerate(doc):
        if doc_id is not None and (i == 0 or (i + 1) % 5 == 0 or i + 1 == total):
            _set_progress(doc_id, f"reading page {i + 1} of {total}")
        direct = page.get_text()
        if len(direct.strip()) >= PAGE_TEXT_THRESHOLD:
            pages.append((i + 1, direct))
        else:
            img = page.get_pixmap(dpi=150).tobytes("png")
            pages.append((i + 1, read_image(img)))
            ocr_pages += 1

    source_type = "scanned" if ocr_pages > total / 2 else "pdf_text"
    return pages, source_type


def extract_page_images(file_bytes: bytes, filename: str) -> dict[int, list[bytes]]:
    """Return {1-indexed-page: [png_bytes, ...]} of embedded images in a PDF.

    Used so the lesson screen can render the diagram alongside its
    `[bracketed]` description. The bracket descriptions stay in chunks as
    text (so Claude can still reason over them); the rendered image just
    sits next to the chunk it belongs to.

    Skips images smaller than 80 x 80 px to filter out icons / bullets.
    Returns an empty dict for non-PDFs (single-image uploads already are
    the figure).
    """
    if not filename.lower().endswith(".pdf"):
        return {}
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    out: dict[int, list[bytes]] = {}
    for i, page in enumerate(doc):
        page_no = i + 1
        for img in page.get_images(full=True):
            xref = img[0]
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.width < 80 or pix.height < 80:
                    pix = None
                    continue
                if pix.n - pix.alpha > 3:  # CMYK -> convert to RGB
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                png = pix.tobytes("png")
                out.setdefault(page_no, []).append(png)
                pix = None
            except Exception as e:
                log.warning("figure extract failed for page=%s xref=%s: %s",
                            page_no, xref, e)
    return out


_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _sanitize_text(s: str) -> str:
    """Strip NULL bytes and other unprintable controls. Postgres TEXT columns
    reject \\u0000, and PyMuPDF occasionally leaks them through when a page
    has embedded forms or scanner artifacts. Keep \\t \\n \\r (printable
    whitespace) so layout-ish formatting survives."""
    return _CONTROL_CHARS_RE.sub("", s)


def chunk_pages(pages: list[tuple[int, str]], size: int = 800, overlap: int = 100
                ) -> list[tuple[str, int]]:
    """Chunk per page so page_number is reliable. Returns (text, page_number)."""
    chunks = []
    for page_num, text in pages:
        words = _sanitize_text(text).split()
        start = 0
        while start < len(words):
            chunk = " ".join(words[start:start + size])
            if chunk.strip():
                chunks.append((chunk, page_num))
            start += size - overlap
    return chunks


def classify_content_type(text: str) -> str:
    """Lightweight heuristic: figure if a single [bracketed] note, math if LaTeX markers."""
    stripped = text.strip()
    if stripped.startswith("[") and stripped.endswith("]") and len(stripped) < 500:
        return "figure"
    math_markers = ("\\frac", "\\int", "\\sum", "\\sqrt", "$$", "\\(")
    if any(m in text for m in math_markers) or text.count("$") >= 4:
        return "math"
    return "text"


@transient()
def embed(text: str) -> list[float]:
    res = gemini.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config={"output_dimensionality": 1536},
    )
    return res.embeddings[0].values


def build_outline(text: str) -> str:
    msg = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": OUTLINE_PROMPT + text[:50000] + STYLE_RULES}],
    )
    return msg.content[0].text


def _set_progress(doc_id: str, text: str):
    """Write a short status string the frontend can display.
    Best-effort: if the DB write fails we log and keep going."""
    try:
        supabase.table("documents").update({"progress": text}) \
            .eq("id", doc_id).execute()
    except Exception as e:
        log.warning("could not write progress for doc_id=%s: %s", doc_id, e)


def ingest_document(user_id: str, doc_id: str, file_bytes: bytes, filename: str):
    try:
        log.info("ingest start doc_id=%s filename=%s size_bytes=%d",
                 doc_id, filename, len(file_bytes))
        _set_progress(doc_id, "extracting text")

        pages, source_type = extract_pages(file_bytes, filename, doc_id=doc_id)
        log.info("ingest extracted %d pages, source_type=%s for doc_id=%s",
                 len(pages), source_type, doc_id)

        # Pull embedded images from the PDF and upload them to storage now,
        # so we can attach paths to chunks below. Failure here is non-fatal:
        # chunks still get text + bracketed descriptions.
        page_figure_paths: dict[int, list[str]] = {}
        try:
            page_pngs = extract_page_images(file_bytes, filename)
            for page_no, pngs in page_pngs.items():
                for idx, png in enumerate(pngs):
                    fp = f"{user_id}/{doc_id}/figures/p{page_no}_{idx}.png"
                    supabase.storage.from_("uploads").upload(
                        fp, png, {"content-type": "image/png", "upsert": "true"})
                    page_figure_paths.setdefault(page_no, []).append(fp)
            if page_figure_paths:
                log.info("ingest uploaded %d figure images for doc_id=%s",
                         sum(len(v) for v in page_figure_paths.values()), doc_id)
        except Exception:
            log.exception("figure image upload failed for doc_id=%s", doc_id)

        chunks = chunk_pages(pages)
        log.info("ingest chunked into %d chunks for doc_id=%s", len(chunks), doc_id)
        _set_progress(doc_id, f"embedding chunk 0 of {len(chunks)}")

        # Per-page cursor so consecutive figure chunks on the same page get
        # consecutive extracted images.
        figure_cursor: dict[int, int] = {}

        rows = []
        for i, (chunk, page_num) in enumerate(chunks):
            if i and i % 10 == 0:
                log.info("ingest embedding chunk %d/%d for doc_id=%s",
                         i, len(chunks), doc_id)
                _set_progress(doc_id, f"embedding chunk {i} of {len(chunks)}")
            ctype = classify_content_type(chunk)
            figure_path = None
            if ctype == "figure":
                available = page_figure_paths.get(page_num, [])
                used = figure_cursor.get(page_num, 0)
                if used < len(available):
                    figure_path = available[used]
                    figure_cursor[page_num] = used + 1
            rows.append({
                "document_id": doc_id,
                "user_id": user_id,
                "content": chunk,
                "embedding": embed(chunk),
                "chunk_index": i,
                "page_number": page_num,
                "content_type": ctype,
                "figure_path": figure_path,
            })
        supabase.table("chunks").insert(rows).execute()
        log.info("ingest inserted %d chunk rows for doc_id=%s", len(rows), doc_id)

        full_text = _sanitize_text("\n\n".join(text for _, text in pages))
        log.info("ingest building outline for doc_id=%s (%d chars)",
                 doc_id, len(full_text))
        _set_progress(doc_id, "building outline")
        outline = _sanitize_text(build_outline(full_text))

        supabase.table("documents").update({
            "source_type": source_type,
            "outline": outline,
            "status": "ready",
            "progress": None,
        }).eq("id", doc_id).execute()
        log.info("ingest complete doc_id=%s", doc_id)

    except QuotaExhausted as e:
        log.warning("ingestion hit Gemini quota for doc_id=%s: %s", doc_id, e)
        supabase.table("documents").update({
            "status": "failed",
            "progress": "Gemini API quota reached. Try again in a few minutes or after midnight.",
        }).eq("id", doc_id).execute()
        # Don't re-raise: this is a known operational state, not a code bug.
    except Exception:
        log.exception("ingestion failed for doc_id=%s user_id=%s", doc_id, user_id)
        # Leave the last `progress` string in place so the failure point is visible
        supabase.table("documents").update({"status": "failed"}).eq("id", doc_id).execute()
        raise
