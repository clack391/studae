# Studae

Study app monorepo. A student uploads PDFs or photos of notes, the backend ingests and embeds the material, and the student can ask questions, get taught topic-by-topic, generate tests and exams, build flashcards, and review past work — all grounded in their own uploads.

## Layout

```
Studae/
├── study-app-backend/   FastAPI + Supabase + Anthropic Claude + Google Gemini
└── study-app-frontend/  Expo React Native (Expo Router)
```

Each side has its own README with deep setup steps:
- Backend: [study-app-backend/README.md](study-app-backend/README.md)
- Frontend: [study-app-frontend/README.md](study-app-frontend/README.md)

This top-level README is the **local dev quick start**. To take Studae beyond your laptop (deploy the backend to the cloud, build an Android APK, ship to the stores), read [LAUNCH.md](LAUNCH.md).

## Prerequisites

- **Node 20+** (Expo SDK 54+ does not support Node 18)
- **Python 3.11+** managed by [`uv`](https://docs.astral.sh/uv/) (install with `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- A free account at each of:
  - **Supabase** (supabase.com): database + auth + storage
  - **Anthropic** (console.anthropic.com): Claude API key
  - **Google AI Studio** (aistudio.google.com): Gemini API key

For Android testing on a real phone you also need **Android SDK platform-tools** for `adb` (or pair via wireless debugging).

## Clone and configure

```bash
git clone https://github.com/clack391/studae.git
cd studae

# Backend env (fill in API keys after copying)
cp study-app-backend/.env.example study-app-backend/.env
$EDITOR study-app-backend/.env

# Frontend env (fill in Supabase URL + anon key after copying)
cp study-app-frontend/.env.example study-app-frontend/.env
$EDITOR study-app-frontend/.env
```

Each `.env.example` file has inline comments explaining where every value comes from. The deeper Supabase setup (storage bucket, SQL schema, RLS policies, seed data) is documented in `study-app-backend/README.md` and `study-app-backend/docs/database.md`.

## Install dependencies

```bash
# Backend
cd study-app-backend && uv sync

# Frontend
cd ../study-app-frontend && npm install
```

## Run (two terminals)

```bash
# Terminal 1: backend
cd study-app-backend
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: frontend
cd study-app-frontend
npx expo start --clear
```

Scan the QR code with Expo Go on your phone, or press `a` for an Android emulator, `i` for iOS sim, or `w` for web.

## Running on a physical Android phone over USB

If the phone can't reach `localhost:8000`, forward both ports through `adb` once the device is connected:

```bash
adb devices
adb reverse tcp:8081 tcp:8081   # Metro
adb reverse tcp:8000 tcp:8000   # backend
```

Then in the frontend `.env`, leave `EXPO_PUBLIC_API_BASE=http://localhost:8000` and Expo Go will reach the backend via the reverse tunnel.

For other targets see the table in [study-app-frontend/README.md](study-app-frontend/README.md).

## Tests

```bash
cd study-app-backend && uv run pytest        # backend tests
cd ../study-app-frontend && npm run typecheck # frontend TypeScript check
```

## Stack

- **Backend**: FastAPI, `uv` for env management, Anthropic SDK, Google `google-genai` SDK, Supabase Python SDK, PyMuPDF for PDF text + image extraction, slowapi for rate limiting.
- **Frontend**: Expo SDK 54, Expo Router, React Native, `@tanstack/react-query`, `@supabase/supabase-js` with AsyncStorage session persistence, `expo-document-picker` and `expo-image-picker` for upload, `react-native-reanimated` for animations.
- **AI**: Claude `claude-sonnet-4-6` is reserved for the three quality-sensitive paths: test/exam question generation, the figure-question text-only fallback, and per-answer grading at submit. Claude `claude-haiku-4-5` (text and vision) drives the bulk of the workload at ~1/3 the cost — lessons, typed and photo /ask, topic and outline summaries, flashcard generation, weak-area revision, document outline build at ingest, source relevance filtering, photo question extraction, topic tagging, and vision-verifying that test figures match their questions and don't leak the answer. Gemini `gemini-2.5-flash-lite` for ingestion OCR and for vision-detecting diagram regions on OCR'd PDF pages; `gemini-2.5-flash` for handwriting photo OCR; `gemini-embedding-001` for RAG embeddings. Every Claude / Gemini call is wrapped by the `track_claude` / `track_gemini` helpers in `app/clients.py`, which log token counts and dollar cost to the backend logger and append a JSON line to `study-app-backend/data/usage.jsonl` for offline analysis (`python -m scripts.usage_total today|week|month|all`).
- **Data**: Supabase Postgres with `pgvector`. Auth + storage in the same Supabase project.

## License

See [LICENSE](LICENSE). Copyright (c) 2026 Precious Onotu and Praise Enato. Proprietary; all rights reserved.
