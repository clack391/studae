import logging
import os
import re
import urllib.parse
import uuid
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

log = logging.getLogger(__name__)

from . import assess
from . import billing
from . import flashcards as fc
from . import focus
from . import revise
from .auth import get_user_id
from .billing import LimitError, check_and_count
from . import chat
from .chat import (
    answer_photo_question,
    answer_question,
    lesson_advance,
    lesson_reset,
    outline_points,
    teach_next,
)
from .clients import supabase
from .ingest import ingest_document, read_image_strong
from .permissions import require_document, require_session

MAX_UPLOAD_BYTES_PDF = 100 * 1024 * 1024   # 100 MB for a single PDF on /upload
MAX_UPLOAD_BYTES_IMAGE = 10 * 1024 * 1024  # 10 MB per image on /upload
MAX_UPLOAD_BYTES_PHOTO = 10 * 1024 * 1024  # 10 MB for /ask-photo, /answer/save-photo

# Extensions /upload accepts, grouped so we can reject mixed-type sets.
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif"}
_DOC_EXTS = {".docx", ".pptx", ".txt", ".md"}  # single-file document formats
_PDF_EXT = ".pdf"

app = FastAPI()

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[os.environ.get("RATE_LIMIT_DEFAULT", "100/minute")],
)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": f"rate limit exceeded: {exc.detail}"},
    )


_allowed_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_file_size(file_bytes: bytes, max_bytes: int):
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max {max_bytes // (1024 * 1024)} MB.",
        )


def _sniff_image_type(b: bytes) -> str | None:
    """Identify an image's real MIME type from its magic bytes.

    The frontend FormData hardcodes image/jpeg on every picked photo, but
    Android screenshots, gallery PNGs, and some camera apps return PNGs.
    Anthropic's vision endpoint validates the declared media_type against
    the actual content and returns 400 on mismatch — so we sniff and
    trust the bytes instead of the multipart header.

    Returns None for anything we don't recognise; the caller falls back
    to the declared content_type."""
    if len(b) < 12:
        return None
    if b.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if b.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if b.startswith(b"GIF87a") or b.startswith(b"GIF89a"):
        return "image/gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return None


def _upload_ext(filename: str) -> str:
    """Lowercased extension (with dot) of an uploaded file, or ''."""
    decoded = urllib.parse.unquote(filename or "")
    _, ext = os.path.splitext(decoded)
    return ext.lower()


def _upload_kind(ext: str) -> str:
    """Classify an upload extension into 'pdf' | 'image' | 'doc', or '' if
    unknown. Used to enforce the homogeneous-set rule on /upload."""
    if ext == _PDF_EXT:
        return "pdf"
    if ext in _IMAGE_EXTS:
        return "image"
    if ext in _DOC_EXTS:
        return "doc"
    return ""


# The office mimes the desktop / mobile pickers attach to .docx / .pptx.
_OFFICE_MIMES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/msword": "docx",
    "application/vnd.ms-powerpoint": "pptx",
}


def _kind_from_content_type(content_type: str | None) -> str:
    """Fallback classification from an UploadFile.content_type when the
    filename has no usable extension. Returns the same kind vocabulary as
    _upload_kind ('pdf' | 'image' | 'doc'), or '' when unrecognized.

    docx/pptx both ingest through the single-file 'doc' pipeline, so the
    office mimes map to 'doc'. text/* is a 'doc' too (.txt / .md path)."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if not ct:
        return ""
    if ct == "application/pdf":
        return "pdf"
    if ct.startswith("image/"):
        return "image"
    if ct in _OFFICE_MIMES or ct.startswith("text/"):
        return "doc"
    return ""


# Fallback extension when a file arrived with no/unknown extension but a known
# content_type. ingest_document dispatches on the filename's extension, so a
# synthesized name needs one that routes to the right pipeline. docx/pptx are
# distinguished by their office mime; everything else uses a kind default.
_KIND_DEFAULT_EXT = {"pdf": ".pdf", "image": ".jpg", "doc": ".txt"}


def _fallback_ext(kind: str, content_type: str | None) -> str:
    """An extension to attach to a filename that lacks a usable one, given
    the resolved kind and the declared content_type."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in _OFFICE_MIMES:
        return "." + _OFFICE_MIMES[ct]
    if ct.startswith("image/"):
        sub = ct.split("/", 1)[1]
        if sub in ("jpeg", "jpg"):
            return ".jpg"
        if sub in ("png", "webp", "gif", "bmp", "heic", "heif"):
            return "." + ("heic" if sub == "heif" else sub)
    return _KIND_DEFAULT_EXT.get(kind, ".pdf")


_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(filename: str) -> str:
    """Collapse a user-supplied filename into a storage-safe basename.

    Drops any directory parts, replaces runs of unsafe characters with a
    single underscore, and trims leading dots/dashes so the key can't start
    oddly. Falls back to 'file' when nothing usable remains."""
    base = os.path.basename(urllib.parse.unquote(filename or ""))
    base = _SAFE_NAME_RE.sub("_", base).strip("._-")
    return base or "file"


def _source_prefix(user_id: str, document_id: str) -> str:
    """Storage prefix that holds a document's original uploaded files."""
    return f"{user_id}/{document_id}/source/"


def _list_source_keys(user_id: str, document_id: str) -> list[str]:
    """Full storage keys of every original source file for a document, in
    name order (== upload order, since keys are zero-padded with the upload
    index). Returns [] when the prefix is empty or the listing fails — the
    caller decides whether that is a hard error (reprocess) or best-effort
    cleanup (delete)."""
    prefix = _source_prefix(user_id, document_id)
    try:
        entries = supabase.storage.from_("uploads").list(prefix.rstrip("/")) or []
    except Exception as e:
        log.warning("source list failed for doc_id=%s: %s", document_id, e)
        return []
    names = sorted(
        e["name"] for e in entries
        if isinstance(e, dict) and e.get("name") and e.get("id") is not None
    )
    return [prefix + n for n in names]


@app.get("/healthz")
def healthz():
    return {"ok": True}


class NewSession(BaseModel):
    document_id: str
    mode: str = "ask"
    level: str = "novice"
    title: str = "Study session"
    focus_area_id: Optional[str] = None     # only meaningful for lesson sessions


class AskBody(BaseModel):
    session_id: str
    document_id: str
    question: str
    level: str = "novice"


class SessionBody(BaseModel):
    session_id: str


class AdvanceBody(BaseModel):
    session_id: str
    # When true, marks the current topic as "skipped" rather than "covered"
    # in the rolling summary and drops any cached peek message for it.
    skip: bool = False


class NewAssessment(BaseModel):
    document_id: str
    kind: str = "test"                          # "test" or "exam"
    format: str = "mixed"                       # "objective", "theory", or "mixed"
    level: str = "novice"
    num_questions: Optional[int] = None         # default depends on (kind, format)
    time_limit_seconds: Optional[int] = None    # default computed from actual questions
    topic: Optional[str] = None                 # single-topic scope via RAG (test-only)
    topics: Optional[list[str]] = None          # multi-topic scope via RAG (test-only); overrides `topic`
    focus_area_id: Optional[str] = None         # multi-topic scope via a saved focus area; overrides `topics` and `topic`


class AssessmentId(BaseModel):
    assessment_id: str


class SaveAnswer(BaseModel):
    assessment_id: str
    question_id: str
    student_answer: str


class DisputeBody(BaseModel):
    reason: str


class GenerateCardsBody(BaseModel):
    document_id: str
    num: int = 20
    level: str = "novice"
    focus_area_id: Optional[str] = None     # multi-topic scope


class ReviewBody(BaseModel):
    rating: int  # 0–5


class SummarizeBody(BaseModel):
    topic: Optional[str] = None
    level: str = "novice"


class NewFocusArea(BaseModel):
    document_id: str
    name: str
    topics: list[str]
    exam_date: Optional[str] = None      # ISO date string, e.g. "2026-06-30"


class UpdateFocusArea(BaseModel):
    name: Optional[str] = None
    topics: Optional[list[str]] = None
    exam_date: Optional[str] = None


class PracticeBody(BaseModel):
    document_id: str
    level: str = "novice"
    num_questions: Optional[int] = None
    time_limit_seconds: Optional[int] = None


class Settings(BaseModel):
    preferred_level: Optional[str] = None
    tts_enabled: Optional[bool] = None
    name: Optional[str] = None       # "username" display name -> users.name
    phone: Optional[str] = None


@app.post("/upload")
@limiter.limit("10/minute")
async def upload(
    request: Request,
    files: list[UploadFile],
    background: BackgroundTasks,
    chapter: Optional[str] = Form(None),
    user_id: str = Depends(get_user_id),
):
    """Accept 1..N files under the multipart field name "files" (even for a
    single file). Rules:
      - one PDF                          -> the PDF pipeline
      - one or more images               -> ONE document, images as pages
      - one .docx / .pptx / .txt / .md   -> that document
    Mixed-type sets and unknown types are rejected with 400. Size limits:
    PDF 100 MB; each image 10 MB. Returns {"document_id": ...}.

    Optional multipart field "chapter" (e.g. "5", "V", "Chapter 5", "five")
    restricts ingestion to ONE chapter of a single PDF, to cut API cost.
    Empty/absent means the whole document (unchanged behavior). The field is
    ignored for non-PDF or multi-file uploads (whole document is ingested).
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    # Classify the set and reject anything we can't ingest as one document.
    # Extension first; when the extension is missing or unknown, fall back to
    # the browser-declared content_type. Only a file that BOTH lack a usable
    # extension AND carry an unrecognized content_type is a hard 400.
    decoded_names = [urllib.parse.unquote(f.filename or "") for f in files]
    exts = [_upload_ext(f.filename or "") for f in files]
    file_kinds: list[str] = []
    for f, e in zip(files, exts):
        k = _upload_kind(e)
        if not k:
            k = _kind_from_content_type(f.content_type)
        file_kinds.append(k)
    kinds = set(file_kinds)
    if "" in kinds:
        i = file_kinds.index("")
        bad = exts[i] or (files[i].content_type or "unknown")
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{bad}'. Upload a PDF, "
                   "image, .docx, .pptx, .txt, or .md file.",
        )
    if len(kinds) > 1:
        raise HTTPException(
            status_code=400,
            detail="Don't mix file types in one upload. Upload a single PDF, "
                   "one document, or a set of images.",
        )
    kind = kinds.pop()
    if kind in ("pdf", "doc") and len(files) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"Upload one {'PDF' if kind == 'pdf' else 'document'} at a time. "
                   "Only image sets may carry multiple files.",
        )

    try:
        check_and_count(user_id, "document")
    except LimitError as e:
        raise HTTPException(status_code=402, detail=e.message)

    # Read every file and enforce per-file size limits (PDF 100 MB, each
    # image 10 MB; docs reuse the 100 MB PDF cap). Each filename is
    # normalised to carry a usable extension (synthesized from kind +
    # content_type when the upload had none), since ingest_document and the
    # source-storage keys both depend on the extension.
    payloads: list[tuple[bytes, str]] = []
    for f, decoded in zip(files, decoded_names):
        data = await f.read()
        if kind == "image":
            _check_file_size(data, MAX_UPLOAD_BYTES_IMAGE)
        else:
            _check_file_size(data, MAX_UPLOAD_BYTES_PDF)
        name = decoded
        if not os.path.splitext(name)[1]:
            name = (name or "file") + _fallback_ext(kind, f.content_type)
        payloads.append((data, name))

    # The picker may hand us filenames in a few ugly shapes:
    #   - URL-encoded ("CARE%20FOR%20PLANT.pdf")
    #   - underscore-as-space on Android ("Thriving_Indoor.pdf")
    #   - with the file extension, which the UI doesn't need
    # Title comes from the first file (its already-normalised name).
    stem, _ext_unused = os.path.splitext(payloads[0][1])
    title = stem.replace("_", " ").strip() or "Document"

    # Store EACH source file under a per-document prefix so the doc can be
    # reprocessed later from its originals (see /documents/{id}/reprocess).
    # Layout: {user_id}/{doc_id}/source/{NNN}_{safe_filename}. The NNN order
    # index keeps name-sorted listing equal to upload order. The document
    # row's file_path points at the FIRST source key so /files/signed-url and
    # detail views still resolve. doc_id is allocated first so it can prefix
    # the storage keys.
    doc = supabase.table("documents").insert({
        "user_id": user_id,
        "title": title,
        "status": "processing",
    }).execute()
    doc_id = doc.data[0]["id"]

    first_path = None
    for i, (data, name) in enumerate(payloads):
        key = f"{user_id}/{doc_id}/source/{i:03d}_{_safe_filename(name)}"
        supabase.storage.from_("uploads").upload(key, data)
        if first_path is None:
            first_path = key

    supabase.table("documents").update({"file_path": first_path}) \
        .eq("id", doc_id).execute()

    # Hand the full list of (bytes, filename) to ingest_document. It
    # dispatches by the first file's extension; a multi-image set becomes
    # one document whose pages are the images in order. The optional chapter
    # label is threaded through; ingest_document applies it only to a single
    # PDF and ignores it otherwise. Empty -> None (whole document, unchanged).
    chapter_label = (chapter or "").strip() or None
    if chapter_label is not None:
        background.add_task(ingest_document, user_id, doc_id, payloads,
                            chapter=chapter_label)
    else:
        background.add_task(ingest_document, user_id, doc_id, payloads)

    return {"document_id": doc_id, "status": "processing"}


@app.post("/session")
def create_session(body: NewSession, user_id: str = Depends(get_user_id)):
    require_document(body.document_id, user_id)
    s = supabase.table("chat_sessions").insert({
        "user_id": user_id,
        "document_id": body.document_id,
        "mode": body.mode,
        "level": body.level,
        "title": body.title,
        "focus_area_id": body.focus_area_id,
    }).execute()
    return {"session_id": s.data[0]["id"]}


@app.post("/ask")
def ask(body: AskBody, user_id: str = Depends(get_user_id)):
    try:
        check_and_count(user_id, "question")
    except LimitError as e:
        raise HTTPException(status_code=402, detail=e.message)
    answer, sources = answer_question(
        user_id, body.session_id, body.document_id,
        body.question, body.level,
    )
    return {"answer": answer, "sources": sources}


@app.post("/ask-photo")
@limiter.limit("30/minute")
async def ask_photo(
    request: Request,
    file: UploadFile,
    session_id: str = Form(...),
    document_id: str = Form(...),
    level: str = Form("novice"),
    question: Optional[str] = Form(None),
    user_id: str = Depends(get_user_id),
):
    img = await file.read()
    _check_file_size(img, MAX_UPLOAD_BYTES_PHOTO)
    user_q = (question or "").strip() or "Explain what is in this photo and how it relates to the material."
    # Anthropic's vision endpoint validates that the media_type matches
    # the actual image bytes. The frontend FormData hardcodes
    # `type: 'image/jpeg'` for every picked image, so Android screenshots
    # and other PNG-backed picks would arrive as PNG bytes labeled JPEG
    # and Anthropic returned 400. Sniff the magic bytes ourselves and
    # trust those over whatever the multipart upload claimed.
    media_type = _sniff_image_type(img) or (file.content_type or "image/jpeg").lower()
    if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        media_type = "image/jpeg"
    # Persist the photo to storage and pass the path to the chat layer
    # so the user message in /sessions/{id}/messages carries
    # `image_path`. Without this, the question appears in lesson
    # history without the photo it was asked about. Path layout mirrors
    # the answer-photo convention: scoped under the user id (RLS-safe),
    # grouped per-session for cleanup, UUID to avoid collisions when
    # the same session has multiple photo asks.
    ext = {"image/jpeg": "jpg", "image/png": "png",
           "image/gif": "gif", "image/webp": "webp"}[media_type]
    photo_path = f"{user_id}/photos/{session_id}/{uuid.uuid4()}.{ext}"
    try:
        supabase.storage.from_("uploads").upload(
            photo_path, img, {"content-type": media_type, "upsert": "true"})
    except Exception as e:
        # Storage hiccup shouldn't break the answer. Fall through with
        # no image_path so the question still gets answered, just
        # without the photo persisted to history.
        log.warning("ask-photo storage upload failed: %s: %s",
                    type(e).__name__, e)
        photo_path = None
    answer, sources = answer_photo_question(
        user_id, session_id, document_id, img, media_type, user_q, level,
        image_path=photo_path)
    # read_back stays in the response shape for backward compatibility with
    # the frontend, but it's empty now since Claude looks at the photo
    # directly and there's no separate OCR transcription to surface.
    return {"read_back": "", "answer": answer, "sources": sources}


@app.get("/sessions")
def list_sessions(
    document_id: Optional[str] = None,
    limit: int = 20,
    user_id: str = Depends(get_user_id),
):
    """List the caller's chat sessions, newest first.
    Optionally filter by document. limit capped at 100."""
    q = supabase.table("chat_sessions").select(
        "id, mode, level, document_id, title, "
        "current_outline_point, focus_area_id, created_at"
    ).eq("user_id", user_id)
    if document_id:
        require_document(document_id, user_id)
        q = q.eq("document_id", document_id)
    q = q.order("created_at", desc=True).limit(min(max(limit, 1), 100))
    return {"sessions": q.execute().data or []}


@app.get("/sessions/{session_id}/messages")
def session_messages(
    session_id: str,
    limit: int = 200,
    user_id: str = Depends(get_user_id),
):
    """Read the full message log for a session (oldest first).
    Caller must own the session. limit capped at 1000."""
    require_session(session_id, user_id)
    rows = supabase.table("messages").select(
        "id, role, content, image_path, metadata, created_at"
    ).eq("session_id", session_id).order("created_at") \
        .limit(min(max(limit, 1), 1000)).execute().data or []
    return {"messages": rows}


@app.post("/lesson/start")
def lesson_start(body: NewSession, user_id: str = Depends(get_user_id)):
    require_document(body.document_id, user_id)
    s = supabase.table("chat_sessions").insert({
        "user_id": user_id,
        "document_id": body.document_id,
        "mode": "teach",
        "level": body.level,
        "title": "Lesson",
        "focus_area_id": body.focus_area_id,
    }).execute()
    return {"session_id": s.data[0]["id"]}


@app.post("/lesson/next")
def lesson_next(body: SessionBody, user_id: str = Depends(get_user_id)):
    """Load the current topic's lesson. Cached lessons (re-opening the
    screen on the same topic) don't count against the plan cap; only an
    actual Claude generation does. The cap check is deferred into
    teach_next so we know whether it was a cache hit or a fresh call."""
    return teach_next(user_id, body.session_id)


@app.post("/lesson/advance")
def lesson_advance_route(body: AdvanceBody, user_id: str = Depends(get_user_id)):
    """User has finished (or skipped) the current topic. Bumps the cursor."""
    return lesson_advance(user_id, body.session_id, skip=body.skip)


@app.post("/lesson/reset")
def lesson_reset_route(body: SessionBody, user_id: str = Depends(get_user_id)):
    """Reset a lesson session back to topic 0 and wipe its cached messages."""
    return lesson_reset(user_id, body.session_id)


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, user_id: str = Depends(get_user_id)):
    """Delete a chat session (Ask or Teach) and every message in it.

    messages FK-cascades from chat_sessions, so a single DELETE on the
    session row clears the conversation. Idempotent: missing rows 404 via
    require_session."""
    require_session(session_id, user_id)
    supabase.table("chat_sessions").delete() \
        .eq("id", session_id).eq("user_id", user_id).execute()
    return {"deleted": True}


@app.get("/assessment/estimate")
def assessment_estimate(
    kind: str = "test",
    format: str = "mixed",
    num_questions: Optional[int] = None,
    user_id: str = Depends(get_user_id),
):
    """Time and question-count hint for the create-test screen.
    If `num_questions` is omitted, returns the default for (kind, format)."""
    if num_questions is None:
        num_questions = assess.default_num_questions(kind, format)
    return {
        "kind": kind,
        "format": format,
        "num_questions": num_questions,
        "estimated_time_seconds": assess.estimate_time_seconds(format, num_questions),
        "rule": {
            "seconds_per_objective": assess.TIME_PER_OBJECTIVE,
            "seconds_per_theory_avg": assess.TIME_PER_THEORY,                # used pre-creation
            "seconds_per_theory_point": assess.SECONDS_PER_THEORY_POINT,     # actual after creation
            "min_seconds_per_theory": assess.MIN_SECONDS_PER_THEORY,
            "min_seconds_total": assess.MIN_TIME_SECONDS,
        },
    }


@app.post("/assessment/create")
@limiter.limit("10/minute")
def assessment_create(request: Request, body: NewAssessment,
                      user_id: str = Depends(get_user_id)):
    try:
        check_and_count(user_id, "assessment")
    except LimitError as e:
        raise HTTPException(status_code=402, detail=e.message)
    aid = assess.create_assessment(
        user_id, body.document_id, body.kind, body.format,
        body.level, body.num_questions, body.time_limit_seconds,
        topic=body.topic, topics=body.topics, focus_area_id=body.focus_area_id,
    )
    return {"assessment_id": aid}


@app.post("/assessment/start")
def assessment_start(body: AssessmentId, user_id: str = Depends(get_user_id)):
    return assess.start_assessment(user_id, body.assessment_id)


@app.get("/assessment/{assessment_id}/time")
def assessment_time(assessment_id: str, user_id: str = Depends(get_user_id)):
    rows = supabase.table("assessments").select("*") \
        .eq("id", assessment_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="assessment not found")
    return {"seconds_left": assess.seconds_left(rows[0])}


@app.post("/answer/save")
def answer_save(body: SaveAnswer, user_id: str = Depends(get_user_id)):
    try:
        assess.save_answer(user_id, body.assessment_id, body.question_id,
                           student_answer=body.student_answer)
    except assess.AssessmentClosed as e:
        raise HTTPException(status_code=410,
                            detail={"message": e.message, "results": e.results})
    return {"saved": True}


@app.post("/answer/save-photo")
@limiter.limit("30/minute")
async def answer_save_photo(
    request: Request,
    file: UploadFile,
    assessment_id: str = Form(...),
    question_id: str = Form(...),
    user_id: str = Depends(get_user_id),
):
    img = await file.read()
    _check_file_size(img, MAX_UPLOAD_BYTES_PHOTO)
    path = f"{user_id}/answers/{question_id}.png"
    supabase.storage.from_("uploads").upload(path, img, {"upsert": "true"})
    read_back = read_image_strong(img)
    try:
        assess.save_answer(user_id, assessment_id, question_id,
                           answer_image_path=path, extracted_work=read_back)
    except assess.AssessmentClosed as e:
        raise HTTPException(status_code=410,
                            detail={"message": e.message, "results": e.results,
                                    "read_back": read_back})
    return {"read_back": read_back}


@app.post("/assessment/submit")
def assessment_submit(body: AssessmentId, user_id: str = Depends(get_user_id)):
    return assess.grade_assessment(user_id, body.assessment_id)


@app.get("/history")
def history(user_id: str = Depends(get_user_id)):
    rows = supabase.table("assessments").select(
        "id, document_id, kind, format, level, score, total_points, submitted_at"
    ).eq("user_id", user_id).eq("status", "submitted") \
     .order("submitted_at", desc=True).execute().data or []
    return {"assessments": rows}


@app.get("/history/{assessment_id}")
def history_detail(assessment_id: str, user_id: str = Depends(get_user_id)):
    a = supabase.table("assessments").select("*") \
        .eq("id", assessment_id).eq("user_id", user_id).execute().data
    if not a:
        raise HTTPException(status_code=404, detail="Not found")

    questions = supabase.table("questions").select(
        "id, question_text, question_type, points, reference_answer, source_chunk_ids"
    ).eq("assessment_id", assessment_id).order("created_at").execute().data or []

    ans = supabase.table("answers").select(
        "id, question_id, student_answer, extracted_work, is_correct, "
        "score_awarded, grade_reasoning, disputed, dispute_reason"
    ).eq("assessment_id", assessment_id).execute().data or []
    by_q = {x["question_id"]: x for x in ans}

    results = []
    for q in questions:
        x = by_q.get(q["id"], {})
        results.append({
            "answer_id": x.get("id"),
            "question": q["question_text"],
            "type": q["question_type"],
            "your_answer": x.get("extracted_work") or x.get("student_answer"),
            "reference_answer": q["reference_answer"],
            "correct": x.get("is_correct"),
            "score": x.get("score_awarded"),
            "out_of": q["points"],
            "reasoning": x.get("grade_reasoning"),
            "sources": assess._resolve_sources(q.get("source_chunk_ids") or []),
            "disputed": bool(x.get("disputed")),
            "dispute_reason": x.get("dispute_reason"),
        })

    results, release_at = assess.hide_exam_answers_if_locked(a[0], results)
    response = {"assessment": a[0], "results": results}
    if release_at:
        response["answers_release_at"] = release_at
    return response


@app.get("/revision/{document_id}/misses")
def revision_misses(document_id: str, user_id: str = Depends(get_user_id)):
    aids = [a["id"] for a in supabase.table("assessments").select("id")
            .eq("user_id", user_id).eq("document_id", document_id)
            .execute().data or []]
    if not aids:
        return {"misses": []}
    ans = supabase.table("answers").select(
        "question_id, student_answer, extracted_work, grade_reasoning"
    ).eq("user_id", user_id).in_("assessment_id", aids) \
     .eq("is_correct", False).execute().data or []
    qids = [x["question_id"] for x in ans]
    qmap = {q["id"]: q for q in supabase.table("questions")
            .select("id, question_text, reference_answer")
            .in_("id", qids).execute().data or []}
    misses = [{
        "question": qmap.get(x["question_id"], {}).get("question_text"),
        "your_answer": x.get("extracted_work") or x.get("student_answer"),
        "reference_answer": qmap.get(x["question_id"], {}).get("reference_answer"),
        "reasoning": x["grade_reasoning"],
    } for x in ans]
    return {"misses": misses}


@app.post("/revision/practice")
@limiter.limit("10/minute")
def revision_practice(request: Request, body: PracticeBody,
                      user_id: str = Depends(get_user_id)):
    try:
        check_and_count(user_id, "assessment")
    except LimitError as e:
        raise HTTPException(status_code=402, detail=e.message)
    aid = revise.create_practice(
        user_id, body.document_id, body.level,
        body.num_questions, body.time_limit_seconds)
    return {"assessment_id": aid}


@app.get("/dashboard")
def dashboard(user_id: str = Depends(get_user_id)):
    profile = supabase.table("users").select(
        "name, plan, trial_ends_at, preferred_level, tts_enabled, phone, avatar_url"
    ).eq("id", user_id).execute().data[0]

    docs = supabase.table("documents").select(
        "id, title, status, progress, created_at"
    ).eq("user_id", user_id).order("created_at", desc=True).execute().data or []

    done = supabase.table("assessments").select(
        "id, kind, score, total_points, level, submitted_at, document_id"
    ).eq("user_id", user_id).eq("status", "submitted") \
     .order("submitted_at", desc=True).execute().data or []

    pcts = [a["score"] / a["total_points"] * 100
            for a in done if a.get("total_points")]
    average = round(sum(pcts) / len(pcts)) if pcts else None

    return {
        "name": profile["name"],
        "plan": profile["plan"],
        "trial_ends_at": profile["trial_ends_at"],
        "preferred_level": profile["preferred_level"],
        "tts_enabled": profile["tts_enabled"],
        "phone": profile["phone"],
        "avatar_url": profile["avatar_url"],
        "documents_count": len(docs),
        "documents": docs,
        "assessments_taken": len(done),
        "average_score_percent": average,
        "recent_assessments": done[:5],
    }


@app.post("/settings")
def update_settings(body: Settings, user_id: str = Depends(get_user_id)):
    patch = {k: v for k, v in body.dict().items() if v is not None}
    if patch:
        supabase.table("users").update(patch).eq("id", user_id).execute()
    return {"updated": patch}


@app.get("/plans")
def list_plans():
    rows = supabase.table("plans").select("*") \
        .eq("is_active", True).order("price_cents").execute().data
    return {"plans": rows}


@app.post("/flashcards/generate")
@limiter.limit("10/minute")
def flashcards_generate(request: Request, body: GenerateCardsBody,
                        user_id: str = Depends(get_user_id)):
    # Generation is one heavy Claude call. Count it the same as one assessment.
    try:
        check_and_count(user_id, "assessment")
    except LimitError as e:
        raise HTTPException(status_code=402, detail=e.message)
    cards = fc.generate_cards(user_id, body.document_id, body.num, body.level,
                              focus_area_id=body.focus_area_id)
    return {"cards": cards}


@app.get("/flashcards/due")
def flashcards_due(
    document_id: Optional[str] = None,
    limit: int = 20,
    user_id: str = Depends(get_user_id),
):
    return {"cards": fc.due_cards(user_id, document_id, limit)}


@app.post("/flashcards/{card_id}/review")
def flashcards_review(card_id: str, body: ReviewBody,
                      user_id: str = Depends(get_user_id)):
    return fc.review_card(user_id, card_id, body.rating)


@app.post("/documents/{document_id}/summarize")
@limiter.limit("20/minute")
def documents_summarize(request: Request, document_id: str, body: SummarizeBody,
                        user_id: str = Depends(get_user_id)):
    require_document(document_id, user_id)
    try:
        check_and_count(user_id, "question")
    except LimitError as e:
        raise HTTPException(status_code=402, detail=e.message)
    if body.topic:
        summary, sources = chat.summarize_topic(
            user_id, document_id, body.topic, body.level)
    else:
        summary, sources = chat.summarize_outline(document_id, body.level)
    return {"summary": summary, "sources": sources}


@app.get("/documents/{document_id}/flashcards")
def flashcards_for_document(document_id: str, user_id: str = Depends(get_user_id)):
    require_document(document_id, user_id)
    rows = supabase.table("flashcards").select("*") \
        .eq("user_id", user_id).eq("document_id", document_id) \
        .order("created_at").execute().data or []
    return {"cards": fc._decorate_cards(rows)}


@app.delete("/flashcards/{card_id}")
def flashcards_delete(card_id: str, user_id: str = Depends(get_user_id)):
    rows = supabase.table("flashcards").select("id") \
        .eq("id", card_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="flashcard not found")
    supabase.table("flashcards").delete().eq("id", card_id).execute()
    return {"deleted": True}


@app.post("/focus-areas")
def focus_create(body: NewFocusArea, user_id: str = Depends(get_user_id)):
    return focus.create(
        user_id, body.document_id, body.name, body.topics, body.exam_date)


@app.get("/focus-areas")
def focus_list(document_id: str, user_id: str = Depends(get_user_id)):
    return {"focus_areas": focus.list_for_document(user_id, document_id)}


@app.get("/focus-areas/all")
def focus_list_all(user_id: str = Depends(get_user_id)):
    """Every focus area the caller owns, annotated with the parent
    document's title for display. Replaces the per-document fan-out the
    home screen used to do (N requests → 1).

    Filters to focus areas whose document is still `ready`, since the
    home screen only surfaces actionable focus areas. Two DB calls
    total: focus_areas, then documents lookup."""
    fas = supabase.table("focus_areas").select("*") \
        .eq("user_id", user_id) \
        .order("created_at", desc=True).execute().data or []
    if not fas:
        return {"focus_areas": []}
    doc_ids = list({fa["document_id"] for fa in fas})
    docs = supabase.table("documents").select("id, title, status") \
        .in_("id", doc_ids).eq("user_id", user_id).execute().data or []
    title_by_id = {d["id"]: d["title"] for d in docs if d["status"] == "ready"}
    out = []
    for fa in fas:
        if fa["document_id"] in title_by_id:
            out.append({**fa, "document_title": title_by_id[fa["document_id"]]})
    return {"focus_areas": out}


@app.get("/focus-areas/{focus_area_id}")
def focus_get(focus_area_id: str, user_id: str = Depends(get_user_id)):
    return focus.get(user_id, focus_area_id)


@app.patch("/focus-areas/{focus_area_id}")
def focus_update(focus_area_id: str, body: UpdateFocusArea,
                 user_id: str = Depends(get_user_id)):
    return focus.update(user_id, focus_area_id,
                        name=body.name, topics=body.topics, exam_date=body.exam_date)


@app.delete("/focus-areas/{focus_area_id}")
def focus_delete(focus_area_id: str, user_id: str = Depends(get_user_id)):
    focus.delete(user_id, focus_area_id)
    return {"deleted": True}


@app.get("/files/signed-url")
def signed_url(path: str, user_id: str = Depends(get_user_id)):
    """Mint a short-lived signed URL for a private storage path.

    The path is validated to start with the caller's user_id, so a user
    can only fetch files inside their own folder (figure images, photo
    answers, uploaded PDFs). 1-hour expiry is enough to load + render in
    the lesson screen.
    """
    if not path or not path.startswith(f"{user_id}/"):
        raise HTTPException(status_code=403, detail="not your file")
    try:
        res = supabase.storage.from_("uploads").create_signed_url(path, 3600)
    except Exception as e:
        log.warning("signed_url failed for path=%s: %s", path, e)
        raise HTTPException(status_code=404, detail="file not found")
    return {"url": res.get("signedURL") or res.get("signed_url") or res.get("signedUrl")}


@app.post("/documents/{document_id}/reprocess")
@limiter.limit("10/minute")
def reprocess_document(request: Request, document_id: str,
                       background: BackgroundTasks,
                       user_id: str = Depends(get_user_id)):
    """Re-run ingestion for a document from its stored original files.

    Used by the ingest screen's Retry button after a failed ingest (Gemini
    quota, a transient error, etc). Lists the document's source/ prefix,
    downloads every file in name (== upload) order, rebuilds the
    (bytes, filename) list, and re-runs ingest_document via BackgroundTasks.

    ingest resumes from the existing documents.ingest_cursor — it is NOT
    reset — so already-embedded pages are skipped and only the remaining
    work runs. If the originals are gone (e.g. an old document uploaded
    before source storage existed), returns 400 so the UI can prompt a
    re-upload instead of looping forever.

    A chapter-scoped upload persists its raw chapter label on the documents
    row, so the retry re-runs ingest restricted to the SAME chapter span.
    Without re-threading it, the retry would fall back to the whole-book path
    and — combined with the resume cursor — ingest the wrong pages.
    """
    require_document(document_id, user_id)

    doc_rows = supabase.table("documents").select("chapter") \
        .eq("id", document_id).eq("user_id", user_id).execute().data or []
    chapter = (doc_rows[0].get("chapter") if doc_rows else None) or None

    source_keys = _list_source_keys(user_id, document_id)
    if not source_keys:
        raise HTTPException(
            status_code=400,
            detail="Original files are no longer available; please re-upload.",
        )

    files: list[tuple[bytes, str]] = []
    for key in source_keys:
        data = supabase.storage.from_("uploads").download(key)
        # Key shape: {user}/{doc}/source/{NNN}_{safe_filename}. Strip the
        # NNN_ order prefix so ingest_document dispatches on the real
        # filename's extension.
        name = os.path.basename(key)
        if "_" in name and name.split("_", 1)[0].isdigit():
            name = name.split("_", 1)[1]
        files.append((data, name))

    # Surface "we are retrying" in the same progress field the ingest screen
    # already polls, and flip status back to processing so the UI leaves the
    # failed state. ingest_cursor is deliberately left untouched.
    supabase.table("documents").update({
        "status": "processing",
        "progress": "retrying",
    }).eq("id", document_id).eq("user_id", user_id).execute()

    if chapter is not None:
        background.add_task(ingest_document, user_id, document_id, files,
                            chapter=chapter)
    else:
        background.add_task(ingest_document, user_id, document_id, files)
    return {"document_id": document_id, "status": "processing"}


@app.delete("/documents/{document_id}")
def delete_document(document_id: str, user_id: str = Depends(get_user_id)):
    """Delete a document and every dependent row the user owns.

    DB cascade chain (from docs/database.md):
      documents -> chunks
      documents -> focus_areas
      documents -> flashcards -> flashcard_reviews
      documents -> chat_sessions -> messages
      documents -> assessments -> questions, answers

    Storage has no FK, so we collect every file path tied to this document
    (the stored original source files, ingest-extracted figure images, plus
    any photo-of-answer images uploaded during tests on this doc) and remove
    them in one storage call before the DB delete. Idempotent: a missing row
    returns 404 via require_document; a failed storage delete is logged and
    ignored so the DB cleanup still runs.
    """
    require_document(document_id, user_id)

    doc_rows = supabase.table("documents").select("file_path") \
        .eq("id", document_id).eq("user_id", user_id).execute().data or []
    pdf_path = (doc_rows[0] or {}).get("file_path") if doc_rows else None

    # Original uploaded files under {user}/{doc}/source/.
    source_paths = _list_source_keys(user_id, document_id)

    # Figure images uploaded during ingest live under chunks.figure_path.
    figure_paths = [c["figure_path"] for c in (
        supabase.table("chunks").select("figure_path")
        .eq("user_id", user_id).eq("document_id", document_id)
        .execute().data or [])
        if c.get("figure_path")]

    # Photo-of-answer images live under assessments tied to this document.
    aids = [a["id"] for a in (supabase.table("assessments").select("id")
            .eq("user_id", user_id).eq("document_id", document_id)
            .execute().data or [])]
    answer_paths: list[str] = []
    if aids:
        answer_paths = [a["answer_image_path"] for a in (
            supabase.table("answers").select("answer_image_path")
            .eq("user_id", user_id).in_("assessment_id", aids)
            .execute().data or [])
            if a.get("answer_image_path")]

    # file_path is the first source key, so it's already in source_paths;
    # keep the explicit pdf_path only when it falls outside the source/
    # prefix (legacy docs uploaded under the old loose-key scheme).
    legacy_pdf = [pdf_path] if pdf_path and pdf_path not in source_paths else []
    storage_paths = legacy_pdf + source_paths + figure_paths + answer_paths
    if storage_paths:
        try:
            removed = supabase.storage.from_("uploads").remove(storage_paths)
            log.info("doc delete removed %d storage files for doc_id=%s",
                     len(removed) if removed else 0, document_id)
        except Exception as e:
            log.warning("storage removal during doc delete failed for doc_id=%s: %s",
                        document_id, e)
            # Continue. Better to drop the DB rows than leave them orphaned.

    supabase.table("documents").delete() \
        .eq("id", document_id).eq("user_id", user_id).execute()
    return {"deleted": True}


@app.post("/answer/{answer_id}/dispute")
def dispute_answer(answer_id: str, body: DisputeBody,
                   user_id: str = Depends(get_user_id)):
    rows = supabase.table("answers").select("id") \
        .eq("id", answer_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="answer not found")
    supabase.table("answers").update({
        "disputed": True,
        "dispute_reason": body.reason,
        "disputed_at": assess.now_iso(),
    }).eq("id", answer_id).execute()
    return {"disputed": True}


@app.get("/documents/{document_id}")
def get_document(document_id: str, user_id: str = Depends(get_user_id)):
    """Single-document detail with parsed outline_points + topic counts.

    Saves the frontend two extra round-trips on the library-detail screen
    (would otherwise need /dashboard + /documents/{id}/progress + reading
    the outline column separately). Pure read, no AI, no plan-cap charge.
    """
    require_document(document_id, user_id)
    doc = supabase.table("documents").select(
        "id, title, status, progress, created_at, outline"
    ).eq("id", document_id).execute().data[0]
    points = outline_points(doc.get("outline") or "")
    sessions = supabase.table("chat_sessions").select("current_outline_point") \
        .eq("user_id", user_id).eq("document_id", document_id).eq("mode", "teach") \
        .execute().data or []
    taught = max((s["current_outline_point"] for s in sessions), default=0)
    return {
        "id": doc["id"],
        "title": doc["title"],
        "status": doc["status"],
        "progress": doc["progress"],
        "page_count": None,
        "created_at": doc["created_at"],
        "outline_points": points,
        "topics_total": len(points),
        "topics_taught": min(taught, len(points)) if points else taught,
    }


@app.get("/documents/{document_id}/progress")
def document_progress(document_id: str, user_id: str = Depends(get_user_id)):
    require_document(document_id, user_id)
    doc = supabase.table("documents").select("id, title, outline") \
        .eq("id", document_id).execute().data[0]

    topics_total = len(outline_points(doc.get("outline") or ""))

    sessions = supabase.table("chat_sessions").select("current_outline_point") \
        .eq("user_id", user_id).eq("document_id", document_id).eq("mode", "teach") \
        .execute().data or []
    topics_taught = max((s["current_outline_point"] for s in sessions), default=0)
    if topics_total:
        topics_taught = min(topics_taught, topics_total)

    submitted = supabase.table("assessments").select("score, total_points") \
        .eq("user_id", user_id).eq("document_id", document_id).eq("status", "submitted") \
        .execute().data or []
    pcts = [a["score"] / a["total_points"] * 100
            for a in submitted if a.get("total_points")]
    average = round(sum(pcts) / len(pcts)) if pcts else None

    cards = supabase.table("flashcards").select("repetitions, interval_days") \
        .eq("user_id", user_id).eq("document_id", document_id).execute().data or []
    cards_total = len(cards)
    cards_mastered = sum(
        1 for c in cards
        if (c.get("repetitions") or 0) >= 3 and (c.get("interval_days") or 0) >= 21
    )

    return {
        "document_id": document_id,
        "title": doc["title"],
        "topics_total": topics_total,
        "topics_taught": topics_taught,
        "assessments_taken": len(submitted),
        "average_score_percent": average,
        "flashcards_in_library": cards_total,
        "flashcards_mastered": cards_mastered,
    }


@app.post("/me/avatar")
@limiter.limit("10/minute")
async def upload_avatar(
    request: Request,
    file: UploadFile,
    user_id: str = Depends(get_user_id),
):
    """Upload (or replace) the caller's profile avatar.

    Accepts a single image under the multipart field name "file", enforces
    the 10 MB image cap, and writes a UNIQUE key {user_id}/avatar/<rand>.jpg in
    the private "uploads" bucket. A unique key per upload means avatar_url
    CHANGES on replace, so the frontend's signed-url query re-fetches and the
    new photo actually appears (a fixed key would keep serving the old image).
    The previous avatar object is deleted so storage never accumulates.
    avatar_url stores the storage KEY, not a URL; the frontend renders it via
    GET /files/signed-url. Non-image uploads are rejected 400.
    """
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Avatar must be an image.")
    img = await file.read()
    _check_file_size(img, MAX_UPLOAD_BYTES_IMAGE)
    prev = supabase.table("users").select("avatar_url") \
        .eq("id", user_id).execute().data
    old_key = prev[0].get("avatar_url") if prev else None
    key = f"{user_id}/avatar/{os.urandom(8).hex()}.jpg"
    supabase.storage.from_("uploads").upload(key, img, {"upsert": "true"})
    supabase.table("users").update({"avatar_url": key}).eq("id", user_id).execute()
    # Remove the previous avatar so changing photos never accumulates storage.
    if old_key and old_key != key:
        try:
            supabase.storage.from_("uploads").remove([old_key])
        except Exception:
            pass
    return {"avatar_url": key}


@app.delete("/me/data")
def clear_my_data(user_id: str = Depends(get_user_id)):
    """Delete every piece of user-owned content but keep the account itself.

    Wipes documents (cascades to chunks, focus_areas, flashcards and
    flashcard_reviews, chat_sessions and messages, assessments and
    questions/answers), plus every storage file under the user's folder
    (original source files, figure images, photo answers). Auth user and
    public.users profile are left intact so the user can keep using the app
    from a blank slate.

    Order: storage first (no FK cascade), then documents (DB cascade
    handles everything downstream).
    """
    docs = supabase.table("documents").select("id, file_path") \
        .eq("user_id", user_id).execute().data or []
    figures = supabase.table("chunks").select("figure_path") \
        .eq("user_id", user_id).execute().data or []
    answers = supabase.table("answers").select("answer_image_path") \
        .eq("user_id", user_id).execute().data or []
    # Original uploaded files live under {user}/{doc}/source/ per document.
    source_paths: list[str] = []
    for d in docs:
        source_paths.extend(_list_source_keys(user_id, d["id"]))
    prof = supabase.table("users").select("avatar_url").eq("id", user_id).execute().data
    avatar_keys = [k for k in [
        (prof[0].get("avatar_url") if prof else None),
        f"{user_id}/avatar.jpg",  # legacy fixed-key avatar, if any
    ] if k]
    paths = (
        [d["file_path"] for d in docs if d.get("file_path")]
        + source_paths
        + [c["figure_path"] for c in figures if c.get("figure_path")]
        + [a["answer_image_path"] for a in answers if a.get("answer_image_path")]
        + avatar_keys  # best-effort: avoid orphaning the avatar (current + legacy)
    )

    if paths:
        try:
            supabase.storage.from_("uploads").remove(paths)
        except Exception as e:
            log.warning("storage removal during data clear failed for user_id=%s: %s",
                        user_id, e)
            # Continue. Better to drop the DB rows than abort halfway.

    # Documents cascades to chunks, focus_areas, flashcards,
    # flashcard_reviews, chat_sessions, messages, assessments, questions,
    # and answers. So this single delete clears the entire study graph.
    # `usage` is deliberately NOT reset: questions/assessments-this-month
    # are plan accounting, not user content. Letting Clear Data reset
    # them would turn the button into a free way to bypass plan caps.
    # Usage resets naturally at the start of the next billing period.
    supabase.table("documents").delete().eq("user_id", user_id).execute()

    return {"cleared": True}


@app.delete("/me/account")
def delete_account(user_id: str = Depends(get_user_id)):
    """Delete the caller's account and all owned data (right to erasure).

    Cascades: storage files first (no FK cascade from DB), then auth.users
    which cascades public.users -> documents -> chunks, chat_sessions ->
    messages, assessments -> questions/answers, usage. Idempotent at the
    DB layer because auth.admin.delete_user raises on a missing user.
    """
    docs = supabase.table("documents").select("id, file_path") \
        .eq("user_id", user_id).execute().data or []
    figures = supabase.table("chunks").select("figure_path") \
        .eq("user_id", user_id).execute().data or []
    answers = supabase.table("answers").select("answer_image_path") \
        .eq("user_id", user_id).execute().data or []
    # Original uploaded files live under {user}/{doc}/source/ per document.
    source_paths: list[str] = []
    for d in docs:
        source_paths.extend(_list_source_keys(user_id, d["id"]))
    prof = supabase.table("users").select("avatar_url").eq("id", user_id).execute().data
    avatar_keys = [k for k in [
        (prof[0].get("avatar_url") if prof else None),
        f"{user_id}/avatar.jpg",  # legacy fixed-key avatar, if any
    ] if k]
    paths = (
        [d["file_path"] for d in docs if d.get("file_path")]
        + source_paths
        + [c["figure_path"] for c in figures if c.get("figure_path")]
        + [a["answer_image_path"] for a in answers if a.get("answer_image_path")]
        + avatar_keys  # best-effort: avoid orphaning the avatar (current + legacy)
    )

    if paths:
        try:
            supabase.storage.from_("uploads").remove(paths)
        except Exception as e:
            log.warning("storage removal during account deletion failed for user_id=%s: %s",
                        user_id, e)
            # Continue — we'd rather complete the DB delete than abort halfway.

    try:
        supabase.auth.admin.delete_user(user_id)
    except Exception:
        log.exception("auth.admin.delete_user failed for user_id=%s", user_id)
        raise HTTPException(
            status_code=500,
            detail="Account deletion did not complete. Contact support.",
        )

    return {"deleted": True}


@app.get("/me/access")
def my_access(user_id: str = Depends(get_user_id)):
    state = billing.access_state(user_id)
    usage = billing.get_usage(user_id)
    plan = billing.get_plan(state["plan"])
    return {
        "state": state,
        "usage": {"questions": usage["questions_used"],
                  "assessments": usage["assessments_used"]},
        "limits": {"documents": plan["max_documents"],
                   "questions": plan["max_questions"],
                   "assessments": plan["max_assessments"]},
    }
