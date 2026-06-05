# Launching Studae

This doc takes you from a working local dev setup to an installable Android APK pointing at a real cloud backend, then onward to App Store and Play Store. The local quick start lives in [README.md](README.md); read that first.

## What you are shipping

- One **React Native app** built from `study-app-frontend/` that runs on both iOS and Android, no Swift or Kotlin needed.
- One **FastAPI backend** in `study-app-backend/` hosted in the cloud, reachable over HTTPS.
- One **Supabase project** providing the database, auth, and storage. The same project is used by both the frontend (anon key) and the backend (service key).

The frontend builds for both phones from the same TypeScript codebase, signed and packaged by Expo Application Services (EAS).

## Cost overview

The cheapest path to "an APK on my phone that talks to a live backend" is $0:

| Step | Free | When you pay |
|---|---|---|
| EAS Build (Expo cloud) | 30 builds / month | $19+/month if you need more or faster queue |
| Fly.io host for backend | ~3 small VMs | A few dollars / month if you outgrow it |
| Anthropic API | $5 credit on signup | Per-call after credit |
| Google Gemini API | Daily free quota | Per-call past quota |
| Supabase | Generous free tier | $25/month when you outgrow it |
| Local Android build (`expo run:android`) | Always | Just needs Android Studio installed locally |
| Google Play Console (publish to Store) | No | $25 one-time |
| Apple Developer Program (publish to Store) | No | $99 / year |

Everything in this guide stays free until you choose to list on the Stores.

## Prerequisites

- Node 20+ and npm
- Python 3.11+ and `uv` (backend)
- A free account at: Supabase, Anthropic, Google AI Studio
- For Android build via cloud: a free Expo account (sign up at expo.dev)
- For Android build locally: Android Studio with the SDK
- For real Android device testing: USB debugging on the phone, or wireless debugging paired

You do NOT need an Apple Developer account, a Google Play Console account, or a Mac to ship an installable Android APK.

## Part 1: Deploy the backend to Fly.io

Fly.io gives you a stable HTTPS URL like `studae-api.fly.dev` and a generous free tier suited to a FastAPI app with occasional AI calls.

### 1.1 Install the Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
fly auth signup     # creates an account, browser flow
```

### 1.2 Create a Dockerfile in the backend

Inside `study-app-backend/`, create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

ENV UV_SYSTEM_PYTHON=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 1.3 Initialise the Fly app

```bash
cd study-app-backend
fly launch --no-deploy --copy-config --name studae-api --region jnb
```

Pick `jnb` (Johannesburg), `lhr` (London), or `iad` (Virginia) depending on where your users are. This writes a `fly.toml`. Leave its defaults.

### 1.4 Set the secrets

```bash
fly secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  GEMINI_API_KEY=AI... \
  SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_SERVICE_KEY=eyJ... \
  SUPABASE_ANON_KEY=eyJ... \
  SUPABASE_JWT_SECRET=<long-base64-secret>
```

These come from your providers. They get encrypted and injected into the running container, never seen in logs.

`SUPABASE_JWT_SECRET` enables local JWT verification on every request — without it the backend round-trips to Supabase Auth on every tap (~100–300 ms of added latency per request). Grab it from Supabase dashboard → Project Settings → API → JWT Settings → JWT Secret (it is **not** the anon or service-role key).

### 1.5 Deploy

```bash
fly deploy
```

After a couple of minutes, Fly prints your URL, e.g. `https://studae-api.fly.dev`. Sanity check it:

```bash
curl -i https://studae-api.fly.dev/healthz
```

You should get back a 200 with a JSON body. The backend is now public over HTTPS.

## Part 2: Build the Android APK with EAS

### 2.1 Install the EAS CLI

```bash
npm install -g eas-cli
eas login
```

### 2.2 Configure EAS in the frontend

```bash
cd study-app-frontend
eas build:configure
```

This creates `eas.json`. Replace its content with the three-profile layout below:

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_BASE": "http://localhost:8000"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": {
        "EXPO_PUBLIC_API_BASE": "https://studae-api.fly.dev",
        "EXPO_PUBLIC_SUPABASE_URL": "https://<ref>.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJ..."
      }
    },
    "production": {
      "android": { "buildType": "app-bundle" },
      "env": {
        "EXPO_PUBLIC_API_BASE": "https://studae-api.fly.dev",
        "EXPO_PUBLIC_SUPABASE_URL": "https://<ref>.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJ..."
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

Three profiles, three purposes:
- `development`: dev client for Metro hot-reload on a real phone, points at local backend.
- `preview`: APK for free-tier testing. Distribute by direct download link. Talks to your Fly backend.
- `production`: AAB (Android App Bundle) format for Play Store submission.

The `EXPO_PUBLIC_*` values get baked into the JS bundle at build time, so the binary always points at the right backend without runtime configuration.

### 2.3 Run the build

```bash
eas build --profile preview --platform android
```

EAS uploads your source, compiles it in their cloud, signs it, and prints a download URL after about 10 to 20 minutes. The URL serves an `.apk` file.

### 2.4 Install on a phone

On the phone:

1. Open the URL in Chrome.
2. Tap the downloaded `.apk` notification.
3. Android asks to allow installs from this source. Enable it, install, open.

To share with another tester, just send them the same URL via WhatsApp, email, or Drive. No store listing required.

## Part 3: Link the frontend to the backend in production

You already did this through the env vars in `eas.json`. The full picture:

- `EXPO_PUBLIC_API_BASE` points at Fly: every fetch in the app hits the deployed backend.
- `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` connect the app directly to Supabase Auth.
- The backend uses its own `SUPABASE_SERVICE_KEY` (held only on Fly) for privileged DB and storage operations.

The frontend never sees the service key. That separation is what keeps auth secure.

## Part 4: Iterate

Standard cycle:

1. Code change in `study-app-frontend/` or `study-app-backend/`.
2. Backend change: `fly deploy` from `study-app-backend/`. Live in 1 to 2 minutes.
3. Frontend change: `eas build --profile preview --platform android`. New APK URL in 10 to 20 minutes.
4. Reinstall on the phone (older APK installed-over-itself is fine, signed by the same EAS key).

For tighter loops on UI changes, use Expo Go against your local backend. Save EAS builds for testing full builds and for shipping to others.

## Part 5: When you are ready to publish

### 5.1 Google Play Store ($25 one-time)

```bash
eas build --profile production --platform android   # produces .aab
eas submit --platform android                       # uploads to Play Console
```

Google takes a few hours to a day for review. You configure store listing, screenshots, and description in Play Console.

### 5.2 Apple App Store ($99 / year)

Same flow but requires the Apple Developer Program first:

```bash
eas build --profile production --platform ios       # produces .ipa
eas submit --platform ios                           # uploads to App Store Connect
```

Apple review is typically 24 to 48 hours, sometimes longer for first submissions.

### 5.3 Both at once

```bash
eas build --profile production --platform all
eas submit --platform all
```

## Troubleshooting

**Phone says "App not installed" after tapping the APK**
Older signature mismatch. Uninstall the previous version first or use the EAS-issued install link rather than a cached APK file.

**Build fails on EAS with "missing env"**
Make sure every `EXPO_PUBLIC_*` your app reads at startup is set in the relevant profile's `env` block.

**Backend returns 500 after deploy**
`fly logs` will show the traceback. The two most common causes are missing secrets (run `fly secrets list`) and missing dependencies in `pyproject.toml`.

**EAS queue is slow**
Free tier runs one build at a time and queues behind paid users. Off-peak (your night) is faster. Or run `npx expo run:android` to build locally and bypass the queue entirely.

**iPhone won't install your build**
iOS requires a paid Apple Developer account before any iPhone besides your single registered "free developer" device can install your app. Android-first is the standard prototyping path.

## What to read next

- [README.md](README.md): local dev setup (run backend + Expo dev server on your laptop).
- [study-app-backend/README.md](study-app-backend/README.md): full backend reference (endpoints, schema, prompts).
- [study-app-frontend/README.md](study-app-frontend/README.md): full frontend reference (Expo, navigation, components).
- Expo docs: https://docs.expo.dev
- Fly.io docs: https://fly.io/docs
- Supabase docs: https://supabase.com/docs
