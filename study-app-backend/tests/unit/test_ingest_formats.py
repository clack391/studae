"""ingest_document end-to-end (monkeypatched) for the non-PDF paths:
single image, multi-image set, office docs, and the empty-doc failure.
Uses the in-memory FakeSupabase double + stubbed embed / track_* / OCR."""
import pytest

from app import ingest

USER = "u1"
DOC = "doc1"


def _seed_doc(fake, cursor=None):
    fake.table("documents").insert({"id": DOC, "ingest_cursor": cursor}).execute()


def _chunks(fake):
    return fake.rows.get("chunks", [])


# --------------------------------------------------------------------------
# MANDATORY regression (2): a single-image upload still works end to end.
# --------------------------------------------------------------------------

def test_single_image_ingest_end_to_end(
        fake_supabase, fake_embed, no_track, monkeypatch):
    _seed_doc(fake_supabase)

    # OCR returns deterministic text for the image.
    monkeypatch.setattr(ingest, "read_image",
                        lambda b, model=ingest.MODEL_FAST, ctx=None: "scanned page text " * 10)

    files = [(b"img-bytes", "photo.png")]
    ingest.ingest_document(USER, DOC, files)

    rows = _chunks(fake_supabase)
    assert len(rows) >= 1
    assert all(r["page_number"] == 1 for r in rows)
    # single-image path has no PDF figure stage -> no figure_path set
    assert all(r["figure_path"] is None for r in rows)
    doc = fake_supabase.documents()[0]
    assert doc["status"] == "ready"
    assert doc["source_type"] == "image"
    assert doc["ingest_cursor"] == 1


def test_multi_image_set_becomes_ordered_pages(
        fake_supabase, fake_embed, no_track, monkeypatch):
    _seed_doc(fake_supabase)

    def fake_ocr(b, model=ingest.MODEL_FAST, ctx=None):
        return "page text for " + b.decode() + " " * 0 + (" word" * 30)

    monkeypatch.setattr(ingest, "read_image", fake_ocr)

    files = [(b"one", "1.png"), (b"two", "2.png"), (b"three", "3.png")]
    ingest.ingest_document(USER, DOC, files)

    rows = _chunks(fake_supabase)
    pages = sorted({r["page_number"] for r in rows})
    assert pages == [1, 2, 3]
    doc = fake_supabase.documents()[0]
    assert doc["source_type"] == "image"
    assert doc["ingest_cursor"] == 3
    # cursor bumped per page, in order
    cursor_updates = [e[2]["ingest_cursor"] for e in fake_supabase.log
                      if e[0] == "update" and e[1] == "documents"
                      and "ingest_cursor" in e[2]]
    assert cursor_updates == [1, 2, 3]


def test_docx_ingest_no_figure_stage(
        fake_supabase, fake_embed, no_track, monkeypatch):
    _seed_doc(fake_supabase)
    # Guard: _page_figures must never run for a non-PDF doc.
    monkeypatch.setattr(ingest, "_page_figures",
                        lambda *a, **k: (_ for _ in ()).throw(
                            AssertionError("figure stage ran for docx")))
    monkeypatch.setattr(ingest, "extract_pages",
                        lambda b, name, doc_id=None: ([(1, "docx body text " * 20)], "docx", set()))

    ingest.ingest_document(USER, DOC, [(b"docx-bytes", "essay.docx")])

    rows = _chunks(fake_supabase)
    assert len(rows) >= 1
    assert all(r["figure_path"] is None for r in rows)
    assert fake_supabase.documents()[0]["source_type"] == "docx"
    assert not fake_supabase.uploads      # no figures uploaded for office docs


def test_empty_document_marked_failed(
        fake_supabase, fake_embed, no_track, monkeypatch):
    _seed_doc(fake_supabase)
    monkeypatch.setattr(ingest, "extract_pages",
                        lambda b, name, doc_id=None: ([(1, "   ")], "pdf_text", set()))

    ingest.ingest_document(USER, DOC, [(b"%PDF", "empty.pdf")])

    # no chunks written; document failed with the actionable message.
    assert _chunks(fake_supabase) == []
    doc = fake_supabase.documents()[0]
    assert doc["status"] == "failed"
    assert doc["progress"] == ingest.EMPTY_DOC_MESSAGE


def test_quota_exhausted_marks_failed_keeps_cursor(
        fake_supabase, fake_embed, monkeypatch):
    from app.retry import QuotaExhausted
    _seed_doc(fake_supabase, cursor=2)
    monkeypatch.setattr(ingest, "extract_pages",
                        lambda b, name, doc_id=None: (_ for _ in ()).throw(
                            QuotaExhausted("daily cap")))
    # track_* not needed: extract_pages raises before any LLM call.

    # Should NOT re-raise (known operational state).
    ingest.ingest_document(USER, DOC, [(b"%PDF", "x.pdf")])

    doc = fake_supabase.documents()[0]
    assert doc["status"] == "failed"
    assert doc["progress"] == ingest.QUOTA_MESSAGE
    # cursor left in place so a retry resumes mid-document
    assert doc["ingest_cursor"] == 2


def test_generic_failure_reraises_and_marks_failed(
        fake_supabase, fake_embed, monkeypatch):
    _seed_doc(fake_supabase)
    monkeypatch.setattr(ingest, "extract_pages",
                        lambda b, name, doc_id=None: (_ for _ in ()).throw(
                            RuntimeError("boom")))

    with pytest.raises(RuntimeError):
        ingest.ingest_document(USER, DOC, [(b"%PDF", "x.pdf")])

    assert fake_supabase.documents()[0]["status"] == "failed"
