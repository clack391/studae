import logging
import os
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

MAX_UPLOAD_BYTES_PDF = 100 * 1024 * 1024   # 100 MB for /upload
MAX_UPLOAD_BYTES_PHOTO = 10 * 1024 * 1024  # 10 MB for /ask-photo, /answer/save-photo

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


@app.post("/upload")
@limiter.limit("10/minute")
async def upload(
    request: Request,
    file: UploadFile,
    background: BackgroundTasks,
    user_id: str = Depends(get_user_id),
):
    try:
        check_and_count(user_id, "document")
    except LimitError as e:
        raise HTTPException(status_code=402, detail=e.message)
    file_bytes = await file.read()
    _check_file_size(file_bytes, MAX_UPLOAD_BYTES_PDF)
    # The picker may hand us filenames in a few ugly shapes:
    #   - URL-encoded ("CARE%20FOR%20PLANT.pdf")
    #   - underscore-as-space on Android ("Thriving_Indoor.pdf")
    #   - with the file extension, which the UI doesn't need
    # Normalise to a clean display title. Keep `raw_name` around because
    # ingest_document checks the extension to decide PDF vs single-image.
    raw_name = file.filename or "document.pdf"
    decoded = urllib.parse.unquote(raw_name)
    stem, ext = os.path.splitext(decoded)
    title = stem.replace("_", " ").strip() or "Document"
    if not ext:
        ext = ".pdf"
    # Stamp every upload with a UUID so re-uploading the same filename does
    # not collide on Supabase Storage (which 409s on duplicate keys).
    path = f"{user_id}/{uuid.uuid4()}{ext}"

    supabase.storage.from_("uploads").upload(path, file_bytes)

    doc = supabase.table("documents").insert({
        "user_id": user_id,
        "title": title,
        "file_path": path,
        "status": "processing",
    }).execute()
    doc_id = doc.data[0]["id"]

    # Pass the original filename (with extension) so ingest_document can
    # route PDFs to PyMuPDF and single images to the OCR path. The
    # stripped, display-friendly `title` is just for the UI.
    background.add_task(ingest_document, user_id, doc_id, file_bytes, decoded)

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
    # Anthropic's vision endpoint expects a media_type. Default to JPEG if
    # the upload didn't declare one.
    media_type = (file.content_type or "image/jpeg").lower()
    if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        media_type = "image/jpeg"
    answer, sources = answer_photo_question(
        user_id, session_id, document_id, img, media_type, user_q, level)
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
        "name, plan, trial_ends_at, preferred_level, tts_enabled"
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
    (the PDF, plus any photo-of-answer images uploaded during tests on this
    doc) and remove them in one storage call before the DB delete.
    Idempotent: a missing row returns 404 via require_document; a failed
    storage delete is logged and ignored so the DB cleanup still runs.
    """
    require_document(document_id, user_id)

    doc_rows = supabase.table("documents").select("file_path") \
        .eq("id", document_id).eq("user_id", user_id).execute().data or []
    pdf_path = (doc_rows[0] or {}).get("file_path") if doc_rows else None

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

    storage_paths = ([pdf_path] if pdf_path else []) + figure_paths + answer_paths
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


@app.delete("/me/data")
def clear_my_data(user_id: str = Depends(get_user_id)):
    """Delete every piece of user-owned content but keep the account itself.

    Wipes documents (cascades to chunks, focus_areas, flashcards and
    flashcard_reviews, chat_sessions and messages, assessments and
    questions/answers), plus every storage file under the user's folder
    (PDFs, figure images, photo answers). Auth user and public.users
    profile are left intact so the user can keep using the app from a
    blank slate.

    Order: storage first (no FK cascade), then documents (DB cascade
    handles everything downstream).
    """
    docs = supabase.table("documents").select("file_path") \
        .eq("user_id", user_id).execute().data or []
    figures = supabase.table("chunks").select("figure_path") \
        .eq("user_id", user_id).execute().data or []
    answers = supabase.table("answers").select("answer_image_path") \
        .eq("user_id", user_id).execute().data or []
    paths = (
        [d["file_path"] for d in docs if d.get("file_path")]
        + [c["figure_path"] for c in figures if c.get("figure_path")]
        + [a["answer_image_path"] for a in answers if a.get("answer_image_path")]
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
    docs = supabase.table("documents").select("file_path") \
        .eq("user_id", user_id).execute().data or []
    answers = supabase.table("answers").select("answer_image_path") \
        .eq("user_id", user_id).execute().data or []
    paths = [d["file_path"] for d in docs if d.get("file_path")] + \
            [a["answer_image_path"] for a in answers if a.get("answer_image_path")]

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
