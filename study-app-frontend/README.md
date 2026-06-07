# Studae — Expo frontend

Expo SDK 56 / React Native app built against the FastAPI backend in `../study-app-backend/`. Covers the full study loop: sign in → upload a PDF → watch ingestion → pick a level → get taught → ask follow-ups (text or photo, single or multi-question worksheets) → generate tests and exams → review with photo math grading → review flashcards on a spaced-repetition schedule → track focus areas with exam dates. Plus account / data management, plans, themes, accessibility (larger text), and a premium custom UI for every confirmation (no system Material alerts anywhere).

## Setup

You need **Node 20+** (Expo SDK 56 doesn't support Node 18).

```bash
# If you don't have Node 20 yet:
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart the shell, then:
nvm install 20 && nvm use 20

# Install deps (already done on this machine)
cd Studae/study-app-frontend
npm install
cp .env.example .env   # already filled with the test-machine values
```

The `.env` already has `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_API_BASE=http://localhost:8000`.

Adjust `EXPO_PUBLIC_API_BASE` per target:

| Target | Value |
|---|---|
| Web / iOS sim | `http://localhost:8000` (default) |
| Android emulator | `http://10.0.2.2:8000` |
| Physical phone | `http://<your-LAN-ip>:8000` (`hostname -I` to find it) |

## Run

```bash
# Backend (separate terminal):
cd ../study-app-backend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend:
cd Studae/study-app-frontend
npm start              # opens Expo dev menu
#   press w → browser
#   press a → Android emulator
#   scan QR with Expo Go (SDK 56)
```

Sign in with the seeded test user `clack391@gmail.com` / `Riverdale391@` (pro plan, no trial caps).

## What works in this skeleton

| Screen | Backend |
|---|---|
| Sign in / sign up / check inbox / reset password | Supabase Auth |
| Home (greeting + document list + upload) | `GET /dashboard` |
| Library list | `GET /dashboard` |
| Document detail (outline + resume card) | `GET /documents/{id}`, `GET /sessions` |
| Upload (PDF / camera / library) | `POST /upload` |
| Ingest polling (every 2s until ready) | `GET /documents/{id}` |
| Pick lesson level | `GET /dashboard` (default), local pick |
| Teach mode | `POST /lesson/start`, `POST /lesson/next` |
| Me (profile + usage + level + TTS) | `GET /me/access`, `GET /dashboard`, `POST /settings` |

## How the API layer is wired

- **`src/lib/types.ts`** — every response shape, copied directly from backend handlers. The previous attempt failed because these were wrong; this time each was verified by the probe (below).
- **`src/lib/api.ts`** — typed wrappers per endpoint, e.g. `api.dashboard()`, `api.lessonNext(sessionId)`. Adds the Supabase JWT, parses 4xx/5xx into `ApiError(status, detail)`, handles multipart upload via FormData.
- **`src/lib/supabase.ts`** — single client, AsyncStorage-backed session, autoRefreshToken on.
- **`src/components/AuthProvider.tsx`** — listens to `onAuthStateChange`; root layout routes between `(auth)` and `(app)` groups.

## Verifying backend shapes

Before any screen consumed the lib, every read-only endpoint was probed:

```bash
node scripts/probe-backend.mjs <email> <password>
```

That script signs in via Supabase's REST auth (no JS client needed), hits each endpoint, and asserts every required top-level key exists. **All 18 endpoint shapes pass against the live backend.** Re-run it any time the backend changes — cheap canary for type drift.

```
Public:    /healthz, /plans
Profile:   /dashboard, /me/access, /history
Doc:       /documents/{id}, /documents/{id}/progress
Sessions:  /sessions, /sessions/{id}/messages
Lists:     /focus-areas, /flashcards/due, /documents/{id}/flashcards
Misses:    /revision/{doc}/misses
Estimate:  /assessment/estimate
CRUD:      POST + GET + PATCH + DELETE on /focus-areas
```

The write-side (Claude-consuming) endpoints aren't probed — costs money — and are already covered by `../study-app-backend/tests/smoke_test.py`.

## File layout

```
src/
  app/
    _layout.tsx              # root: fonts, QueryClient, AuthProvider, route gate
    index.tsx                # redirect to /(auth) or /(app)
    (auth)/                  # sign-in, sign-up, check-inbox, reset-password
    (app)/                   # tab shell: home / library / me
      _layout.tsx
      home.tsx
      library/{_layout, index, [id]}.tsx
      me/{_layout, index}.tsx
    upload.tsx
    ingest/[id].tsx
    learn/{level, teach}.tsx
  components/
    AuthProvider.tsx
    ui/                      # T, Button, Card+Row+Col+Divider, Field, AppBar, Screen, Bar, Stat, Badge
    domain/                  # DocThumb
  lib/                       # types, api, supabase, theme, format
scripts/
  probe-backend.mjs          # endpoint shape verifier
.env / .env.example
```

## Style choices (hybrid fidelity)

- Caveat / Kalam handwriting for screen titles and hero numbers only — not body.
- Paper background, dashed dividers, sketch-style buttons stay.
- Body / inputs / chat use the system font for readability.

Theme tokens are in `src/lib/theme.ts` and mirror the wireframe's `wf/styles.css`.

## Typecheck

```bash
./node_modules/.bin/tsc --noEmit
```

Currently clean. `strict: true` is on from the template.
