"""HTTP-boundary tests for the Studae Pass 1 POLISH round.

Drives app.main.app through FastAPI's TestClient. No network, no real
background work: ingest_document is replaced with a recorder, supabase is
the in-memory FakeSupabase double from conftest, billing.check_and_count is
allowed, and the slowapi limiter is disabled so a burst of requests in one
test run doesn't trip the 10/minute write cap.

Covers the two endpoints touched by this round:
  - POST /upload                         (classification + source storage)
  - POST /documents/{id}/reprocess       (resume-from-source, cursor intact)
"""
import io

import pytest
from fastapi.testclient import TestClient

from app import main
from app import permissions
from app.auth import get_user_id

USER = "user-abc"


# =========================================================================
# Fixtures.
# =========================================================================

@pytest.fixture
def client(monkeypatch, fake_supabase):
    """A TestClient over app.main.app, wired for offline operation.

    - get_user_id is overridden to inject a fixed fake user_id (no JWT).
    - main.supabase and permissions.supabase both point at one FakeSupabase
      (permissions.require_document calls through its own module-level name).
    - billing.check_and_count is allowed (it would otherwise read plan/usage
      rows that don't exist in the fake DB).
    - ingest_document is a recorder so no real ingest runs; the background
      task still fires after the response, appending its args to `scheduled`.
    - the slowapi limiter is disabled to keep multi-request tests stable.

    Yields the TestClient with two extras attached:
      client.fake      -> the FakeSupabase double
      client.scheduled -> list of (user_id, doc_id, files) ingest calls
    """
    # Share the same fake instance ingest.supabase was patched to, so that
    # main / permissions read and write the same rows + storage objects.
    fake = fake_supabase
    monkeypatch.setattr(main, "supabase", fake)
    monkeypatch.setattr(permissions, "supabase", fake)

    monkeypatch.setattr(main, "check_and_count", lambda user_id, kind: None)

    scheduled = []

    def _fake_ingest(user_id, doc_id, files, chapter=None):
        scheduled.append((user_id, doc_id, files, chapter))

    monkeypatch.setattr(main, "ingest_document", _fake_ingest)

    monkeypatch.setattr(main.limiter, "enabled", False)

    main.app.dependency_overrides[get_user_id] = lambda: USER
    c = TestClient(main.app)
    c.fake = fake
    c.scheduled = scheduled
    try:
        yield c
    finally:
        main.app.dependency_overrides.pop(get_user_id, None)


def _file(name, content=b"data", content_type=None):
    """Build a multipart "files" tuple for TestClient: (field, (filename,
    fileobj, content_type)). content_type=None lets the contract-E
    extension path drive classification."""
    if content_type is None:
        return ("files", (name, io.BytesIO(content), ""))
    return ("files", (name, io.BytesIO(content), content_type))


def _seed_document(fake, doc_id="doc-1", user_id=USER, status="failed",
                   ingest_cursor=3):
    """Insert a documents row so require_document passes and the resume
    cursor can be checked for non-reset."""
    fake.table("documents").insert({
        "id": doc_id,
        "user_id": user_id,
        "title": "Seeded",
        "status": status,
        "ingest_cursor": ingest_cursor,
    }).execute()


def _put_source(fake, doc_id, names, user_id=USER):
    """Place source files under {user}/{doc}/source/{NNN}_{name} so reprocess
    can list + download them. Returns the keys it created, in order."""
    keys = []
    for i, n in enumerate(names):
        key = f"{user_id}/{doc_id}/source/{i:03d}_{n}"
        fake.storage.from_("uploads").upload(key, f"bytes-of-{n}".encode())
        keys.append(key)
    return keys


# =========================================================================
# /upload — classification + source storage.
# =========================================================================

def test_upload_single_pdf(client):
    r = client.post("/upload", files=[_file("notes.pdf", b"%PDF-1.4")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert "document_id" in body and body["document_id"]
    assert body["status"] == "processing"

    # One document row created and its file_path points at the first (only)
    # source key under {user}/{doc}/source/.
    docs = client.fake.documents()
    assert len(docs) == 1
    doc_id = body["document_id"]
    assert docs[0]["file_path"] == f"{USER}/{doc_id}/source/000_notes.pdf"

    # ingest_document scheduled exactly once with the right (user, doc, files).
    assert len(client.scheduled) == 1
    u, d, files, chapter = client.scheduled[0]
    assert u == USER and d == doc_id
    assert [n for _, n in files] == ["notes.pdf"]
    assert chapter is None          # whole-book upload (no chapter field)


def test_upload_single_image(client):
    r = client.post("/upload", files=[_file("scan.png", b"\x89PNG")])
    assert r.status_code == 200, r.text
    assert len(client.fake.documents()) == 1          # one doc for one image
    assert len(client.scheduled) == 1


def test_upload_multiple_images_one_doc_in_order(client):
    r = client.post("/upload", files=[
        _file("p1.jpg", b"a"),
        _file("p2.jpg", b"b"),
        _file("p3.jpg", b"c"),
    ])
    assert r.status_code == 200, r.text
    doc_id = r.json()["document_id"]

    # ONE document for the whole image set.
    assert len(client.fake.documents()) == 1

    # ingest scheduled once, with all three files in upload order.
    assert len(client.scheduled) == 1
    _, d, files, _chapter = client.scheduled[0]
    assert d == doc_id
    assert [n for _, n in files] == ["p1.jpg", "p2.jpg", "p3.jpg"]

    # Each source file stored under {NNN}_{name}, zero-padded in order.
    keys = sorted(k for k in client.fake.objects
                  if k.startswith(f"{USER}/{doc_id}/source/"))
    assert keys == [
        f"{USER}/{doc_id}/source/000_p1.jpg",
        f"{USER}/{doc_id}/source/001_p2.jpg",
        f"{USER}/{doc_id}/source/002_p3.jpg",
    ]
    # file_path is the FIRST source key.
    assert client.fake.documents()[0]["file_path"] == keys[0]


def test_upload_single_docx(client):
    r = client.post("/upload", files=[_file("essay.docx", b"PK\x03\x04")])
    assert r.status_code == 200, r.text
    assert len(client.fake.documents()) == 1
    assert len(client.scheduled) == 1


def test_upload_single_txt(client):
    r = client.post("/upload", files=[_file("notes.txt", b"hello")])
    assert r.status_code == 200, r.text
    assert len(client.scheduled) == 1


def test_upload_mixed_types_rejected(client):
    r = client.post("/upload", files=[
        _file("a.pdf", b"%PDF"),
        _file("b.png", b"\x89PNG"),
    ])
    assert r.status_code == 400, r.text
    # Nothing scheduled or stored on a rejected request.
    assert client.scheduled == []
    assert client.fake.documents() == []


def test_upload_unknown_type_rejected(client):
    r = client.post("/upload", files=[_file("archive.zip", b"PK")])
    assert r.status_code == 400, r.text
    assert client.scheduled == []


def test_upload_no_extension_image_content_type_fallback(client):
    """Contract E: no usable extension, but content_type says it's an image
    -> classified as an image and accepted."""
    r = client.post("/upload", files=[
        ("files", ("photo", io.BytesIO(b"\x89PNG"), "image/jpeg")),
    ])
    assert r.status_code == 200, r.text
    assert len(client.fake.documents()) == 1
    assert len(client.scheduled) == 1
    # A usable extension was synthesized so ingest can dispatch on it.
    _, _, files, _chapter = client.scheduled[0]
    name = files[0][1]
    assert name.lower().endswith((".jpg", ".jpeg"))


def test_upload_no_extension_unknown_content_type_rejected(client):
    """Contract E: only 400 when BOTH extension and content_type are
    unrecognized."""
    r = client.post("/upload", files=[
        ("files", ("mystery", io.BytesIO(b"x"), "application/octet-stream")),
    ])
    assert r.status_code == 400, r.text
    assert client.scheduled == []


def test_upload_oversize_image_413(client):
    big = b"x" * (main.MAX_UPLOAD_BYTES_IMAGE + 1)
    r = client.post("/upload", files=[_file("huge.png", big)])
    assert r.status_code == 413, r.text
    assert client.scheduled == []


def test_upload_no_files_400(client):
    # FastAPI requires the multipart field; an empty post is a 422 (validation)
    # before our handler runs. Send an explicitly empty marker is not possible
    # without a file, so assert the missing-field path is a client error.
    r = client.post("/upload")
    assert r.status_code in (400, 422), r.text
    assert client.scheduled == []


# =========================================================================
# /documents/{id}/reprocess — resume from stored source, cursor intact.
# =========================================================================

def test_reprocess_owned_failed_doc_with_sources(client):
    fake = client.fake
    _seed_document(fake, doc_id="doc-1", status="failed", ingest_cursor=3)
    _put_source(fake, "doc-1", ["a.png", "b.png"])

    r = client.post("/documents/doc-1/reprocess")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"document_id": "doc-1", "status": "processing"}

    # Status flipped to processing; cursor deliberately NOT reset.
    doc = next(d for d in fake.documents() if d["id"] == "doc-1")
    assert doc["status"] == "processing"
    assert doc["ingest_cursor"] == 3            # resume point preserved

    # No update ever touched ingest_cursor.
    cursor_updates = [
        e for e in fake.ops("update", "documents")
        if "ingest_cursor" in e[2]
    ]
    assert cursor_updates == []

    # ingest_document re-scheduled with the downloaded source files, order
    # preserved and the NNN_ prefix stripped back to the real filenames.
    assert len(client.scheduled) == 1
    u, d, files, chapter = client.scheduled[0]
    assert u == USER and d == "doc-1"
    assert [n for _, n in files] == ["a.png", "b.png"]
    assert files[0][0] == b"bytes-of-a.png"     # actual downloaded bytes
    assert chapter is None          # whole-book doc -> no chapter scope


def test_reprocess_rethreads_chapter_scope(client):
    """A chapter-scoped upload persists its raw chapter label on the row.
    Retry (POST /reprocess) must re-run ingest with the SAME chapter so it
    stays restricted to that span instead of falling back to the whole book
    (which, combined with the resume cursor, would ingest the wrong pages)."""
    fake = client.fake
    _seed_document(fake, doc_id="doc-ch", status="failed", ingest_cursor=6)
    # Persisted chapter label, as ingest_document writes it on a chapter scope.
    fake.table("documents").update({"chapter": "Chapter 2"}) \
        .eq("id", "doc-ch").execute()
    _put_source(fake, "doc-ch", ["book.pdf"])

    r = client.post("/documents/doc-ch/reprocess")
    assert r.status_code == 200, r.text

    # Cursor still untouched (resume within the chapter span).
    doc = next(d for d in fake.documents() if d["id"] == "doc-ch")
    assert doc["ingest_cursor"] == 6

    # ingest re-scheduled WITH the persisted chapter label.
    assert len(client.scheduled) == 1
    u, d, files, chapter = client.scheduled[0]
    assert u == USER and d == "doc-ch"
    assert [n for _, n in files] == ["book.pdf"]
    assert chapter == "Chapter 2"


def test_reprocess_no_source_files_400(client):
    fake = client.fake
    _seed_document(fake, doc_id="doc-2", status="failed", ingest_cursor=1)
    # No source files placed.

    r = client.post("/documents/doc-2/reprocess")
    assert r.status_code == 400, r.text
    assert "re-upload" in r.json()["detail"].lower()
    assert client.scheduled == []
    # Status untouched on the 400 path.
    doc = next(d for d in fake.documents() if d["id"] == "doc-2")
    assert doc["status"] == "failed"


def test_reprocess_not_owned_404(client):
    fake = client.fake
    # Document belongs to someone else.
    _seed_document(fake, doc_id="doc-3", user_id="other-user", status="failed")
    _put_source(fake, "doc-3", ["x.png"], user_id="other-user")

    r = client.post("/documents/doc-3/reprocess")
    assert r.status_code == 404, r.text
    assert client.scheduled == []


def test_reprocess_missing_doc_404(client):
    r = client.post("/documents/does-not-exist/reprocess")
    assert r.status_code == 404, r.text
    assert client.scheduled == []
