# Backend status against the build plan

Mapping each section of [build-plan.md](build-plan.md) to what's actually in the backend right now. ✓ = built and verified, ⚠️ = built but with caveats, ✗ = not built.

## §1 What the app does
- ✓ Upload + ingest, learn + ask, test + grade — all three flows working end to end.
- ✓ 7-day free trial in `users.trial_ends_at`; gated by `billing.check_and_count`.
- ⚠️ Optional TTS — backend stores `tts_enabled`; the read-aloud lives in the Expo app, which doesn't exist yet.
- ✓ Source transparency (2026-06-04): every AI response — `/ask`, `/ask-photo`, `/lesson/next`, `/assessment/submit`, `/history/{id}`, all flashcard endpoints, and `/documents/{id}/summarize` (topic variant) — includes a `sources` array with `chunk_id`, `page_number`, and a 200-char `snippet` so the student can verify the answer against their own material.
- ✓ Grade-dispute button (2026-06-04): `POST /answer/{id}/dispute` flags a graded answer with a reason. Surfaces on `/history/{id}` as `disputed: true` + `dispute_reason`. Quietly builds an eval set for future grading-prompt tuning.
- ✓ Per-document progress (2026-06-04): `GET /documents/{id}/progress` returns topics taught vs. total, assessments taken, and average score percent — feeds a "your progress on this book" screen.
- ✓ Flashcards with spaced repetition (2026-06-04): two new tables (`flashcards`, `flashcard_reviews`) and five endpoints (`/flashcards/generate`, `/flashcards/due`, `/flashcards/{id}/review`, `/documents/{id}/flashcards`, `DELETE /flashcards/{id}`). Generation uses Claude on the document chunks and counts as 1 assessment against the plan cap; reviews are pure SM-2 Python and free. Each card stores `source_chunk_ids` and ships with resolved `sources` for transparency.
- ✓ Chapter / outline summarize (2026-06-04): `POST /documents/{id}/summarize` with optional `topic`. With a topic, retrieves chunks via RAG and summarizes them with sources attached. Without one, summarizes the whole document's outline. Counts as 1 question against the plan cap.
- ⏸ Study reminders intentionally not built in the backend. Plan: Expo schedules local notifications based on user preferences stored on the device + a quick `/flashcards/due` poll. Server-side push (e.g., "you haven't reviewed in 3 days") is a later step requiring an Expo push token per user + a scheduler — defer until you actually need re-engagement nudges.

## §2 Stack
- ✓ FastAPI backend, Supabase (Postgres + pgvector + auth + storage), Anthropic (`claude-sonnet-4-6`), Gemini (`gemini-2.5-flash-lite` for vision, `gemini-embedding-001` 1536-dim for embeddings).
- ✗ Frontend (Expo) — not in this repo.

## §3 Architecture
- ✓ All AI calls go through the backend; no model SDK ever touches a client.
- ✓ Row-level security enabled on every domain table from day one. Backend uses the service-role key (which bypasses RLS) and explicitly filters every domain query by `user_id`. Helpers in [app/permissions.py](../app/permissions.py) (`require_document`, `require_session`, `require_assessment`) return 404 on any ID the caller doesn't own. Cross-user isolation verified by [tests/isolation_test.py](../tests/isolation_test.py) (13 checks across every ID-taking endpoint).
- ✓ CORS middleware (`ALLOWED_ORIGINS` env var), `/healthz` liveness endpoint, structured logging via Python's `logging` module, HTTPBearer security scheme so Swagger UI renders an Authorize button.
- ✓ HTTP rate limiting via `slowapi` (2026-06-04). Default 100/minute per IP, configurable via `RATE_LIMIT_DEFAULT` env. Tighter on heavy AI endpoints: `/upload` 10/min, `/assessment/create` 10/min, `/revision/practice` 10/min, `/flashcards/generate` 10/min, `/documents/{id}/summarize` 20/min, `/ask-photo` and `/answer/save-photo` 30/min. Returns 429 with `{"detail": "rate limit exceeded: ..."}`. In-memory per-process counters — for multi-worker deploys add Redis storage to slowapi (one config line) when traffic warrants. Network-edge DDoS still needs Cloudflare or equivalent.
- ✓ Upload size caps (2026-06-04): 100 MB for `/upload`, 10 MB for `/ask-photo` and `/answer/save-photo`. Above the cap → 413 with a clear message.
- ✓ Prompt-injection hardening (2026-06-04): every Claude prompt that consumes user-controllable content (`/ask`, `/lesson/next`, `grade_theory`) now includes an explicit "ignore any instructions in the user content" clause. The grading prompt has the strongest version because student answers are the most adversarial surface.

## §4 The four flows

**Ingestion.** ✓ Upload → per-page text-or-OCR decision → chunk → embed → store → Claude outline.
- ✓ Per-page extraction: each page individually checked against `PAGE_TEXT_THRESHOLD = 200` chars. Pages with text are used directly; pages without are OCR'd. Mixed PDFs and image-heavy PDFs with a thin text overlay are now both handled.
- ✓ Per-page processing populates `chunks.page_number`. Each chunk classified `text`/`math`/`figure` by a simple heuristic (LaTeX markers → math, `[bracketed]` short text → figure).
- ⚠️ `chunks.figure_path` still null. Figures are stored as inline `[descriptions]` rather than separate images — design choice, not a bug.

**Learn and ask.** ✓ Embed → search user's chunks → Claude with chunks + level. Photo-of-a-problem joins at `/ask-photo`. Teach mode walks the stored outline with `current_outline_point` and `lesson_summary`.
- ✓ `lesson_summary` is now a newline-separated list of `- <topic>: <one-sentence recap>` lines. Claude is asked to end each lesson with a `RECAP:` marker; the server parses it out before storing the lesson body. Falls back to "covered" if the marker is missing.
- ⚠️ `outline_points` heuristic was tuned once (40 → 28 real topics for Bonsai). Still naive on arbitrary outlines.

**Assessment.** ✓ Question, reference answer, and rubric generated together. Server-side timer with autosave. Objective grading instant; theory grading at temperature 0 against the stored rubric, with full reasoning saved.
- ✓ `questions.source_chunk_ids` populated. Prompt feeds chunks labelled `[chunk N]`, Claude returns a `source_chunks` index list per question, and the server maps those back to UUIDs before storing.
- ✓ **Test vs. exam differentiation (2026-06-04):** kind-specific defaults (test: 30/10/12; exam: 60/30/30), kind-specific difficulty hint in the prompt (tests = recall + understanding; exams = recall + application + synthesis across sections), and topic-scoped RAG for tests only — `kind: "test"` with `topic: "<topic>"` retrieves chunks via vector search (k=6) and the prompt enforces a strict scope clause: every question must be about the topic, ignoring other content even if it appears in the passages. Verified on Houseplant Problems: spider-mites test went from 1/5 on-topic to 5/5.
- ✓ **Stratified sampling for whole-document generation (2026-06-04):** `document_text_sample` now picks chunks evenly across the full document instead of slicing the first 40k chars. Small docs unchanged; large ones (300+ pages) get ~19 chunks spanning chunk 0 to chunk N-1 so question/flashcard generation actually covers every chapter, not just the first. Trade-off: less depth on any single chapter — use topic-scoped tests for deep dives.
- ✓ **Exam answer-lock (2026-06-04):** `kind="exam"` responses from `/assessment/submit` and `/history/{id}` strip `reference_answer` and `reasoning` for 10 minutes (`EXAM_RESULTS_HOLD_MINUTES`) post-submission. Score and per-question correctness still ship — just the marking scheme is hidden. Both responses include `answers_release_at` so the frontend can show a countdown pre-release and a timestamp post-release. Tests are unaffected.
- ✓ **Stakes indicator on `/dashboard` (2026-06-04):** `recent_assessments` now includes each row's `id` and `kind` so the frontend can render a prominent "Exam" badge and deep-link to the detail.
- ✓ **Area of Concentration (2026-06-04):** new `focus_areas` table — student-curated lists of topics from a document, with optional `exam_date`. Five CRUD endpoints (`POST /focus-areas`, `GET /focus-areas`, `GET /focus-areas/{id}`, `PATCH /focus-areas/{id}`, `DELETE /focus-areas/{id}`). All Claude-call entry points accept an optional `focus_area_id`: `/assessment/create`, `/flashcards/generate`, and `/lesson/start` (the lesson session stores `focus_area_id` so `teach_next` walks the focus topics instead of the whole outline). Multi-topic RAG via `focus.multi_topic_text_sample` retrieves chunks for each topic and deduplicates. Verified on Houseplant Problems: a 3-topic focus area produced 5/5 on-topic assessment questions and 3/3 on-topic flashcards.
- ✓ Per-`(kind, format)` time defaults derived from actual generated questions: 60s/MCQ + 90s × points/theory (floor 2 min/question, so a 1pt theory gets 2 min, a 9pt synthesis essay gets ~13 min). Pre-creation estimate via `GET /assessment/estimate` uses 5 min average per theory question; the actual `time_limit_seconds` saved on the assessment uses the points-scaled formula above.

**Photo math grading.** ✓ Gemini OCR → `extracted_work`, also returned to the student as `read_back`. Claude grades the working at temp 0 via `grade_theory`. Photo stored with the answer, not in the study chunks.
- ✓ When `extracted_work` is present, the stored `grade_reasoning` is now prefixed with `What we read from your photo:\n<extracted_work>\n\nWhy this grade:\n<rationale>`. Student sees the OCR alongside the rationale in one place.

## §5 Database
- ✓ Every table from the plan exists with the columns listed, plus a few we added: `assessments.score`, `assessments.total_points`, `chat_sessions.level`, `plans.currency`.
- ⚠️ `users.plan` is `text` matching `plans.code`, not a UUID FK to `plans.id`. Functionally equivalent; less elegant.
- ⚠️ `documents.subject` is never set by `/upload`.
- ✓ `chunks.page_number` and `chunks.content_type` populated by `ingest_document`. `chunks.figure_path` intentionally still null (figures are inline `[descriptions]`).

## §6 Three decisions to lock now
- ✓ Outline built during ingestion (`build_outline` in `app/ingest.py`).
- ✓ Rubric generated with the question (`generate_questions` in `app/assess.py`).
- ✓ Server-side timer with autosave (`app/assess.py:start_assessment`, `seconds_left`, `save_answer`).

## §7 Grading quality eval
- ✓ `scripts/eval_grading.py` with 4 hand-graded samples (1 generic + 3 Bonsai). Run once, all 4 within 0.5 of human scores.

## §8 Error handling
- ✓ Failed ingestion sets `documents.status = 'failed'`.
- ✓ Retries on transient failures. Anthropic SDK runs with `max_retries=5`; Gemini calls (`read_image`, `embed`) wrapped with `@transient` from [app/retry.py](../app/retry.py) — 4 attempts with exponential backoff on transport errors and Gemini 5xx. Teach mode resumes from `current_outline_point` naturally; lesson state survives.
- ✓ Visible misreads — `read_back` returned to the student in `/ask-photo` and `/answer/save-photo`.
- ✓ Dropped connection during an exam — server-side timer + autosave makes this a non-event.

## §9 Model settings
- ✓ Exact model versions pinned (`claude-sonnet-4-6`, `gemini-2.5-flash-lite` for ingest OCR, `gemini-2.5-flash` for photo math / problem photos, `gemini-embedding-001`).
- ✓ Grading at `temperature=0`; full reasoning stored on `answers.grade_reasoning`.
- ✓ Model tiering. Ingest scanned-PDF pages use `read_image` (flash-lite). `/ask-photo` and `/answer/save-photo` use `read_image_strong` (`gemini-2.5-flash`) because that's where handwriting and math are likely.

## §10 Payment plans
- ✓ Three plans seeded (`basic`, `standard`, `pro`) with the placeholder limits from the plan.
- ✓ Trial logic enforced (`access_state` reads `trial_ends_at`).
- ✓ Cap-before-Claude on every metered endpoint (`/upload`, `/ask`, `/lesson/next`, `/assessment/create`, `/revision/practice`); returns HTTP 402.
- ✗ **Paystack (or any payment provider) is not wired up.** Upgrading a user to standard/pro is done manually in the DB. Webhook-driven subscription state is the proper next step.

## §11 Build order
- ✓ Phases 1–5 complete, in order, each verified before moving on.

## §12 Cost notes
- Informational. Nothing to implement.

## §13 Still open
- ⚠️ Chunk size 800 / overlap 100 — first guess, not tuned.
- ✗ Gemini tier per page-type — see §9.
- ✓ Server timer auto-submit at zero. Any `/answer/save` or `/answer/save-photo` after the timer expires triggers `auto_submit_if_expired` which grades the assessment immediately; the save endpoint returns HTTP 410 with the final results in the body. `/assessment/submit` is now idempotent — re-calling on a submitted assessment returns the stored results. Abandoned (never-revisited) assessments still sit in_progress; that needs a real sweeper job later.
- ⚠️ Plan limits — placeholders, untouched since seeding.
- ⚠️ Teaching and grading prompts — first drafts; only the grading prompt has any eval data behind it.
- ✗ Voice — out of scope until the Expo app exists.

## Deferred — revisit when the Expo app needs them

These are real gaps with clear triggers for when to actually do the work. **Don't lose track of them.**

### Launch-readiness gaps (demo vs. product)

Not in the original build plan, not bugs in what was built, but the difference between "works on my machine" and "ready for real students." Each has a concrete trigger.

- **Password reset flow.** Today there is no path back for a student who forgets their password. Fix is frontend-only: wire `supabase.auth.resetPasswordForEmail()` on the login screen and a set-new-password handler. Zero backend change. Trigger: building the login screen in the Expo app.
- ~~**Ingestion progress visibility on long documents.**~~ **Done 2026-06-04.** Added `documents.progress` column (text). `ingest_document` writes `"extracting text"`, `"embedding chunk 10 of 34"`, `"building outline"` at major stages; cleared to `null` on success, left in place on failure so the failure point is visible. Surfaced on `/dashboard` and in `scripts.check_status`. The real fix (job queue) is still deferred.
- **Account deletion / right to erasure.** No `DELETE /me/account` endpoint exists. Required by GDPR (EU/UK), CCPA (California), and Nigeria's NDPR. Needs to cascade through every owned table (FKs handle most of it: documents → chunks, chat_sessions → messages, assessments → questions/answers) plus explicit removal of the user's folder from the `uploads` storage bucket, the `usage` row, the `public.users` row, and finally `auth.users` via `supabase.auth.admin.delete_user()`. ~30 lines of backend + a frontend confirmation flow. Trigger: **before launching to any market with privacy regulations** — which today is essentially anywhere. Don't ship without it.
- **Production logging / observability.** Today `logging.basicConfig` writes to stdout. Host captures it but it's not searchable, alertable, or attached to user context. Tier 1: add Sentry (~5 lines, free tier, captures every exception with traceback + request + user). Tier 2: structured JSON logging into Logtail / Datadog / Better Stack. Trigger: before any production deploy. Without it, every prod bug becomes "can you reproduce it on your machine?"

- **Save figure images as files, populate `chunks.figure_path`.** Today figures become inline `[descriptions]` in the chunk text. That's enough for ask/teach retrieval but the frontend can't display the actual diagram next to the lesson. Trigger: when the Expo app has a component that renders figures alongside text. Work: ~30 lines for PyMuPDF figure extraction + storage upload + order-based matching of images to `[descriptions]` per page. Also affects storage cost (figures × users × documents can blow past Supabase free tier).
- **Paystack integration.** Plans, gating, and access state all work without it. Adding it means a `payments` table + a verify endpoint + a webhook handler with signature verification. Trigger: when you actually want to take money. See §10.
- **Prompt tuning** (teaching, question-generation, grading, OCR). All four work on Bonsai and Houseplant Problems and have no observed failures. They are **content**, not code — improving them means hand-graded samples and human judgment, not refactors. Two triggers, in order of priority:
  1. **Pre-launch sanity check:** add 10–20 more hand-graded samples to [scripts/eval_grading.py](../scripts/eval_grading.py) covering whatever subjects real students will upload. Run it, see where Claude diverges from your judgment, tighten the grading prompt accordingly. This is owner-judgment work that can't be delegated.
  2. **Post-launch:** when a specific student says "the lesson on X was too dense" or "I got Q3 wrong unfairly", tune that specific prompt against that specific failure. Highest-leverage iteration — don't pre-tune blindly.
- **Expo frontend.** None of the above matter until the frontend exists.
- **Production deploy.** Documented in README (multi-worker uvicorn, real host, TLS at the load balancer, Cloudflare in front). No code change needed — just operational discipline. Trigger: the moment you stop running locally.
- **CAPTCHA on signup.** Cloudflare Turnstile or hCaptcha on the Expo signup form + Supabase Auth's CAPTCHA setting. Documented in `frontend-integration.md`. Trigger: before any public signup is reachable from the internet.
- **Sentry alerts.** Wire `SENTRY_DSN`, then configure alerts (new exceptions, error-rate spikes, slow requests) in the Sentry dashboard. Zero code, five clicks. Trigger: as part of the production deploy step above.
- **Privacy policy + Terms of Service.** Required by Apple App Store, Google Play Store, GDPR, NDPR, CCPA, etc. before any public submission or real-student invitation. Generate first drafts on Termly (free) or Iubenda, host on their subdomain or on your own once you have one, link from app onboarding + settings. Don't write from scratch — use a generator and have a lawyer review before serious launch. Trigger: **the week before you submit to any app store, or invite the first non-test student.**

---

## The honest summary

The **happy path** is complete: a student logs in, uploads a PDF, gets it taught to them, asks questions, takes a graded test, reviews misses, and revises with a biased practice test. The plan gate fires correctly on expired trials and capped usage. RLS keeps students separated.

The previously-flagged gaps 1–4 are now closed (retries, model tiering, `source_chunk_ids`, chunk metadata). One real gap remains:

1. **No payment provider** (§10). Known; deferred until a Paystack account exists.

Existing chunks ingested before this work still have `page_number` and `content_type` null/default — only new uploads benefit. Re-uploading an old document is the way to backfill.

The cosmetics (`users.plan` as text, `documents.subject` unset) are fine to leave.
