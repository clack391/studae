import json
import logging
import re

import fitz  # pymupdf
from google.genai import types

from .clients import claude, gemini, STYLE_RULES, supabase, track_claude, track_gemini, track_gemini_embed
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


DIAGRAM_DETECT_PROMPT = (
    "Look at this study-page image. Find every distinct diagram, "
    "illustration, photograph, chart, anatomical figure, structural "
    "formula, schematic, map, or other visual figure that is NOT just "
    "text.\n\n"
    "IGNORE: blocks of text, headings, page numbers, footers, headers, "
    "decorative borders, tables of pure text data, the page background.\n\n"
    "For each visual figure, return its bounding box as normalized "
    "coordinates where x and y are the TOP-LEFT corner and w / h are "
    "the width / height, all in fractions of the page (0.0 to 1.0).\n\n"
    "Return ONLY a JSON object: {\"figures\":[{\"x\":0.10,\"y\":0.42,"
    "\"w\":0.35,\"h\":0.30}, ...]}. Empty array if the page is text-only."
)


@transient()
def _detect_page_diagrams(page) -> list[bytes]:
    """Vision-detect real diagrams on a scanned PDF page and return
    cropped PNG bytes for each. Used in place of `page.get_images()` on
    OCR'd pages, where PyMuPDF's only "image" is the whole-page scan
    (which would leak the question's source text if used as a figure).

    Pipeline:
      1. Render the full page at 150 dpi.
      2. Ask Gemini Vision for the bounding boxes of every non-text
         visual region on the page.
      3. For each bounding box, ask PyMuPDF to render JUST that clip of
         the original page (still at 150 dpi) → that becomes the figure.

    Returns an empty list on any failure so the caller can fall back to
    treating the page as text-only.
    """
    page_png = page.get_pixmap(dpi=150).tobytes("png")
    try:
        resp = track_gemini(
            "detect_page_diagrams",
            model=MODEL_FAST,
            contents=[
                types.Part.from_bytes(data=page_png, mime_type="image/png"),
                DIAGRAM_DETECT_PROMPT,
            ],
        )
        raw = (resp.text or "").strip()
    except Exception as e:
        log.info("diagram detect vision call failed: %s: %s",
                 type(e).__name__, e)
        return []

    # Strip markdown fences Gemini sometimes wraps JSON in.
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    if not raw:
        return []
    try:
        # Tolerate both `[...]` and `{"figures":[...]}` shapes.
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        bboxes = parsed.get("figures") or parsed.get("boxes") or []
    elif isinstance(parsed, list):
        bboxes = parsed
    else:
        bboxes = []
    if not isinstance(bboxes, list):
        return []

    out: list[bytes] = []
    rect = page.rect
    for box in bboxes:
        if not isinstance(box, dict):
            continue
        try:
            x = float(box.get("x", 0))
            y = float(box.get("y", 0))
            w = float(box.get("w", 0))
            h = float(box.get("h", 0))
        except (TypeError, ValueError):
            continue
        # Sanity-check the box: in-bounds and not too tiny.
        if not (0 <= x < 1 and 0 <= y < 1 and 0 < w <= 1 and 0 < h <= 1):
            continue
        if w * h < 0.02:  # less than 2% of page area — likely an icon
            continue
        clip = fitz.Rect(
            rect.x0 + x * rect.width,
            rect.y0 + y * rect.height,
            rect.x0 + (x + w) * rect.width,
            rect.y0 + (y + h) * rect.height,
        )
        try:
            pix = page.get_pixmap(dpi=150, clip=clip)
            if pix.width < 80 or pix.height < 80:
                continue
            out.append(pix.tobytes("png"))
        except Exception:
            continue
    return out


@transient()
def read_image(img_bytes: bytes, model: str = MODEL_FAST) -> str:
    resp = track_gemini(
        "ocr_page",
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
                  doc_id: str | None = None
                  ) -> tuple[list[tuple[int, str]], str, set[int]]:
    """Return (pages, source_type, ocr_page_numbers).

    `pages` is a list of (page_number, text). Each page is decided
    independently: if it has substantial selectable text (≥
    PAGE_TEXT_THRESHOLD chars), we use it directly; otherwise we OCR it.
    This handles mixed PDFs (mostly text with a few image pages)
    correctly and catches image-heavy PDFs with a thin text overlay.

    `ocr_page_numbers` is the set of 1-indexed page numbers that had to
    be OCR'd. The caller uses this to skip figure extraction on those
    pages — an OCR'd page has no real text layer, so the only thing
    PyMuPDF can extract from it is the page-scan image itself, which
    would leak the answer if shown as a "figure" during a test.

    When `doc_id` is provided, emits `documents.progress` updates per
    page so the frontend's ingest screen can show OCR progress on long
    scanned PDFs (otherwise this stage looks frozen for minutes).
    """
    if not filename.lower().endswith(".pdf"):
        # Single-image upload: no concept of "page scan vs embedded
        # diagram" applies — return an empty exclude set.
        return [(1, read_image(file_bytes))], "image", set()

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    total = len(doc)
    pages = []
    ocr_page_numbers: set[int] = set()
    for i, page in enumerate(doc):
        if doc_id is not None and (i == 0 or (i + 1) % 5 == 0 or i + 1 == total):
            _set_progress(doc_id, f"reading page {i + 1} of {total}")
        direct = page.get_text()
        if len(direct.strip()) >= PAGE_TEXT_THRESHOLD:
            pages.append((i + 1, direct))
        else:
            img = page.get_pixmap(dpi=150).tobytes("png")
            pages.append((i + 1, read_image(img)))
            ocr_page_numbers.add(i + 1)

    source_type = "scanned" if len(ocr_page_numbers) > total / 2 else "pdf_text"
    return pages, source_type, ocr_page_numbers


def extract_page_images(file_bytes: bytes, filename: str,
                        skip_pages: set[int] | None = None
                        ) -> dict[int, list[bytes]]:
    """Return {1-indexed-page: [png_bytes, ...]} of embedded images in a PDF.

    Used so the lesson screen can render the diagram alongside its
    `[bracketed]` description. The bracket descriptions stay in chunks as
    text (so Claude can still reason over them); the rendered image just
    sits next to the chunk it belongs to.

    `skip_pages` is the set of page numbers (1-indexed) that were OCR'd
    (no real text layer). On those pages PyMuPDF's `page.get_images()`
    would only find the whole-page scan, which leaks question text. We
    handle those pages differently: send the page to Gemini Vision and
    ask for the bounding boxes of every distinct diagram / illustration
    / photograph, then crop just those regions from the original page
    rendering. That way scanned textbooks with real diagrams (anatomy,
    chemistry, etc) still get the diagrams as figures, but the
    surrounding text never makes it into a `figure_path`.

    For text-extracted pages (NOT in skip_pages), uses the normal
    PyMuPDF embedded-image path.

    Skips images smaller than 80 x 80 px to filter out icons / bullets.
    Returns an empty dict for non-PDFs (single-image uploads already are
    the figure).
    """
    if not filename.lower().endswith(".pdf"):
        return {}
    skip = skip_pages or set()
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    out: dict[int, list[bytes]] = {}
    for i, page in enumerate(doc):
        page_no = i + 1
        if page_no in skip:
            # Scanned page — use vision-detected diagram regions.
            try:
                cropped = _detect_page_diagrams(page)
            except Exception as e:
                log.warning(
                    "diagram detect failed for page=%s: %s: %s",
                    page_no, type(e).__name__, e)
                cropped = []
            if cropped:
                out.setdefault(page_no, []).extend(cropped)
            continue
        # Text-extracted page — pull embedded image objects.
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
    res = track_gemini_embed(
        "embed_chunk",
        model="gemini-embedding-001",
        contents=text,
        config={"output_dimensionality": 1536},
    )
    return res.embeddings[0].values


def build_outline(text: str) -> str:
    # Haiku 4.5 handles structured outline extraction well at ~1/3 the
    # cost of Sonnet 4.6. Watch the next few ingests for outline quality
    # (topic granularity, off-topic bleed). Roll back the model string if
    # outlines start missing topics or grouping unrelated sections.
    msg = track_claude(
        "build_outline",
        model="claude-haiku-4-5",
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

        pages, source_type, ocr_page_numbers = extract_pages(
            file_bytes, filename, doc_id=doc_id)
        log.info(
            "ingest extracted %d pages, source_type=%s, ocr_pages=%d for doc_id=%s",
            len(pages), source_type, len(ocr_page_numbers), doc_id)

        # Pull embedded images from the PDF and upload them to storage now,
        # so we can attach paths to chunks below. Failure here is non-fatal:
        # chunks still get text + bracketed descriptions.
        #
        # Two storage subdirs:
        #   - <user>/<doc>/figures/...  → embedded images from text PDF
        #     pages (PyMuPDF's `page.get_images()` path). Safe.
        #   - <user>/<doc>/diagrams/... → vision-cropped diagrams from
        #     OCR'd PDF pages (`_detect_page_diagrams` path). Safe — only
        #     the diagram region was cropped, not the surrounding text.
        # The runtime "is this safe to show on a test?" check distinguishes
        # the two by path prefix: cropped diagrams pass the check on any
        # doc; figures/ uploads pass only on non-scanned docs (because on
        # OLDER scanned uploads — before vision detection landed —
        # everything under figures/ was actually a whole-page scan).
        page_figure_paths: dict[int, list[str]] = {}
        try:
            page_pngs = extract_page_images(
                file_bytes, filename, skip_pages=ocr_page_numbers)
            for page_no, pngs in page_pngs.items():
                is_ocr_page = page_no in ocr_page_numbers
                subdir = "diagrams" if is_ocr_page else "figures"
                for idx, png in enumerate(pngs):
                    fp = f"{user_id}/{doc_id}/{subdir}/p{page_no}_{idx}.png"
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

        # Per-page cursor so consecutive chunks on the same page claim the
        # next extracted image in order. Originally this only ran for
        # chunks classified as "figure" (i.e., `[bracketed description]`
        # chunks produced by OCR on scanned pages). That meant text-layer
        # PDFs never got any figures attached even though PyMuPDF found
        # them. Now every chunk tries to claim a figure for its page; the
        # cursor still prevents the same image being assigned twice.
        figure_cursor: dict[int, int] = {}

        rows = []
        for i, (chunk, page_num) in enumerate(chunks):
            if i and i % 10 == 0:
                log.info("ingest embedding chunk %d/%d for doc_id=%s",
                         i, len(chunks), doc_id)
                _set_progress(doc_id, f"embedding chunk {i} of {len(chunks)}")
            ctype = classify_content_type(chunk)
            figure_path = None
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
        # Backfill orphan figures. A page can have more extracted images
        # than text chunks (e.g. an Anthracnose composite figure with 4
        # subfigure photos but only one caption-paragraph chunk). The
        # chunk loop above assigns one figure per chunk via figure_cursor;
        # any extras are uploaded to storage but have no chunk row, so the
        # page-level expansion in chat._sources_from_search never finds
        # them. Insert a dedicated "figure-only" row for each leftover so
        # all subfigures surface on the lesson screen. Empty content +
        # placeholder embedding keeps these rows out of vector search
        # while still being reachable by the page_number IN (...) query.
        orphan_rows = []
        placeholder_emb = None
        for page_num, paths in page_figure_paths.items():
            used = figure_cursor.get(page_num, 0)
            for fp in paths[used:]:
                if placeholder_emb is None:
                    placeholder_emb = embed("figure")
                orphan_rows.append({
                    "document_id": doc_id,
                    "user_id": user_id,
                    "content": "",
                    "embedding": placeholder_emb,
                    "chunk_index": len(rows) + len(orphan_rows),
                    "page_number": page_num,
                    "content_type": "figure",
                    "figure_path": fp,
                })
        if orphan_rows:
            rows.extend(orphan_rows)
            log.info("ingest backfilled %d orphan figure rows for doc_id=%s",
                     len(orphan_rows), doc_id)

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
