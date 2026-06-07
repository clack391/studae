# study-app-backend

FastAPI backend for a study app. A student uploads learning material (PDFs or images), the backend extracts text, chunks and embeds it, and stores an AI-generated outline. The student then asks questions or gets taught the material in a guided lesson, all grounded in their own uploads.

## Stack

- **FastAPI** + `uvicorn` (Python, managed by `uv`)
- **Supabase** — Postgres + auth + storage + `pgvector`
- **Anthropic** `claude-sonnet-4-6` — outlines, answering, teaching
- **Google Gemini**
  - `gemini-2.5-flash-lite` — OCR for scanned PDFs and photos
  - `gemini-embedding-001` (1536-dim) — chunk and query embeddings

## Setup

You'll need accounts at three services. Free tiers are enough to get the backend running:
- **Supabase** — supabase.com — database, auth, storage.
- **Anthropic** — console.anthropic.com — Claude API key.
- **Google AI Studio** — aistudio.google.com — Gemini API key.

### 1. Supabase

Create a Supabase project. In **Project Settings → API**, copy:
- the project URL (`https://<ref>.supabase.co`)
- the **secret** key (server-side)
- the **publishable** key (client-side)

In **Storage**, create a private bucket called `uploads`.

In **SQL Editor**, paste and run [`docs/schema.sql`](docs/schema.sql). It creates all 13 tables (`users`, `documents`, `chunks`, `chat_sessions`, `messages`, `assessments`, `questions`, `answers`, `plans`, `usage`, `flashcards`, `flashcard_reviews`, `focus_areas`) with their RLS policies, the `handle_new_user` trigger, the `match_chunks` pgvector RPC, the storage policies on the `uploads` bucket, and three seeded rows in `plans` (basic, standard, pro). Safe to re-run. See [`docs/database.md`](docs/database.md) for column-by-column rationale.

### 2. Env vars

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

Then open `.env` and replace each `replace_me` / placeholder with the keys from the three services (`.env.example` has comments explaining where each one comes from). `.env` is gitignored; `.env.example` is the template that stays in the repo.

The required keys are `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`. `LOG_LEVEL` and `ALLOWED_ORIGINS` are optional with sensible defaults.

`SUPABASE_JWT_SECRET` is **strongly recommended**. When set, `auth.py` verifies the user's access token locally on every request (microseconds, no network) instead of calling `supabase.auth.get_user`, which is a network round-trip to the Supabase Auth API (~100–300ms per request). Grab the value from Supabase dashboard → Project Settings → API → JWT Settings → JWT Secret (the long base64-ish string, **not** the anon or service-role keys). Without it, the backend still works but every endpoint is noticeably slower because each request pays the network-auth tax.

Newer Supabase projects sign JWTs with **ES256/RS256** (asymmetric) instead of HS256. `auth.py` detects the token's `alg` header and uses the right path: HS256 falls back to `SUPABASE_JWT_SECRET`, ES256/RS256 fetches the project's public keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` via `PyJWKClient` and verifies locally. The JWKS keys are cached in-process and refreshed automatically when Supabase rotates them (keys are looked up by `kid`). First request after a backend restart pays one ~200-500ms JWKS fetch; every subsequent request is local. `SUPABASE_URL` is required for the JWKS path to work.

### 3. Install

Install `uv` if you don't have it:

```bash
# Linux / macOS (official installer)
curl -LsSf https://astral.sh/uv/install.sh | sh

# alternatively, if you already have pipx
pipx install uv

# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

`uv` ends up at `~/.local/bin/uv` — make sure that's on your `PATH` (the installer prints the line to add to your shell rc if it isn't).

Then from the project root:

```bash
uv sync
```

That reads `pyproject.toml` + `uv.lock` and creates a `.venv/` with the exact pinned versions of every dependency. No extra `pip install` step needed.

**Python version:** the project runs on Python 3.9+, but Google's `google-auth` library warns that 3.9 is past EOL on every import. Recommended:

```bash
uv python install 3.12
uv venv --python 3.12 --allow-existing
uv sync
```

`uv python install` will download a Python 3.12 build into uv's managed store — you don't need a system Python at all.

## Running

```bash
uv run uvicorn app.main:app --reload
```

Server runs at `http://localhost:8000`. OpenAPI docs at `/docs`.

### Production

Never expose `uvicorn --reload` to the internet — it's a single-worker dev server. For real users:

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Or use gunicorn with uvicorn workers if your host prefers it. Deploy to a real platform that handles TLS for you (Fly.io, Render, Railway, or a VPS with a reverse proxy). **Always put Cloudflare or your host's equivalent in front for DDoS protection** — the built-in `slowapi` rate limiting caps abusive bursts, but a sustained DDoS attack needs network-edge defense, not app-level.

Production env vars to set:
- `ALLOWED_ORIGINS=https://your-frontend-domain.com`
- `LOG_LEVEL=INFO`
- `SENTRY_DSN=https://...` — once you've created a Sentry project. Errors then flow to your dashboard with traceback + request + user context.
- `RATE_LIMIT_DEFAULT=100/minute` — adjust to your traffic profile. Heavy AI endpoints have stricter built-in limits (`/assessment/create`, `/flashcards/generate`, `/revision/practice` at 10/min; `/documents/{id}/summarize` at 20/min; `/upload` at 10/min; photo endpoints at 30/min).

After deploying, configure **Sentry alerts** in the Sentry dashboard for: any new exception, error rate spikes, and slow requests (>10s). Five clicks, zero code.

### Verify it works

In another terminal, mint a token for a confirmed Supabase test user, upload a PDF, and watch ingestion run to `ready`:

```bash
TOKEN=$(uv run python -m scripts.get_token test@example.com password123)

DOC=$(curl -s -X POST http://localhost:8000/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/some.pdf" \
  | python -c "import sys,json;print(json.load(sys.stdin)['document_id'])")

# poll until status is "ready"
uv run python -m scripts.check_status $DOC
```

When `status: ready` and `chunks > 0`, the pipeline is healthy. From there, hit `/session` + `/ask` or `/lesson/start` + `/lesson/next` to exercise the rest.

## API

All endpoints require `Authorization: Bearer <supabase-jwt>` except `/plans` (public pricing) and `/healthz` (host health check). Use `get_token.py` to mint one for a test user.

Endpoints that consume Claude or count against plan limits — `/upload`, `/ask`, `/lesson/next`, `/assessment/create`, `/revision/practice` — return **HTTP 402** when the user's trial has expired, their subscription has lapsed, or they've hit their monthly cap.

| Method | Path | Purpose |
|---|---|---|
| GET  | `/healthz` | Liveness check for the host. Always returns `{"ok": true}` if the process is up. |
| POST | `/upload` | Upload a PDF/image. Returns a `document_id`. Ingestion runs in the background. |
| POST | `/session` | Create an ask-mode chat session for a document. |
| GET  | `/sessions` | List the caller's chat sessions, optionally filtered by `?document_id=`. Newest first. |
| GET  | `/sessions/{id}/messages` | Read every message in a session (lesson or chat transcript). Oldest first. |
| POST | `/ask` | Ask a question inside a session. Answer is grounded in the document. |
| POST | `/ask-photo` | Upload a problem photo + question, get an explanation. |
| POST | `/lesson/start` | Start a teach-mode session. |
| POST | `/lesson/next` | Teach the next topic from the document's outline. |
| GET  | `/assessment/estimate` | Time hint + per-format question-count default before creating a test. |
| POST | `/assessment/create` | Generate a test/exam (questions + rubrics) from the document. |
| POST | `/assessment/start` | Begin the test. Returns questions with answers/rubrics stripped, plus `seconds_left`. |
| GET  | `/assessment/{id}/time` | Server-authoritative countdown. |
| POST | `/answer/save` | Autosave a text answer. |
| POST | `/answer/save-photo` | Autosave a photo answer; returns Gemini's `read_back` of the handwriting. |
| POST | `/assessment/submit` | Grade and return score + per-question reasoning. |
| GET  | `/history` | List the user's submitted assessments. |
| GET  | `/history/{assessment_id}` | Reopen one assessment for review (same shape as `/assessment/submit`). |
| GET  | `/revision/{document_id}/misses` | Questions the user got wrong on a document, with grading reasoning. |
| POST | `/revision/practice` | Generate a fresh practice test, biased toward the user's weak areas. |
| GET  | `/dashboard` | Profile + documents + assessments summary + average score for the home screen. |
| POST | `/settings` | Patch `preferred_level` and/or `tts_enabled` on the user profile. |
| GET  | `/plans` | Public list of active subscription plans, ordered by price. |
| GET  | `/me/access` | The caller's current plan, trial/subscription state, monthly usage, and limits. |
| DELETE | `/me/account` | Erase the caller's account, all owned rows, and all storage files. Irreversible. |
| POST | `/answer/{id}/dispute` | Flag a graded answer as unfair. Stores the reason for review. |
| GET  | `/documents/{id}/progress` | Per-document stats: topics taught vs total, assessments taken, average score. |
| POST | `/flashcards/generate` | Generate N flashcards from a document (Claude call; counts as 1 assessment). |
| GET  | `/flashcards/due` | Cards due for review now, optionally filtered by `?document_id=`. |
| POST | `/flashcards/{id}/review` | Record a 0–5 rating, apply SM-2, return new schedule. |
| GET  | `/documents/{id}/flashcards` | Full card library for a document with resolved `sources`. |
| DELETE | `/flashcards/{id}` | Remove a card. |
| POST | `/documents/{id}/summarize` | Generate a 5–8 bullet summary of either a specific `topic` (with sources) or the whole document outline. Counts as 1 question against the plan cap. |
| POST | `/focus-areas` | Create a focus area (Area of Concentration) — a named list of topics from a document with an optional exam date. |
| GET  | `/focus-areas?document_id=...` | List the user's focus areas for a document. |
| GET  | `/focus-areas/{id}` | Open one focus area. |
| PATCH | `/focus-areas/{id}` | Rename / change topics / change exam date. |
| DELETE | `/focus-areas/{id}` | Remove a focus area. |

## Helper scripts

Invoke with `python -m scripts.<name>` from the project root so the `app` package resolves.

- `scripts.get_token <email> <password>` — sign in as a Supabase user, print the access JWT.
- `scripts.check_status <document_id>` — show ingestion status, chunk count, and outline preview for a document.
- `scripts.eval_grading` — run a small set of hand-graded theory answers through `grade_theory` and flag where Claude disagrees with the human score. Run before launch and after any change to the grading prompt.
- `scripts.set_plan <email> <plan> [--days N]` — change a user's subscription plan and expiry. Use until Paystack is wired up.

## Tests

```bash
uv run python -m tests.smoke_test <email> <password> [document_id]
```

Hits 33 of 40 endpoints sequentially and reports `✓` / `✗` per step. Reuses an existing ready document — does not re-upload. Each run consumes ~3 assessments and ~6 Claude calls. Use a pro-plan account so monthly caps don't bite.

```bash
uv run python -m tests.integration_test
```

Covers the 4 endpoints the smoke test skips (`POST /upload`, `POST /ask-photo`, `POST /answer/save-photo`, `DELETE /me/account`) against a throwaway user created via the Supabase admin API. The user is deleted at the end as the test of the delete endpoint itself, with admin-API fallback cleanup if anything failed earlier. Takes 1–5 minutes depending on PDF size (the upload + ingest wait).

```bash
uv run python -m tests.isolation_test <email> <password>
```

Cross-user IDOR test — creates a fresh second user and verifies they can't read any of the first user's data even when passing the first user's UUIDs. 13 checks.

## Project layout

```
study-app-backend/
├── app/                       # the FastAPI application package
│   ├── __init__.py
│   ├── main.py                # FastAPI app + all HTTP endpoints
│   ├── auth.py                # Supabase JWT → user_id (local HS256 verify, network fallback)
│   ├── clients.py             # Singletons: supabase, claude, gemini
│   ├── ingest.py              # PDF/image → text → chunks → embeddings → outline
│   ├── chat.py                # Retrieval, ask mode, teach mode
│   ├── assess.py              # Question + rubric gen, server-side timer, grading
│   ├── revise.py              # Weak-area lookup, practice-test generation
│   ├── flashcards.py          # Card generation + SM-2 spaced repetition
│   ├── focus.py               # Areas of Concentration — saved topic lists + multi-topic RAG
│   └── billing.py             # Trial/subscription state, plan lookup, usage gate
├── scripts/                   # operational helpers, run with `python -m scripts.<name>`
│   ├── __init__.py
│   ├── get_token.py
│   ├── check_status.py
│   ├── eval_grading.py
│   └── set_plan.py
├── tests/                     # smoke/integration tests, run with `python -m tests.<name>`
│   ├── __init__.py
│   ├── smoke_test.py          # 33 of 40 endpoints, fast, non-destructive
│   ├── integration_test.py    # the other 4 — upload + photos + account deletion
│   └── isolation_test.py      # cross-user IDOR check (13 assertions)
├── docs/                      # build plan, backend audit, end-to-end user flow
│   ├── build-plan.md
│   ├── backend-status.md
│   ├── user-flow.md
│   ├── frontend-integration.md   # Expo / React Native cheatsheet
│   └── database.md               # schema reference: tables, FKs, RLS, indexes, RPCs
├── data/                      # local fixtures (e.g., test PDFs)
├── .env                       # secrets (gitignored)
├── .env.example               # template for new contributors
├── LICENSE                    # All Rights Reserved
├── pyproject.toml
├── uv.lock
└── README.md
```

Inside `app/`, modules use relative imports (`from .clients import supabase`). Scripts use absolute (`from app.clients import supabase`).

## Status

- ✅ **Phase 1** — Upload, extract, chunk, embed, outline.
- ✅ **Phase 2** — Ask mode, photo-problem mode, teach mode with outline walk.
- ✅ **Phase 3** — Assessment generation, server-side timer, autosave, graded submit with rubric-referenced reasoning.
- ✅ **Phase 4** — History, revision (misses + biased practice test), dashboard, settings. TTS is frontend-only.
- ⚠️ **Phase 5** — Plans, trial/subscription state, monthly usage caps, and 402 gating on Claude-consuming endpoints. Paystack/payment verification intentionally not wired up; upgrade the user's `plan` and `subscription_ends_at` directly in the DB until you take real payments.

### Post-launch features (on top of the original plan)

- ✅ **Source transparency** — every AI response includes a `sources` array with `chunk_id`, `page_number`, and a 200-char snippet so the student can verify the answer against the original material.
- ✅ **Auto-submit at timer zero** — `/answer/save*` after expiry triggers grading and returns HTTP 410 with the results. `/assessment/submit` is idempotent.
- ✅ **Grade dispute** — `POST /answer/{id}/dispute` flags an unfair grade with a reason. Quietly accumulates eval samples.
- ✅ **Per-document progress** — `GET /documents/{id}/progress` returns topics taught, assessments, average score, plus flashcard library / mastered counts.
- ✅ **Flashcards with spaced repetition** — full SM-2 implementation across five endpoints. Generation counts as 1 assessment against the plan cap; reviews are free.
- ✅ **Chapter / outline summarize** — `POST /documents/{id}/summarize` with optional `topic` (RAG-backed with sources) or whole-outline (no sources).
- ✅ **Account deletion** — `DELETE /me/account` for GDPR/CCPA/NDPR compliance.
- ✅ **Production hardening** — CORS, `/healthz`, Sentry slot (opt-in via `SENTRY_DSN`), HTTPBearer for Swagger, structured logging, ingestion progress visible to the user.
- ✅ **Cross-user isolation** — every ID-taking endpoint verifies ownership; covered by [tests/isolation_test.py](tests/isolation_test.py).

See [docs/user-flow.md](docs/user-flow.md) for the end-to-end walkthrough every screen of the Expo app will map to.

## Caveats and things to watch

- **Embedding dimension must match everywhere.** `1536` in three places: the `chunks.embedding` column, the `output_dimensionality` in `ingest.embed`, and the `match_chunks` signature. Change one, change all three.
- **Cheap text-extraction path can mislead.** `ingest.extract_text` takes the PyMuPDF path when a PDF has ≥100 chars of selectable text, even if the real content lives in images. Image-heavy PDFs with a thin text overlay will produce very few chunks. Make the heuristic smarter (text-per-page ratio) before relying on scanned/visual material.
- **`outline_points` is a heuristic.** It filters out markdown headers, dedupes, and skips short lines, but it's still rough. If teach mode starts repeating itself or jumping around, this is the first place to look.
- **Server is the source of truth for the assessment timer.** The phone only displays it. Don't accept `seconds_left` from the client.
- **Theory grading can produce inconsistent reasoning vs. score.** Claude sometimes describes 2 rubric points as awarded in `reasoning` but returns `score: 1`. Defenses: tighten the grading prompt ("the score must equal the sum of rubric marks awarded"), or have it return a `[{point, marks}]` list and sum server-side. Re-run `eval_grading.py` whenever you change either.
- **Python 3.9 is past EOL** and `google-auth` warns about it on every import. Upgrade with `uv python install 3.12 && uv venv --python 3.12 --allow-existing && uv sync`.
- **Don't skip Supabase email confirmation.** When adding the test user via the dashboard, check "Auto Confirm User" — otherwise sign-in fails with "Invalid login credentials".
- **`SUPABASE_URL` is the API URL, not the dashboard URL.** It's `https://<ref>.supabase.co`, not `https://supabase.com/dashboard/project/<ref>`.
- **Usage increment is not atomic.** `check_and_count` reads the current count and writes `+1` in two separate calls. Two concurrent requests at the same instant could both slip past the cap. Harmless at small scale; if it matters, move the increment into a Postgres function that does it atomically.
- **The usage counter increments before the Claude call.** A failed generation still costs the user a credit. Acceptable for now; revisit if students complain.
- **Payment verification (Paystack) is intentionally absent.** The plumbing — plan rows, gating, access state — works without it. When you take real money, add a verify endpoint that calls the Paystack API and confirms the paid amount matches `plans.price_cents` before flipping `plan` and `subscription_ends_at`. Prefer webhooks with signature verification over the bare verify endpoint.
