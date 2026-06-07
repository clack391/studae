# User flow: end-to-end walkthrough

Every backend endpoint, in the order a real student would use them. Each section has the curl command, what success looks like, and the common gotchas.

This doubles as:
- A reference for testing the API by hand.
- A spec for the frontend dev — every screen in the Expo app maps to one or two endpoints below.

If you're wiring up the Expo app, **also read [frontend-integration.md](frontend-integration.md)** — that doc shows the React Native / TypeScript patterns (auth, file uploads, markdown rendering, TTS, polling cadence, error handling) that complement the curl examples here.

## Before you start

The backend must be running:

```bash
cd study-app-backend
uv run uvicorn app.main:app --reload
```

You need a confirmed Supabase user. Either create one in the Supabase dashboard (Authentication → Users → Add user, with **Auto Confirm User** checked) or use the test account already set up. Then mint a JWT and pin a few variables you'll reuse:

```bash
TOKEN=$(uv run python -m scripts.get_token your-email@example.com 'your-password')
echo "${TOKEN:0:40}..."   # sanity check — should be a long base64ish string

BASE=http://localhost:8000
AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H "Content-Type: application/json")
```

From here on, every protected call uses `"${AUTH[@]}"` and JSON bodies use `"${JSON[@]}"`.

### One cross-cutting feature: sources

Every AI response — `/ask`, `/ask-photo`, `/lesson/next`, `/assessment/submit`, `/history/{id}`, all flashcard endpoints, and `/documents/{id}/summarize` (topic variant) — returns a `sources` array alongside its content:

```json
"sources": [
  {"chunk_id": "uuid", "page_number": 14, "snippet": "first 200 chars of the chunk text...", "figure_path": null},
  {"chunk_id": "uuid", "page_number": 7,  "snippet": "",                                       "figure_path": "<user_id>/<doc_id>/figures/p7_0.png"}
]
```

Render these under every AI response as "from your material, page N" tappable cards. They are the trust layer — students can see exactly what fed the answer. When a source has a `figure_path` (extracted image from a PDF page), resolve a 1-hour signed URL via `GET /files/signed-url?path=...` and render it as a diagram next to the chunk text. Sources are persisted into `messages.metadata.sources` for teach lessons and /ask replies, so the lesson-history transcript can replay figures + citations without re-running RAG.

Single-page PDFs (HTML-to-PDF exports where every chunk shares `page_number = 1`) have all `figure_path` values nulled out on the server before the response goes back — positional figure-to-chunk assignment isn't reliable on those documents, so we'd rather show no figure than a wrong one.

## 1. Upload + ingest

Upload a PDF (or an image). Ingestion runs in the background — the response comes back immediately with a document id and a `processing` status.

```bash
DOC=$(curl -s -X POST "$BASE/upload" "${AUTH[@]}" \
  -F "file=@/path/to/your.pdf" \
  | python -c "import sys,json;print(json.load(sys.stdin)['document_id'])")
echo "document: $DOC"
```

Poll for live progress (the document carries a `progress` string while ingesting):

```bash
uv run python -m scripts.check_status $DOC
```

You'll see the `progress` line tick through `extracting text`, then `embedding chunk N of M`, then `building outline`, then clearing to `—` when status flips to `ready`. The same `progress` field is on each document in the `/dashboard` response, so the frontend can render a progress bar without polling a separate endpoint.

A successful ingest has:
- `status: ready`
- `chunks: <some positive number>`
- `outline: yes (~N chars)` with a readable table of contents

If `status: failed`, the last `progress` string stays in place so you know *where* it died (e.g. `embedding chunk 47 of 312`).

**What's happening under the hood:** clean text is extracted (PyMuPDF for normal PDFs, Gemini OCR per-page for scanned ones), the text is split into ~800-word chunks per page, each chunk is embedded with Gemini, page numbers and content types (`text`/`math`/`figure`) are stored, and Claude reads the whole thing once to write an outline. The outline is what teach mode walks down later.

**Gotchas:**
- Only PDFs and image files are supported. `.pptx` etc. will land in `documents` and then fail.
- The `progress` column is the public-facing progress; the server logs (`app.ingest`) carry more detail.

## 2. Ask mode

Create a chat session, then ask questions grounded in the document.

```bash
SESSION=$(curl -s -X POST "$BASE/session" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"level\":\"novice\"}" \
  | python -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
echo "session: $SESSION"

curl -s -X POST "$BASE/ask" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"session_id\":\"$SESSION\",\"document_id\":\"$DOC\",\"question\":\"Summarize this material in one sentence.\",\"level\":\"novice\"}"
echo
```

Levels are `novice` / `amateur` / `professional`. Response shape:

```json
{
  "answer": "...markdown text...",
  "sources": [{"chunk_id": "...", "page_number": 14, "snippet": "..."}]
}
```

Ask something the document doesn't cover and watch the refusal:

```bash
curl -s -X POST "$BASE/ask" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"session_id\":\"$SESSION\",\"document_id\":\"$DOC\",\"question\":\"What is the capital of France?\",\"level\":\"novice\"}"
echo
```

You should see *"The material provided does not cover this question."* `sources` will be empty or absent.

### Photo problem

Upload an image of a problem; the answer riffs on it:

```bash
curl -s -X POST "$BASE/ask-photo" "${AUTH[@]}" \
  -F "session_id=$SESSION" \
  -F "document_id=$DOC" \
  -F "level=novice" \
  -F "file=@/path/to/problem.png"
echo
```

Response shape: `{ read_back: "", answer, sources }`. `read_back` is kept as an empty string for backward compatibility with old client code — `/ask-photo` no longer pre-OCRs the image. Claude vision sees the photo directly.

Multi-question pipeline (2026-06-07): the backend runs a three-stage flow on every `/ask-photo` call:
1. **Haiku vision pass** extracts every question off the photo and tags each with the matching outline topic.
2. **Per-question RAG** fuses topic + question (`"<topic>: <question>"`) and retries on miss (topic-only, then bare-question).
3. **Sonnet vision pass** receives the photo + a per-question material block + the full outline, and replies with a `**Question N:**` heading per answer.

Intent comes from the typed prompt:
- `"answer these"` / `"solve them"` → direct answers
- `"explain"` / `"walk me through"` / `"step by step"` → step-by-step explanations
- `"check my work"` / `"is this correct?"` → grades the student's visible written work
- empty or vague (`"hi"`, `"look at this"`) → Sonnet is **skipped** entirely; the response lists the extracted questions back and asks what the student wants. Saves the Sonnet call until intent is clear.

## 3. Teach mode

Start a lesson session for a document, then walk it forward one topic at a time.

```bash
LESSON=$(curl -s -X POST "$BASE/lesson/start" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"level\":\"novice\"}" \
  | python -c "import sys,json;print(json.load(sys.stdin)['session_id'])")

curl -s -X POST "$BASE/lesson/next" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"session_id\":\"$LESSON\"}"
echo
```

Response shape:

```json
{
  "done": false,
  "topic": "What is IPM?",
  "lesson": "...markdown lesson body...",
  "progress": "1 of 33",
  "sources": [{"chunk_id": "...", "page_number": 3, "snippet": "...", "figure_path": null}],
  "level": "novice"
}
```

`progress` is `"N of M"` for a progress bar. `done: true` once you've finished the outline. State (which topic, what's been covered) lives on the server, so a refresh or reconnect picks up exactly where it left off. The lesson body has its RECAP marker stripped server-side; `lesson_summary` on the session quietly accumulates a one-sentence recap of each topic, which is what stops repetition across turns. `level` is returned so mid-lesson Ask can inherit and lock the lesson's level instead of falling back to the student's preferred level.

### Focus-scoped lessons

Pass `focus_area_id` on `/lesson/start` to have teach mode walk **only** the topics in a focus area, in order, instead of the whole outline. The session stores the focus_area_id, so every `/lesson/next` after that respects it.

```bash
curl -s -X POST "$BASE/lesson/start" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"level\":\"novice\",\"focus_area_id\":\"<focus-id>\"}"
```

`progress` will now read `"1 of N"` where N is the count of focus topics, not the full outline.

### Browse and resume past lessons

Every lesson Claude has taught is stored permanently in `messages`. Two read endpoints let the student review past lessons or resume the one they were on, **without paying for the lesson to be regenerated**.

```bash
# List the user's chat sessions for a document, newest first.
# Omit document_id to list across all documents. limit default 20, capped at 100.
curl -s "$BASE/sessions?document_id=$DOC" "${AUTH[@]}" | python -m json.tool

# Read the full message log for one session (oldest first).
# limit default 200, capped at 1000.
curl -s "$BASE/sessions/$LESSON/messages" "${AUTH[@]}" | python -m json.tool
```

Response shapes:

```json
{
  "sessions": [
    {
      "id": "uuid",
      "mode": "teach",
      "level": "novice",
      "document_id": "uuid",
      "title": "Lesson",
      "current_outline_point": 5,
      "focus_area_id": null,
      "created_at": "..."
    }
  ]
}
```

```json
{
  "messages": [
    {"id": "uuid", "role": "user",      "content": "...", "image_path": null, "created_at": "..."},
    {"id": "uuid", "role": "assistant", "content": "...markdown lesson...", "image_path": null, "created_at": "..."}
  ]
}
```

**Frontend pattern.** On the document detail screen, fetch `/sessions?document_id=...` and show a "Continue where you left off" card for any session with `mode: "teach"` and `current_outline_point > 0`. Tap → call `/lesson/next` with that session_id — it resumes mid-lesson and **doesn't burn Claude credit on previously-taught topics**. For a "Lesson history" screen, fetch `/sessions/{id}/messages` and render each assistant message with the markdown component — same UI as a fresh lesson, just read-only.

### Asking mid-lesson

A lesson and ask mode share the same `messages` table — you can pause and ask without losing your place:

```bash
curl -s -X POST "$BASE/ask" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"session_id\":\"$LESSON\",\"document_id\":\"$DOC\",\"question\":\"Wait, what does that term mean?\",\"level\":\"novice\"}"
echo

curl -s -X POST "$BASE/lesson/next" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"session_id\":\"$LESSON\"}"
echo
```

The second call resumes teaching the **next** topic, not a re-teach of what you just asked about.

## 4. Test (assessment)

Generate a test on demand. Claude reads the chunks and produces questions, reference answers, and rubrics together — that's the move that makes grading fair later.

### Time hint (frontend should show this before /assessment/create)

```bash
curl -s "$BASE/assessment/estimate?format=theory&num_questions=10" "${AUTH[@]}" | python -m json.tool
```

Returns the suggested time + the per-question formula:

```json
{
  "format": "theory",
  "num_questions": 10,
  "estimated_time_seconds": 3000,
  "rule": {"seconds_per_objective": 60, "seconds_per_theory": 300, "min_seconds": 120}
}
```

Show this on the "create test" screen as "this test should take ~50 minutes". Omit `num_questions` to get the per-format default.

### Create

```bash
AID=$(curl -s -X POST "$BASE/assessment/create" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"format\":\"mixed\",\"level\":\"novice\"}" \
  | python -c "import sys,json;print(json.load(sys.stdin)['assessment_id'])")
echo "assessment: $AID"
```

Both `num_questions` and `time_limit_seconds` are optional. `time_limit_seconds` is computed from the actual questions Claude generated:
- **MCQ:** 60 seconds each
- **Theory:** 90 seconds × point value, with a 2-minute floor per question (so a 1-pt theory gets 2 min, a 9-pt synthesis essay gets ~13 min)
- Overall minimum: 2 minutes total

Pass `time_limit_seconds` explicitly to override.

`num_questions` defaults are per `(kind, format)`:

| kind \ format | objective | theory | mixed |
|---|---|---|---|
| **test** | 30 | 10 | 12 |
| **exam** | 60 | 30 | 30 |

Formats: `objective` (MCQ), `theory` (open-ended), `mixed`.

### Test vs exam — three real differences

- **Default count** — test is smaller, exam is comprehensive (see table above).
- **Scope** — only `kind: "test"` accepts a `topic` field. With a topic, the question generation pulls RAG-retrieved chunks for just that topic instead of the whole document. Exams always cover the whole document; passing `topic` to an exam silently ignores it.
- **Difficulty mix** — the system prompt for `kind: "exam"` explicitly asks Claude for harder questions mixing recall, application, and synthesis across multiple sections. Tests focus on recall and basic understanding.

### Source priority for question generation

`/assessment/create` accepts three mutually exclusive ways to scope the source material. The backend uses this priority order:

| What you pass | Scope used |
|---|---|
| `focus_area_id` | Multi-topic RAG across the focus area's saved topic list. Works for both tests and exams. |
| `topic` (and no `focus_area_id`) | Single-topic RAG. Honored only when `kind: "test"`; ignored for exams. |
| Neither | Whole document, stratified sampling. |

Pass at most one. Mixed combinations resolve in that order: `focus_area_id` wins, then `topic`, then default.

Examples:

```bash
# A topic-scoped test (one chapter)
curl -s -X POST "$BASE/assessment/create" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"kind\":\"test\",\"format\":\"objective\",\"topic\":\"spider mites\"}"
# → uses RAG on "spider mites" + 30 MCQs + ~30 min + easier difficulty

# A full exam
curl -s -X POST "$BASE/assessment/create" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"kind\":\"exam\",\"format\":\"mixed\",\"level\":\"professional\"}"
# → whole document + 30 questions + ~90 min + synthesis-heavy difficulty
```

Start the test — records the server-side start time and returns the questions with answers/rubrics stripped:

```bash
curl -s -X POST "$BASE/assessment/start" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"assessment_id\":\"$AID\"}" | python -m json.tool
```

Each question has only `id`, `question_text`, `question_type`, `options`, `points`. **No `reference_answer`, no `rubric`.** Source-of-truth answers never reach the client.

`seconds_left` is the real clock. The phone displays it; the server owns it.

### Autosave answers

Save each answer as the student types:

```bash
QID=<a-question-id-from-start-response>

curl -s -X POST "$BASE/answer/save" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"assessment_id\":\"$AID\",\"question_id\":\"$QID\",\"student_answer\":\"B\"}"
echo
```

Upsert semantics — call it again to overwrite. **If the timer has expired**, this returns **HTTP 410** with the auto-submitted results in the body:

```json
HTTP/1.1 410 Gone
{
  "detail": {
    "message": "Time has expired; your assessment has been submitted.",
    "results": { "score": 4, "total": 10, "results": [...] }
  }
}
```

Treat 410 as "render the results screen" — the work is graded.

### Photo math answer

```bash
curl -s -X POST "$BASE/answer/save-photo" "${AUTH[@]}" \
  -F "assessment_id=$AID" \
  -F "question_id=$QID" \
  -F "file=@/path/to/working.png"
echo
```

Response has `read_back` — Gemini's OCR of the handwriting. Show it immediately so the student catches a misread before it costs them marks. Also uses `gemini-2.5-flash` (stronger model).

### Check the timer

```bash
curl -s "$BASE/assessment/$AID/time" "${AUTH[@]}"
```

Use for the countdown UI — but the server doesn't auto-submit at zero through this endpoint; auto-submit fires only when `/answer/save` or `/answer/save-photo` is called past expiry. Frontend should also call `/assessment/submit` when the clock hits 0 if the student is idle.

### Submit

```bash
curl -s -X POST "$BASE/assessment/submit" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"assessment_id\":\"$AID\"}" | python -m json.tool
```

Idempotent — calling it again on an already-submitted assessment returns the saved results without re-grading.

Response shape per result row:

```json
{
  "answer_id": "uuid",
  "question": "...",
  "your_answer": "...",
  "reference_answer": "...",
  "correct": true,
  "score": 1.0,
  "out_of": 1,
  "reasoning": "...rationale...",
  "sources": [{"chunk_id": "...", "page_number": 47, "snippet": "..."}],
  "disputed": false,
  "dispute_reason": null
}
```

`answer_id` is what `/answer/{id}/dispute` operates on. `sources` show the student which chunks of their material backed each question — same transparency principle as ask/teach.

For photo-graded theory answers, `reasoning` is automatically prefixed with `"What we read from your photo: <extracted_work>\n\nWhy this grade: <rationale>"` so the student sees both.

## 5. Focus areas (Area of Concentration)

A focus area is a saved list of topics from a document — what a teacher in the African / British system would call an "Area of Concentration" for an upcoming exam. Once saved, it can scope `/assessment/create`, `/flashcards/generate`, and `/lesson/start` via the `focus_area_id` field on each.

### Create

```bash
FOCUS=$(curl -s -X POST "$BASE/focus-areas" "${AUTH[@]}" "${JSON[@]}" \
  -d "{
    \"document_id\":\"$DOC\",
    \"name\":\"Mid-term: pests\",
    \"topics\":[\"spider mites\",\"fungus gnats\",\"root rot\"],
    \"exam_date\":\"2026-06-30\"
  }" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
```

`name` shows on the UI. `topics` is the list the RAG uses. `exam_date` is optional — show a countdown on the home screen.

### List for a document

```bash
curl -s "$BASE/focus-areas?document_id=$DOC" "${AUTH[@]}" | python -m json.tool
```

### Open one

```bash
curl -s "$BASE/focus-areas/$FOCUS" "${AUTH[@]}" | python -m json.tool
```

### Update (rename, change topics, change date)

```bash
curl -s -X PATCH "$BASE/focus-areas/$FOCUS" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"topics":["spider mites","fungus gnats","root rot","aphids"]}'
```

PATCH semantics — only the fields you send.

### Delete

```bash
curl -s -X DELETE "$BASE/focus-areas/$FOCUS" "${AUTH[@]}"
echo
```

### Use it on a generation endpoint

```bash
# Test scoped to the focus area
curl -s -X POST "$BASE/assessment/create" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"kind\":\"test\",\"format\":\"objective\",\"num_questions\":5,\"focus_area_id\":\"$FOCUS\"}"

# Flashcards scoped to the focus area
curl -s -X POST "$BASE/flashcards/generate" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"num\":10,\"focus_area_id\":\"$FOCUS\"}"

# Lesson scoped to the focus area — teach mode walks ONLY these topics
curl -s -X POST "$BASE/lesson/start" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"level\":\"novice\",\"focus_area_id\":\"$FOCUS\"}"
```

The frontend "exam prep" screen typically: lets the student create or pick a focus area, shows the countdown to `exam_date`, and offers three big buttons — "Walk me through these topics" (`/lesson/start`), "Make flashcards" (`/flashcards/generate`), and "Test me" (`/assessment/create`) — all pre-populated with the focus_area_id.

## 6. History

List submitted assessments:

```bash
curl -s "$BASE/history" "${AUTH[@]}" | python -m json.tool
```

Reopen one (same shape as `/assessment/submit`):

```bash
curl -s "$BASE/history/$AID" "${AUTH[@]}" | python -m json.tool
```

Older assessments (taken before `score` and `total_points` were added to the schema) will show those fields as `null`; new submits populate them.

## 7. Revise

Wrong questions on a document, with grading reasoning:

```bash
curl -s "$BASE/revision/$DOC/misses" "${AUTH[@]}" | python -m json.tool
```

Generate a practice test biased toward weak areas:

```bash
curl -s -X POST "$BASE/revision/practice" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"level\":\"novice\",\"num_questions\":3}"
echo
```

Returns the same `{assessment_id}` shape as `/assessment/create`. Take it through start → save → submit like any other test. **Counts against the monthly assessment cap.**

## 8. Flashcards (spaced repetition)

This is the headline study feature. Generate cards once from a document, then review them on the SM-2 schedule indefinitely.

### Generate

```bash
curl -s -X POST "$BASE/flashcards/generate" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"num\":20,\"level\":\"novice\"}"
echo
```

One Claude call generates N cards spanning the material with sources attached. Counts as **1 assessment** against the plan cap (cards cost real money to generate; reviewing them is free).

Pass `focus_area_id` to scope generation to only the topics in that focus area (multi-topic RAG):

```bash
curl -s -X POST "$BASE/flashcards/generate" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"document_id\":\"$DOC\",\"num\":10,\"focus_area_id\":\"<focus-id>\"}"
```

Returns the inserted cards with full SRS state and resolved `sources`:

```json
{
  "cards": [
    {
      "id": "uuid", "front": "...", "back": "...",
      "ease_factor": 2.5, "interval_days": 0, "repetitions": 0,
      "next_review_at": "now",
      "sources": [{"chunk_id": "...", "page_number": 3, "snippet": "..."}]
    }
  ]
}
```

### Due cards (the daily review queue)

```bash
curl -s "$BASE/flashcards/due?document_id=$DOC&limit=20" "${AUTH[@]}" | python -m json.tool
```

`document_id` is optional — omit to get due cards across all the student's documents. Cards are returned in ascending `next_review_at` order so the most-overdue come first.

### Review a card

```bash
curl -s -X POST "$BASE/flashcards/<card_id>/review" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"rating": 5}'
echo
```

`rating` is 0–5 (SuperMemo 2):
- **0–2 = forgot.** Resets repetitions to 0, schedules tomorrow.
- **3 = hard but recalled.** Advances; ease factor drops.
- **4 = good.** Advances; ease factor stays.
- **5 = easy.** Advances; ease factor rises.

Response is the new schedule:

```json
{
  "next_review_at": "2026-06-05T...",
  "interval_days": 1,
  "ease_factor": 2.6,
  "repetitions": 1
}
```

### Full card library for a document

```bash
curl -s "$BASE/documents/$DOC/flashcards" "${AUTH[@]}" | python -m json.tool
```

Use for a "browse my cards" screen — every card with its sources.

### Delete a bad card

```bash
curl -s -X DELETE "$BASE/flashcards/<card_id>" "${AUTH[@]}"
echo
```

## 9. Chapter / outline summarize

Generate a 5–8 bullet summary at the student's level. Counts as **1 question** against the plan cap.

```bash
# Topic-focused (uses RAG retrieval, returns sources)
curl -s -X POST "$BASE/documents/$DOC/summarize" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"topic":"spider mites","level":"novice"}'
echo

# Whole-outline (uses the stored outline, no sources)
curl -s -X POST "$BASE/documents/$DOC/summarize" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"level":"amateur"}'
echo
```

Response:

```json
{"summary": "## ...markdown bullets...", "sources": [...]}
```

Best used for a "TL;DR this chapter" button on the document detail screen.

## 10. Dispute a grade

A student who thinks a grade is unfair flags the answer with a reason. This is the cheapest feedback loop you'll add — every dispute is an eval sample you can later compare against your own judgment to tune the grading prompt.

```bash
# Pick an answer_id from /assessment/submit or /history/{id}
curl -s -X POST "$BASE/answer/<answer_id>/dispute" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"reason":"the rubric required photosynthesis and my answer mentioned it"}'
echo
# → {"disputed": true}
```

After this, the answer's `disputed: true` and `dispute_reason` surface in `/history/{id}`. The grade itself is **not** changed — disputes are a signal channel for the operator, not an automatic re-grade.

## 11. Dashboard

Everything the home screen needs in one call:

```bash
curl -s "$BASE/dashboard" "${AUTH[@]}" | python -m json.tool
```

Fields:
- `name`, `plan`, `trial_ends_at`, `preferred_level`, `tts_enabled` — profile
- `documents_count`, `documents` (each with `status` and `progress`) — file library
- `assessments_taken`, `average_score_percent`, `recent_assessments` — global stats

Safe to call often.

## 12. Per-document progress

The "how am I doing on this book" screen:

```bash
curl -s "$BASE/documents/$DOC/progress" "${AUTH[@]}" | python -m json.tool
```

```json
{
  "document_id": "...",
  "title": "Houseplant Problems.pdf",
  "topics_total": 33,
  "topics_taught": 1,
  "assessments_taken": 1,
  "average_score_percent": 0,
  "flashcards_in_library": 5,
  "flashcards_mastered": 0
}
```

`flashcards_mastered` uses Anki's standard "mature card" definition: `repetitions >= 3 AND interval_days >= 21`. Build three progress bars from this: topics taught / topics_total, average_score_percent / 100, flashcards_mastered / flashcards_in_library.

## 13. Settings

```bash
curl -s -X POST "$BASE/settings" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"preferred_level":"amateur","tts_enabled":true}'
echo
```

PATCH semantics — only the fields you send. `preferred_level` becomes the default the app passes when starting a new lesson or test. `tts_enabled` is read by the Expo app to gate the read-aloud button.

## 14. Plan and access

Public plans list (no auth):

```bash
curl -s "$BASE/plans" | python -m json.tool
```

The signed-in user's state:

```bash
curl -s "$BASE/me/access" "${AUTH[@]}" | python -m json.tool
```

Use to drive the upgrade prompt — "12 / 200 questions used this month", "trial ends in 2 days" banners, etc.

## 15. The 402 gate

Endpoints that consume Claude return **HTTP 402 Payment Required** when the user's trial is over, subscription has lapsed, or they've hit a monthly cap:

- `/upload` (kind: document)
- `/ask` (kind: question)
- `/lesson/next` (kind: question)
- `/assessment/create` (kind: assessment)
- `/revision/practice` (kind: assessment)
- `/flashcards/generate` (kind: assessment)
- `/documents/{id}/summarize` (kind: question)

Response:

```json
HTTP/1.1 402 Payment Required
{"detail":"You have used your 200 questions for this month."}
```

Or:

```json
{"detail":"Your access has ended. Choose a plan to continue."}
```

Treat 402 as "show the upgrade screen". To upgrade a user manually until Paystack lands:

```bash
uv run python -m scripts.set_plan email@example.com pro --days 365
```

## 16. Account deletion (right to erasure)

```bash
curl -s -X DELETE "$BASE/me/account" "${AUTH[@]}"
echo
# → {"deleted": true}
```

Irreversible. Removes the user's storage files, all owned DB rows (via FK cascades), and the `auth.users` row. The JWT is invalidated as soon as the auth user is gone. Frontend must confirm intent in a modal and clear local state on success.

## Common errors

| Status | Meaning |
|---|---|
| 401 "Not authenticated" | No Authorization header sent. |
| 401 "Not logged in" | JWT expired, malformed, or for the wrong project. Re-mint via `scripts.get_token`. |
| 402 | Trial expired, subscription lapsed, or monthly cap hit. See §14. |
| 404 "Not found" / "document not found" / "session not found" / "assessment not found" / "flashcard not found" / "answer not found" | Either the entity doesn't exist or it doesn't belong to the caller. Backend deliberately doesn't distinguish the two — both leak less. |
| 410 Gone | Assessment auto-submitted because the timer expired during `/answer/save` or `/answer/save-photo`. Body includes the graded results. |
| 422 "Field required" | A body field is missing or has the wrong type. The `loc` in the error tells you which. |
| 500 | A real bug. Capture and report. With Sentry wired, the traceback is already in your error tracker. |

## The order a new student lives through

The product flow that the frontend should walk a first-time user through:

1. **Sign up + confirm email** (frontend, via Supabase). Show "Check your inbox" after submit.
2. **Forgot password?** (frontend, `supabase.auth.resetPasswordForEmail`). Wire this on day one.
3. **Upload a document** (`/upload`). Empty-state on the home screen says "Upload your first chapter to start." Poll `documents.progress` for a real progress bar.
4. **Pick teach or ask** (`/lesson/start` + `/lesson/next`, or `/session` + `/ask`). Teach mode is the better first experience.
5. **Take a test** (`/assessment/create` → `/start` → `/answer/save` × N → `/submit`). Handle 410 as auto-submit.
6. **See the score and reasoning** (the submit response). Render `sources` under each result.
7. **Revise misses** (`/revision/{doc}/misses`) → **generate a practice test** (`/revision/practice`).
8. **Generate flashcards** (`/flashcards/generate`) — surface a "make flashcards" button on the document detail screen. Then daily `/flashcards/due` review sessions.
9. **Exam prep mode** — when the student has a real exam coming up, walk them into the focus-area flow: create a focus area on the topics their teacher gave them (`POST /focus-areas` with `exam_date`), then surface the three big buttons all pre-populated with that `focus_area_id`: "Walk me through these topics" (`/lesson/start`), "Make flashcards" (`/flashcards/generate`), and "Test me" (`/assessment/create`). Show a countdown on the home screen pulled from `exam_date`.
10. **Watch progress** (`/documents/{id}/progress` for one book, `/dashboard` for the overview).
11. **Approaching trial end** (`/me/access` says `trial` with little time left) → upgrade screen built from `/plans`.

That's the loop. Returning students mostly live in steps 4, 5, 7, 8, 9 — most everything else is set-and-forget.
