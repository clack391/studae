"""Chapter-extract feature (CHEAP, no LLM/OCR for detection).

Covers the four backend seams of the "extract one chapter" contract:

  1. parse_chapter_request  — pure label -> int | None parser (digits, roman,
     number words, leading keywords; junk -> None).
  2. find_chapter_page_range — locate a chapter's 1-indexed inclusive page
     span in an open PyMuPDF doc, via TOC bookmarks first then a text-layer
     heading scan, built on SYNTHETIC in-memory PDFs (no network, no API).
  3. extract_pages(page_range=...) — restrict a PDF to one chapter while
     keeping the REAL page numbers (figures/citations stay correct).
  4. ingest_document(chapter=...) — chapter=None is the unchanged whole-doc
     path; a label that parses but can't be located marks the document failed
     with the actionable message.

All PDFs here carry a real selectable text layer with >= PAGE_TEXT_THRESHOLD
chars per page, so the text-layer branch of extract_pages is taken and the
OCR/Gemini path is never reached — no test in this module touches the
network. The in-memory FakeSupabase double + fake_embed / no_track fixtures
from conftest provide the rest.
"""
import fitz  # pymupdf
import pytest

from app import ingest

USER = "u1"
DOC = "doc1"


# =========================================================================
# Synthetic in-memory PDF builders.
# =========================================================================

# Lines-per-page chosen so each page's selectable text comfortably exceeds
# ingest.PAGE_TEXT_THRESHOLD (200 chars); this forces extract_pages down the
# text-layer branch so no OCR / Gemini call ever fires.
_FILLER = "lorem ipsum dolor sit amet consectetur adipiscing elit"


def _make_pdf(n_pages: int, toc=None, headings=None) -> bytes:
    """Build an `n_pages` text PDF in memory.

    `toc`      — optional list of [level, title, page] passed to set_toc.
    `headings` — optional {1-indexed page: heading line} drawn as the FIRST
                 line of that page (used by the text-layer fallback scan).

    Every page also gets several filler lines so its text layer clears the
    PAGE_TEXT_THRESHOLD and extract_pages uses the text directly (no OCR).
    """
    headings = headings or {}
    doc = fitz.open()
    for i in range(n_pages):
        page = doc.new_page()
        page_no = i + 1
        lines: list[str] = []
        if page_no in headings:
            lines.append(headings[page_no])
        lines += [f"page {page_no} line {j}: {_FILLER}" for j in range(8)]
        page.insert_text((72, 100), lines)
    if toc:
        doc.set_toc(toc)
    data = doc.tobytes()
    doc.close()
    return data


def _open(data: bytes):
    return fitz.open(stream=data, filetype="pdf")


def _seed_doc(fake, *, title="Document", cursor=None):
    fake.table("documents").insert(
        {"id": DOC, "ingest_cursor": cursor, "title": title}).execute()


def _chunks(fake):
    return fake.rows.get("chunks", [])


def _doc_updates(fake, key):
    """All documents.update payloads (in order) that set `key`."""
    return [e[2] for e in fake.log
            if e[0] == "update" and e[1] == "documents" and key in e[2]]


# =========================================================================
# 1) parse_chapter_request — pure, no fixtures needed.
# =========================================================================

@pytest.mark.parametrize("label,expected", [
    ("5", 5),
    ("12", 12),
    ("V", 5),
    ("iv", 4),
    ("XII", 12),
    ("five", 5),
    ("twenty-one", 21),
    ("Chapter 5", 5),
    ("ch. V", 5),
    ("chapter five", 5),
    ("unit 3", 3),
    ("section II", 2),
])
def test_parse_chapter_request_accepts(label, expected):
    assert ingest.parse_chapter_request(label) == expected


@pytest.mark.parametrize("junk", ["", "   ", "hello", "0x", "preface", "index", "0", "00"])
def test_parse_chapter_request_rejects_junk(junk):
    assert ingest.parse_chapter_request(junk) is None


# =========================================================================
# 2) find_chapter_page_range — TOC bookmarks (PRIMARY).
# =========================================================================

def test_find_chapter_range_from_toc():
    # 9 pages, chapters bookmarked at pages 1, 4, 7.
    data = _make_pdf(9, toc=[[1, "Chapter 1", 1],
                             [1, "Chapter 2", 4],
                             [1, "Chapter 3", 7]])
    doc = _open(data)
    # mid chapter: end is the page before chapter 3 starts.
    assert ingest.find_chapter_page_range(doc, 2) == (4, 6)
    # last chapter: end is the last page of the document.
    assert ingest.find_chapter_page_range(doc, 3) == (7, 9)
    # first chapter spans up to chapter 2's start - 1.
    assert ingest.find_chapter_page_range(doc, 1) == (1, 3)


def test_find_chapter_range_from_toc_missing_is_none():
    data = _make_pdf(9, toc=[[1, "Chapter 1", 1],
                             [1, "Chapter 2", 4],
                             [1, "Chapter 3", 7]])
    doc = _open(data)
    # No chapter 9 bookmark, and the page text has no chapter headings either,
    # so neither the TOC path nor the text fallback can locate it.
    assert ingest.find_chapter_page_range(doc, 9) is None


# =========================================================================
# 2b) find_chapter_page_range — text-layer heading scan (FALLBACK, no TOC).
# =========================================================================

def test_find_chapter_range_from_text_layer():
    # No TOC; "Chapter N" headings sit as the first line of pages 1, 4, 7.
    data = _make_pdf(9, headings={1: "Chapter 1", 4: "Chapter 2", 7: "Chapter 3"})
    doc = _open(data)
    assert doc.get_toc() == []  # really has no bookmarks -> fallback path
    assert ingest.find_chapter_page_range(doc, 1) == (1, 3)
    assert ingest.find_chapter_page_range(doc, 2) == (4, 6)
    assert ingest.find_chapter_page_range(doc, 3) == (7, 9)


def test_find_chapter_range_text_layer_missing_is_none():
    data = _make_pdf(9, headings={1: "Chapter 1", 4: "Chapter 2", 7: "Chapter 3"})
    doc = _open(data)
    # No "Chapter 5" heading anywhere -> not found.
    assert ingest.find_chapter_page_range(doc, 5) is None


def test_find_chapter_range_skips_front_matter_folios_and_toc():
    # Regression for a real 495-page bookmark-less PDF whose "Chapter 1"
    # resolved to its acknowledgments page: the text layer there held a lone
    # "I" (start of "I am grateful ...") that parsed as roman 1, and the next
    # roman folio "ix" closed the range, yielding a single front-matter page.
    # A bare number/roman token (page folio, sentence-initial letter) and a
    # contents page that lists many chapters must NOT count as a chapter start.
    doc = fitz.open()
    bodies = {
        1: ["Title Page"] + [f"front {_FILLER}" for _ in range(6)],
        # Front matter: lone roman folio and a lone sentence-initial "I". With
        # no title following the token, neither is a heading.
        2: ["ix", "I"] + [f"grateful to many reviewers {_FILLER}" for _ in range(6)],
        # Contents page: four distinct chapter numbers on one page -> a TOC,
        # skipped so its "Chapter 1" line doesn't match before the real body.
        3: ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"]
           + [f"toc {_FILLER}" for _ in range(4)],
        # Real chapter bodies further in.
        4: ["Chapter 1"] + [f"body {_FILLER}" for _ in range(6)],
        5: [f"more body {_FILLER}" for _ in range(6)],
        6: ["Chapter 2"] + [f"body {_FILLER}" for _ in range(6)],
    }
    for i in range(6):
        page = doc.new_page()
        page.insert_text((72, 100), bodies[i + 1])
    reopened = _open(doc.tobytes())
    doc.close()
    assert reopened.get_toc() == []  # bookmark-less -> text-layer fallback
    # Chapter 1 = the real heading on page 4 (not page 2's "I", not the TOC).
    assert ingest.find_chapter_page_range(reopened, 1) == (4, 5)
    assert ingest.find_chapter_page_range(reopened, 2) == (6, 6)


def test_line_chapter_number_rejects_bare_tokens_keeps_titled_headings():
    # A bare page folio / sentence-initial roman letter is not a heading.
    assert ingest._line_chapter_number("I") is None
    assert ingest._line_chapter_number("ix") is None
    assert ingest._line_chapter_number("42") is None
    # A number/roman token FOLLOWED by a title still reads as a heading.
    assert ingest._line_chapter_number("1 Numbers") == 1
    assert ingest._line_chapter_number("IV. Functions") == 4
    # The keyword form is unaffected.
    assert ingest._line_chapter_number("Chapter 1") == 1


def test_find_chapter_range_ignores_number_buried_in_prose():
    # A page whose body mentions "chapter 2" mid-sentence must NOT be read as
    # a heading; only the short standalone heading line counts.
    data = _make_pdf(
        4,
        headings={1: "Chapter 1", 3: "Chapter 2"},
    )
    # Inject a buried mention on page 2 by rebuilding with an extra long line.
    doc = fitz.open()
    bodies = {
        1: ["Chapter 1"] + [f"intro {_FILLER}" for _ in range(6)],
        2: [f"as we will see in chapter 2 the cell {_FILLER} {_FILLER}"
            for _ in range(6)],
        3: ["Chapter 2"] + [f"cells {_FILLER}" for _ in range(6)],
        4: [f"more cells {_FILLER}" for _ in range(6)],
    }
    for i in range(4):
        page = doc.new_page()
        page.insert_text((72, 100), bodies[i + 1])
    reopened = _open(doc.tobytes())
    doc.close()
    # Chapter 2 must start at page 3 (the real heading), not page 2 (prose).
    assert ingest.find_chapter_page_range(reopened, 2) == (3, 4)


# =========================================================================
# 3) extract_pages(page_range=...) — real page numbers, limited span.
# =========================================================================

def test_extract_pages_restricts_to_range_keeps_real_numbers():
    data = _make_pdf(5)
    pages, source_type, ocr = ingest.extract_pages(
        data, "book.pdf", page_range=(2, 4))
    # Only pages 2..4, with the REAL page numbers preserved (not renumbered).
    assert [pn for pn, _ in pages] == [2, 3, 4]
    # Text-layer pages -> nothing OCR'd, so the network is never touched.
    assert ocr == set()
    assert source_type == "pdf_text"
    # Each page carries its own text (page 1 / page 5 must not leak in).
    assert all(f"page {pn}" in text for pn, text in pages)


def test_extract_pages_none_range_is_whole_document():
    data = _make_pdf(5)
    pages, _, _ = ingest.extract_pages(data, "book.pdf", page_range=None)
    assert [pn for pn, _ in pages] == [1, 2, 3, 4, 5]


def test_extract_pages_range_clamped_to_bounds():
    # A range that runs past the last page is clamped; lo below 1 clamps to 1.
    data = _make_pdf(3)
    pages, _, _ = ingest.extract_pages(data, "book.pdf", page_range=(2, 99))
    assert [pn for pn, _ in pages] == [2, 3]


# =========================================================================
# 4) ingest_document(chapter=...) — whole-doc regression + failure paths.
# =========================================================================

def test_chapter_none_processes_whole_document(
        fake_supabase, fake_embed, no_track, monkeypatch):
    """Regression: chapter=None is the unchanged whole-document path."""
    _seed_doc(fake_supabase, title="Biology")
    monkeypatch.setattr(ingest, "_page_figures", lambda *a, **k: [])

    data = _make_pdf(3)
    ingest.ingest_document(USER, DOC, [(data, "book.pdf")], chapter=None)

    pages = sorted({r["page_number"] for r in _chunks(fake_supabase)})
    assert pages == [1, 2, 3]
    doc = fake_supabase.documents()[0]
    assert doc["status"] == "ready"
    # Whole-book ingest must NOT append a chapter marker to the title, nor
    # persist a chapter label (a later Retry stays whole-book).
    assert doc["title"] == "Biology"
    assert doc.get("chapter") is None


def test_chapter_extracted_restricts_pages_and_marks_title(
        fake_supabase, fake_embed, no_track, monkeypatch):
    """A located chapter restricts ingest to its span and annotates the
    title so the library shows the scope."""
    _seed_doc(fake_supabase, title="Biology")
    monkeypatch.setattr(ingest, "_page_figures", lambda *a, **k: [])

    data = _make_pdf(9, toc=[[1, "Chapter 1", 1],
                             [1, "Chapter 2", 4],
                             [1, "Chapter 3", 7]])
    ingest.ingest_document(USER, DOC, [(data, "book.pdf")], chapter="Chapter 2")

    # Only chapter 2's real pages (4..6) were ingested.
    pages = sorted({r["page_number"] for r in _chunks(fake_supabase)})
    assert pages == [4, 5, 6]
    doc = fake_supabase.documents()[0]
    assert doc["status"] == "ready"
    assert doc["title"] == "Biology — Chapter 2"
    # The raw chapter label is PERSISTED on the row so a Retry (/reprocess)
    # can re-run ingest with the same chapter scope instead of the whole book.
    assert doc["chapter"] == "Chapter 2"


def test_unparseable_chapter_marks_failed_no_ingest(
        fake_supabase, fake_embed, no_track, monkeypatch):
    """A chapter label that can't be parsed -> document failed with the
    actionable message, and no pages are ingested."""
    _seed_doc(fake_supabase, title="Biology")
    monkeypatch.setattr(ingest, "_page_figures", lambda *a, **k: [])

    data = _make_pdf(3)
    ingest.ingest_document(USER, DOC, [(data, "book.pdf")], chapter="hello")

    assert _chunks(fake_supabase) == []
    doc = fake_supabase.documents()[0]
    assert doc["status"] == "failed"
    assert doc["progress"] == ingest.CHAPTER_UNPARSEABLE_MESSAGE.format(label="hello")
    # The raw label is surfaced verbatim in the message.
    assert '"hello"' in doc["progress"]


def test_chapter_parses_but_not_found_marks_failed(
        fake_supabase, fake_embed, no_track, monkeypatch):
    """A chapter that parses to a number but can't be located (no TOC entry,
    no text heading) -> document failed with the not-found message."""
    _seed_doc(fake_supabase, title="Biology")
    monkeypatch.setattr(ingest, "_page_figures", lambda *a, **k: [])

    # 5-page PDF with no TOC and no chapter headings -> chapter 9 unlocatable.
    data = _make_pdf(5)
    ingest.ingest_document(USER, DOC, [(data, "book.pdf")], chapter="9")

    assert _chunks(fake_supabase) == []
    doc = fake_supabase.documents()[0]
    assert doc["status"] == "failed"
    assert doc["progress"] == ingest.CHAPTER_NOT_FOUND_MESSAGE.format(n=9)
    assert "Chapter 9" in doc["progress"]
    # Title is untouched on the failure path (no chapter marker appended).
    assert doc["title"] == "Biology"


def test_chapter_ignored_for_non_pdf_upload(
        fake_supabase, fake_embed, no_track, monkeypatch):
    """Chapter applies ONLY to a single PDF; a non-PDF upload ignores it and
    ingests the whole document (no failure, no title marker)."""
    _seed_doc(fake_supabase, title="Notes")
    # docx path returns one page; guard that the figure stage never runs.
    monkeypatch.setattr(
        ingest, "extract_pages",
        lambda b, name, doc_id=None, page_range=None: (
            [(1, "docx body text " * 20)], "docx", set()))

    # A chapter value is supplied but must be ignored for a .docx upload.
    ingest.ingest_document(USER, DOC, [(b"docx-bytes", "essay.docx")],
                           chapter="5")

    doc = fake_supabase.documents()[0]
    assert doc["status"] == "ready"
    assert doc["title"] == "Notes"          # no chapter marker
    assert len(_chunks(fake_supabase)) >= 1


def test_chapter_ignored_for_multi_image_upload(
        fake_supabase, fake_embed, no_track, monkeypatch):
    """A multi-file (image) upload ignores chapter and ingests whole."""
    _seed_doc(fake_supabase, title="Scans")
    monkeypatch.setattr(
        ingest, "read_image",
        lambda b, model=ingest.MODEL_FAST, ctx=None: "page text " * 30)

    files = [(b"one", "1.png"), (b"two", "2.png")]
    ingest.ingest_document(USER, DOC, files, chapter="2")

    doc = fake_supabase.documents()[0]
    assert doc["status"] == "ready"
    assert doc["source_type"] == "image"
    assert doc["title"] == "Scans"          # no chapter marker
    pages = sorted({r["page_number"] for r in _chunks(fake_supabase)})
    assert pages == [1, 2]
