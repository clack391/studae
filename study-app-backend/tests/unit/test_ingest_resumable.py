"""ingest_document: the page-by-page resumable + idempotent core.

These drive the real ingest_document with:
  - extract_pages / extract_image_pages monkeypatched to return fixed pages
    (no PyMuPDF / no real files needed),
  - _page_figures monkeypatched to control how many figures a page emits,
  - embed / embed_many stubbed (fake_embed fixture),
  - track_* stubbed (no_track fixture),
  - the in-memory FakeSupabase double (fake_supabase fixture) recording
    every insert / delete / update / storage upload.

Assertions focus on: per-page delete-then-insert keyed on
(document_id, page_number); ingest_cursor advancing per page; resume
skipping completed pages with NO duplicate rows; and the orphan-figure
regression after the per-page refactor.
"""
import pytest

from app import ingest

USER = "u1"
DOC = "doc1"


@pytest.fixture
def patch_pdf_pages(monkeypatch):
    """Make ingest treat a .pdf upload as a fixed list of pages without
    touching PyMuPDF. Returns a setter so each test picks its pages."""
    state = {"pages": [], "ocr": set(), "source": "pdf_text"}

    def fake_extract_pages(file_bytes, filename, doc_id=None):
        return state["pages"], state["source"], state["ocr"]

    monkeypatch.setattr(ingest, "extract_pages", fake_extract_pages)

    def setter(pages, ocr=None, source="pdf_text"):
        state["pages"] = pages
        state["ocr"] = ocr or set()
        state["source"] = source

    return setter


@pytest.fixture
def no_figures(monkeypatch):
    """Default: pages have no figures (covers text-only PDFs)."""
    monkeypatch.setattr(
        ingest, "_page_figures",
        lambda *a, **k: [])


def _seed_doc(fake, cursor=None):
    fake.table("documents").insert({"id": DOC, "ingest_cursor": cursor}).execute()


def _chunk_rows(fake):
    return fake.rows.get("chunks", [])


def _files_pdf():
    # one .pdf file; bytes are irrelevant because extract_pages is patched
    return [(b"%PDF-fake", "lecture.pdf")]


# --------------------------------------------------------------------------
# MANDATORY regression (1): a normal non-resumed PDF ingest produces the
# expected chunk rows / count.
# --------------------------------------------------------------------------

def test_normal_pdf_ingest_produces_expected_chunks(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, no_figures):
    _seed_doc(fake_supabase, cursor=None)
    # page 1: 25 words -> with size=800 default that's a single chunk;
    # page 2: another single chunk.
    patch_pdf_pages([(1, "alpha " * 25), (2, "beta " * 25)])

    ingest.ingest_document(USER, DOC, _files_pdf())

    rows = _chunk_rows(fake_supabase)
    assert len(rows) == 2
    assert {r["page_number"] for r in rows} == {1, 2}
    # each row carries document_id + user_id and a real embedding
    assert all(r["document_id"] == DOC and r["user_id"] == USER for r in rows)
    assert all(len(r["embedding"]) == 1536 for r in rows)
    # chunk_index is a continuous running counter across pages
    assert sorted(r["chunk_index"] for r in rows) == [0, 1]
    # document marked ready with an outline built afterwards
    doc = fake_supabase.documents()[0]
    assert doc["status"] == "ready"
    assert doc["outline"] == "outline"
    assert doc["ingest_cursor"] == 2   # last completed page


def test_each_page_is_delete_then_insert_keyed_on_page_number(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, no_figures):
    _seed_doc(fake_supabase, cursor=None)
    patch_pdf_pages([(1, "alpha " * 5), (2, "beta " * 5)])

    ingest.ingest_document(USER, DOC, _files_pdf())

    # For each page there must be a chunks delete filtered on
    # (document_id, page_number) that precedes the chunks insert for that page.
    chunk_deletes = [e for e in fake_supabase.log
                     if e[0] == "delete" and e[1] == "chunks"]
    assert {d[2].get("page_number") for d in chunk_deletes} == {1, 2}
    for d in chunk_deletes:
        assert d[2].get("document_id") == DOC

    # ordering: delete(page=1) before insert(page=1), etc.
    seq = [(e[0], e[1], (e[2].get("page_number") if e[0] == "delete"
                         else e[2][0].get("page_number")))
           for e in fake_supabase.log if e[1] == "chunks"]
    assert seq == [
        ("delete", "chunks", 1), ("insert", "chunks", 1),
        ("delete", "chunks", 2), ("insert", "chunks", 2),
    ]


def test_ingest_cursor_advances_after_each_page(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, no_figures):
    _seed_doc(fake_supabase, cursor=None)
    patch_pdf_pages([(1, "a " * 5), (2, "b " * 5), (3, "c " * 5)])

    ingest.ingest_document(USER, DOC, _files_pdf())

    # documents.ingest_cursor was updated to 1, then 2, then 3 (in order).
    cursor_updates = [e[2]["ingest_cursor"] for e in fake_supabase.log
                      if e[0] == "update" and e[1] == "documents"
                      and "ingest_cursor" in e[2]]
    assert cursor_updates == [1, 2, 3]


# --------------------------------------------------------------------------
# Resume: re-ingest from a cursor does NOT duplicate and skips done pages.
# --------------------------------------------------------------------------

def test_resume_skips_completed_pages_no_duplicates(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, no_figures):
    # Simulate an interrupted run: page 1 already done (cursor=1) and its
    # one chunk row already present.
    _seed_doc(fake_supabase, cursor=1)
    fake_supabase.table("chunks").insert({
        "document_id": DOC, "user_id": USER, "content": "alpha " * 5,
        "embedding": [0.0] * 1536, "chunk_index": 0, "page_number": 1,
        "content_type": "text", "figure_path": None,
    }).execute()

    patch_pdf_pages([(1, "alpha " * 5), (2, "beta " * 5)])
    # Only the ops performed by the resumed ingest run matter here; the
    # seeding chunk insert above is setup, not a "touch on resume", so we
    # snapshot the log boundary and inspect only what ingest_document did.
    log_start = len(fake_supabase.log)
    ingest.ingest_document(USER, DOC, _files_pdf())
    resume_log = fake_supabase.log[log_start:]

    rows = _chunk_rows(fake_supabase)
    # exactly one row per page — page 1 was NOT re-inserted (skipped)
    pages = sorted(r["page_number"] for r in rows)
    assert pages == [1, 2]
    assert len([r for r in rows if r["page_number"] == 1]) == 1

    # page 1 must NOT have been re-deleted or re-inserted on resume
    touched_pages_delete = [d[2].get("page_number") for d in resume_log
                            if d[0] == "delete" and d[1] == "chunks"]
    touched_pages_insert = [i[2][0].get("page_number") for i in resume_log
                            if i[0] == "insert" and i[1] == "chunks"]
    assert 1 not in touched_pages_delete
    assert 1 not in touched_pages_insert
    assert touched_pages_delete == [2]
    assert touched_pages_insert == [2]


def test_full_reingest_is_idempotent_same_row_count(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, no_figures):
    # First full ingest.
    _seed_doc(fake_supabase, cursor=None)
    patch_pdf_pages([(1, "alpha " * 5), (2, "beta " * 5)])
    ingest.ingest_document(USER, DOC, _files_pdf())
    first_count = len(_chunk_rows(fake_supabase))

    # Reset cursor to None (force a from-scratch re-ingest) and run again.
    fake_supabase.table("documents").update({"ingest_cursor": None}) \
        .eq("id", DOC).execute()
    ingest.ingest_document(USER, DOC, _files_pdf())

    # Delete-then-insert per page means the row count is stable, not doubled.
    assert len(_chunk_rows(fake_supabase)) == first_count == 2


# --------------------------------------------------------------------------
# ORPHAN-ROW REGRESSION (mandatory): a page with more figures than text
# chunks still emits a figure row for every figure.
# --------------------------------------------------------------------------

def test_orphan_figures_each_get_a_row(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, monkeypatch):
    _seed_doc(fake_supabase, cursor=None)
    # One short page -> exactly ONE text chunk.
    patch_pdf_pages([(1, "only one chunk of caption text")])

    # That page yields THREE figures (more figures than text chunks).
    def fake_page_figures(*a, **k):
        return [b"png0", b"png1", b"png2"]

    monkeypatch.setattr(ingest, "_page_figures", fake_page_figures)

    ingest.ingest_document(USER, DOC, _files_pdf())

    rows = [r for r in _chunk_rows(fake_supabase) if r["page_number"] == 1]
    # 1 text chunk + 2 orphan figure-only rows = 3 rows, one figure_path each.
    assert len(rows) == 3
    figure_paths = [r["figure_path"] for r in rows]
    assert all(fp is not None for fp in figure_paths)
    assert len(set(figure_paths)) == 3       # every figure surfaced once

    # The first row is the text chunk (non-empty content); the orphan rows
    # are figure-only (empty content, content_type 'figure').
    text_rows = [r for r in rows if r["content"]]
    orphan_rows = [r for r in rows if not r["content"]]
    assert len(text_rows) == 1
    assert len(orphan_rows) == 2
    assert all(r["content_type"] == "figure" for r in orphan_rows)
    # all three figure pngs were uploaded to storage
    assert len(fake_supabase.uploads) == 3


def test_orphan_figures_rewritten_on_reingest_no_dupes(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, monkeypatch):
    _seed_doc(fake_supabase, cursor=None)
    patch_pdf_pages([(1, "one caption chunk")])
    monkeypatch.setattr(ingest, "_page_figures",
                        lambda *a, **k: [b"p0", b"p1", b"p2"])

    ingest.ingest_document(USER, DOC, _files_pdf())
    first = len([r for r in _chunk_rows(fake_supabase) if r["page_number"] == 1])

    # Re-ingest from scratch: the per-page delete wipes the orphan rows too,
    # so the page batch (text + orphans) is rewritten, not duplicated.
    fake_supabase.table("documents").update({"ingest_cursor": None}) \
        .eq("id", DOC).execute()
    ingest.ingest_document(USER, DOC, _files_pdf())
    second = len([r for r in _chunk_rows(fake_supabase) if r["page_number"] == 1])

    assert first == second == 3


def test_figure_claimed_by_text_chunk_in_order(
        fake_supabase, fake_embed, no_track, patch_pdf_pages, monkeypatch):
    _seed_doc(fake_supabase, cursor=None)
    # Two text chunks on the page (size=4, overlap=0 via long text)...
    patch_pdf_pages([(1, " ".join(f"w{i}" for i in range(10)))])
    monkeypatch.setattr(ingest, "_page_figures",
                        lambda *a, **k: [b"fig0", b"fig1"])
    # chunk size default 800 -> single chunk; force smaller windows.
    monkeypatch.setattr(ingest, "chunk_page_text",
                        lambda text, **k: ["chunk one", "chunk two"])

    ingest.ingest_document(USER, DOC, _files_pdf())

    rows = sorted((r for r in _chunk_rows(fake_supabase) if r["page_number"] == 1),
                  key=lambda r: r["chunk_index"])
    # two text chunks, each claims one figure in order; no orphans left.
    assert len(rows) == 2
    assert rows[0]["content"] == "chunk one"
    assert rows[1]["content"] == "chunk two"
    assert rows[0]["figure_path"].endswith("p1_0.png")
    assert rows[1]["figure_path"].endswith("p1_1.png")
