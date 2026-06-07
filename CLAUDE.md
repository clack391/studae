# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Monorepo with two independent apps that talk over HTTP:

- `study-app-backend/` — FastAPI + Supabase + Anthropic Claude + Google Gemini. Python, managed by `uv`.
- `study-app-frontend/` — Expo (React Native) app on Expo Router. Node 20+.

The frontend has its own `CLAUDE.md`/`AGENTS.md` with a critical rule: **Expo changes between versions — read the exact versioned docs (https://docs.expo.dev/versions/) before writing Expo code.** (Note: `package.json` pins `expo ^54` while the README/AGENTS text references SDK 56 — verify the installed version with `npx expo --version` rather than trusting the prose.)

## Commands

Backend (run from `study-app-backend/`):
```bash
uv sync                                                          # install deps
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000  # dev server
uv run pytest                                                     # all tests
uv run pytest tests/smoke_test.py                                # one test file
uv run python -m tests.smoke_test <email> <password> [doc_id]   # live end-to-end smoke (hits real backend)
uv run ruff check                                                # lint
python -m scripts.usage_total today|week|month|all              # sum LLM token cost from data/usage.jsonl
python -m scripts.set_plan <email> <plan> [--days N]            # set a user's subscription plan
uv run python eval_grading.py                                   # eval Claude grading vs hand marks
```

Frontend (run from `study-app-frontend/`):
```bash
npm install
npm start                          # Expo dev menu (w=web, a=android, scan QR=Expo Go)
npx tsc --noEmit                   # TypeScript check (the project's real "test")
npm run lint                       # expo lint
node scripts/probe-backend.mjs <email> <password>   # assert backend response shapes match types.ts (cheap type-drift canary)
```

Physical Android over USB needs port forwarding so `localhost:8000` resolves:
```bash
adb reverse tcp:8081 tcp:8081   # Metro
adb reverse tcp:8000 tcp:8000   # backend
```

## Backend architecture

`app/main.py` is the single FastAPI app — all ~40 routes live here, delegating into feature modules: `chat.py` (ask/lesson/teach + RAG), `assess.py` (test/exam generation, grading, exam answer-hold), `ingest.py` (PDF/photo → text + figures + embeddings), `ingest.embed`/`read_image` (Gemini), `flashcards.py`, `revise.py`, `focus.py`, `billing.py`, `auth.py`, `permissions.py`.

Key cross-cutting invariants — violate these and things break subtly:

- **All LLM calls go through `track_claude` / `track_gemini` / `track_gemini_embed` in `clients.py`**, never the raw SDK. The wrappers log token counts + dollar cost and append to `data/usage.jsonl`. Pricing table lives in `clients.py._PRICING`.
- **Every prompt producing user-facing natural language appends `STYLE_RULES`** (from `clients.py`) — chiefly: never emit em dashes. The user flagged em dashes as an AI tell.
- **Model tiering is deliberate.** `claude-sonnet-4-6` is reserved for three quality-sensitive paths only: test/exam question generation, the figure-question text-only fallback, and per-answer grading at submit. Everything else runs `claude-haiku-4-5` (~1/3 cost). Code comments mark each Haiku site with "flip back to claude-sonnet-4-6 if quality dips" — keep that convention. Ingest OCR uses `gemini-2.5-flash-lite` (typed/printed) and `gemini-2.5-flash` (handwriting); embeddings use `gemini-embedding-001`.
- **The backend uses the Supabase service-role key, which bypasses Row Level Security.** Therefore *every* endpoint taking an entity ID MUST call the matching `require_*` helper in `permissions.py` (which filters by `user_id` and 404s on a miss). Skipping this is an IDOR vulnerability. Do not rely on RLS for tenant isolation.
- **Prompts that consume user/document content append `ANTI_INJECTION`** (treat embedded text as data, not instructions) and, where chunk text is shown to the student, `FIGURE_NOTE` (so Claude doesn't claim OCR `[bracketed]` figure captions are missing images).
- **`clients.py` monkeypatches `httpx.Client` to force HTTP/1.1** because supabase-py's shared HTTP/2 connection isn't thread-safe under FastAPI's threadpool fan-out. Don't undo this.
- **Auth is local JWT verification** (`auth.py`): supports HS256 (via `SUPABASE_JWT_SECRET`) and ES256/RS256 (via cached JWKS), falling back to the slow `supabase.auth.get_user` network call only on failure.
- Gemini has no built-in retry — wrap its calls with `@transient` from `retry.py` (Anthropic SDK retries itself via `max_retries=5`).
- `main.py` imports submodules *after* `load_dotenv()` on purpose (`clients.py` reads `os.environ` at import time) — hence the `E402` ruff ignore. Keep that ordering.

Data model is Supabase Postgres with `pgvector`. Schema + RLS lives in `docs/schema.sql`; deeper docs in `docs/database.md`, `docs/user-flow.md`, `docs/build-plan.md`. Core tables: `users`, `documents`, `chunks` (embeddings), `chat_sessions`, `messages`, `assessments`, `questions`, `answers`, `focus_areas`, `flashcards`, `flashcard_reviews`, `plans`, `usage`.

## Frontend architecture

Expo Router file-based routing under `src/app/`. `tsconfig` aliases `@/*` → `src/*`.

- `src/app/_layout.tsx` is the root: loads fonts, wraps in `ThemeProvider` → `SafeAreaProvider` → `QueryClientProvider` → `AuthProvider`, and `RouteGate` redirects between the `(auth)` and `(app)` route groups based on session (plus a password-recovery path).
- `src/lib/api.ts` — typed wrapper per backend endpoint; injects the live Supabase JWT, parses errors into `ApiError(status, detail)`, handles multipart upload. `src/lib/types.ts` mirrors backend response shapes exactly — when a backend handler's response changes, update `types.ts` and re-run `scripts/probe-backend.mjs`.
- `src/lib/supabase.ts` — single client, AsyncStorage session, autoRefreshToken on. `src/lib/theme.ts` — light/dark palettes via `useTheme()`; tokens originate from the design wireframe.
- Data fetching is `@tanstack/react-query` (60s `staleTime`, 15min `gcTime`); writes invalidate keys directly.
- UI primitives in `src/components/ui/` (e.g. `T`, `Button`, `Card`, `Screen`, `ConfirmSheet`). All confirmations use the custom `ConfirmSheet` — no system Material alerts anywhere.

## Environment

Both apps need a `.env` (copy from `.env.example`). Backend needs Supabase URL + service/anon/JWT keys, Anthropic key, Gemini key. Frontend uses `EXPO_PUBLIC_*` vars (inlined into the client bundle — never put secrets there) and `EXPO_PUBLIC_API_BASE` (varies by target: `localhost`, `10.0.2.2` for Android emu, or LAN IP for a physical phone).

For deployment (cloud backend, Android APK, store submission) see `LAUNCH.md`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
