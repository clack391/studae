# Frontend integration notes (Expo / React Native)

A cheatsheet for the dev wiring up the Expo app to this backend. Pairs with [user-flow.md](user-flow.md) — that doc tells you *what* every endpoint does; this one tells you *how* a React Native client should call them.

Assumes:
- Expo SDK 51 or later
- React Native 0.74+
- TypeScript

If those don't match, the package names and import paths are stable but minor API details may drift — check the official docs.

## Required packages

```bash
npx expo install @supabase/supabase-js \
                 expo-secure-store \
                 expo-document-picker \
                 expo-image-picker \
                 expo-speech \
                 expo-notifications \
                 react-native-url-polyfill

npm install react-native-markdown-display
```

`react-native-url-polyfill` is needed by the Supabase JS client; import it once at the very top of your entry file (before anything else):

```ts
import 'react-native-url-polyfill/auto';
```

## 1. Auth — sign in, sign up, password reset

Use the Supabase JS SDK with the **publishable** key (the `sb_publishable_...` one). Never put the service-role key in the app.

```ts
// lib/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SecureStoreAdapter = {
  getItem:    (key: string) => SecureStore.getItemAsync(key),
  setItem:    (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: SecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
```

That's it for token refresh — `autoRefreshToken: true` makes the SDK silently rotate the JWT before it expires.

### CAPTCHA on signup (do this before launch)

Bots will mass-create trial accounts and exhaust your Claude/Gemini quota long before any real student arrives. Wire a CAPTCHA on the signup form. Supabase Auth supports it server-side — you just enable it in **Authentication → Settings → Bot and Abuse Protection** and pass a CAPTCHA token from the client.

Recommended: **Cloudflare Turnstile** (free, invisible most of the time, no Google dependency) or **hCaptcha** (similar). Both have React Native wrappers.

```ts
// pseudocode — exact API depends on the chosen widget
const captchaToken = await turnstile.execute();
await supabase.auth.signUp({
  email, password,
  options: { captchaToken, data: { full_name: fullName } },
});
```

### Signup, signin, signout, reset

```ts
// Sign up — full_name is captured into auth.users.raw_user_meta_data,
// which the public.handle_new_user trigger reads into public.users.name.
await supabase.auth.signUp({
  email,
  password,
  options: { data: { full_name: fullName } },
});
// Tell the user: "Check your inbox to confirm your email."

await supabase.auth.signInWithPassword({ email, password });
await supabase.auth.signOut();

// Forgot password — Supabase sends the magic link
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: 'study://reset-password',   // deep link into your app
});

// On the reset-password screen, after they tap the magic link:
await supabase.auth.updateUser({ password: newPassword });
```

## 2. HTTP client — one wrapper, automatic auth, typed errors

Use one wrapper for every backend call. Pulls the current JWT from the Supabase session, parses 401/402/404/410 into a meaningful error class.

```ts
// lib/api.ts
import { supabase } from './supabase';

const BASE = process.env.EXPO_PUBLIC_API_URL!;  // e.g. https://api.yourapp.com

export class ApiError extends Error {
  constructor(public status: number, public detail: any) {
    super(typeof detail === 'string' ? detail : detail?.message || `HTTP ${status}`);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const r = await fetch(`${BASE}${path}`, { ...init, headers });

  if (!r.ok) {
    let detail: any;
    try { detail = (await r.json()).detail; } catch { detail = await r.text(); }
    throw new ApiError(r.status, detail);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

// Convenience helpers
export const apiGet  = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body: any) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const apiDelete = <T>(path: string) =>
  api<T>(path, { method: 'DELETE' });
```

Now every screen calls e.g. `apiPost('/ask', { session_id, document_id, question, level })` and gets typed JSON or an `ApiError`.

## 3. Error handling — what each status means

Catch `ApiError` in your screens and react based on `e.status`:

| Status | What to do |
|---|---|
| **401** | JWT is bad or expired. Sign the user out, send them back to the login screen. |
| **402** | Trial expired or monthly cap hit. Navigate to the Upgrade screen, pre-populated from `/plans`. `e.detail` is a human-readable message you can show. |
| **404** | Entity not found OR not owned. Show "this content is no longer available" — don't say "you don't own this", you'd leak existence. |
| **410** | Test auto-submitted because the timer expired. `e.detail` is `{message, results}` — `e.detail.results` has the exact shape that `/assessment/submit` would have returned (score, total, per-question results with sources, etc.). Render the results screen directly from it. |
| **413** | File too large on `/upload` (100 MB cap), `/ask-photo`, or `/answer/save-photo` (10 MB cap). Show "this file is too big — pick a smaller one." |
| **422** | Bad body / missing field. This means a frontend bug — log and surface to the dev console. |
| **429** | Rate limited (the slowapi middleware). `e.detail` is a message like `"rate limit exceeded: 10 per 1 minute"`. Show a non-blocking toast and disable the button for a minute. |
| **5xx** | Backend bug. Generic "Something went wrong, try again." With Sentry on the backend, you've already got the traceback. |

```ts
try {
  const { answer, sources } = await apiPost('/ask', body);
  setAnswer(answer);
  setSources(sources);
} catch (e) {
  if (e instanceof ApiError) {
    if (e.status === 401) signOut();
    else if (e.status === 402) showUpgrade(e.detail);
    else if (e.status === 410) showResults(e.detail.results);  // for /answer/save during expired test
    else showToast(e.message);
  }
}
```

## 4. File uploads from React Native

The backend takes `multipart/form-data` for three endpoints: `/upload`, `/ask-photo`, `/answer/save-photo`. React Native's `FormData` works but the file shape is different from the web.

### Pick a PDF

```ts
import * as DocumentPicker from 'expo-document-picker';

const result = await DocumentPicker.getDocumentAsync({
  type: 'application/pdf',
  copyToCacheDirectory: true,
});
if (result.canceled) return;
const file = result.assets[0];   // { uri, name, mimeType, size }
```

### Pick a photo (camera or library)

```ts
import * as ImagePicker from 'expo-image-picker';

await ImagePicker.requestCameraPermissionsAsync();
const result = await ImagePicker.launchCameraAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  quality: 0.8,
});
if (result.canceled) return;
const photo = result.assets[0];   // { uri, fileName, mimeType }
```

### Upload it

The RN file object goes into FormData as `{ uri, name, type }`:

```ts
async function uploadDocument(file: { uri: string; name?: string; mimeType?: string }) {
  const form = new FormData();
  // Cast required — React Native's FormData type signature differs from web.
  form.append('file', {
    uri: file.uri,
    name: file.name ?? 'upload.pdf',
    type: file.mimeType ?? 'application/pdf',
  } as any);

  return apiPost<{ document_id: string; status: string }>('/upload', form);
}
```

For `/ask-photo` and `/answer/save-photo` you also append text fields:

```ts
const form = new FormData();
form.append('file', { uri: photo.uri, name: 'work.png', type: 'image/png' } as any);
form.append('assessment_id', assessmentId);
form.append('question_id', questionId);
await apiPost('/answer/save-photo', form);
```

**Don't set Content-Type yourself** — the `api()` wrapper above already skips it for FormData, and `fetch` will fill in the multipart boundary automatically.

## 5. Markdown rendering

Every AI-generated text field (`answer`, `lesson`, `reasoning`, `summary`, `front`, `back`) is markdown. Render with `react-native-markdown-display`:

```tsx
import Markdown from 'react-native-markdown-display';

<Markdown style={markdownStyles}>{message.content}</Markdown>
```

`markdownStyles` is a stylesheet object — set fonts, colors, spacing once and reuse it everywhere.

## 6. Text-to-speech

Use `expo-speech` for the read-aloud button. Strip markdown to plain text first — the speech engine pronounces `**` and `##` literally if you don't.

```ts
import * as Speech from 'expo-speech';

const plainText = (md: string) => md
  .replace(/```[\s\S]*?```/g, '')                // fenced code
  .replace(/`([^`]+)`/g, '$1')                   // inline code
  .replace(/!?\[([^\]]*)]\([^)]+\)/g, '$1')      // links / images
  .replace(/[*_~]/g, '')                         // bold/italic markers
  .replace(/^#{1,6}\s+/gm, '')                   // headings
  .replace(/^[-+*]\s+/gm, '')                    // bullets
  .replace(/^\d+\.\s+/gm, '')                    // numbered list
  .replace(/^>\s?/gm, '')                        // blockquotes
  .replace(/---+/g, '')                          // hrules
  .replace(/\n{3,}/g, '\n\n')                    // collapse blank lines
  .trim();

function speak(md: string) {
  Speech.stop();
  Speech.speak(plainText(md));
}

function stopSpeaking() { Speech.stop(); }
```

Only show the speaker button when the user's profile has `tts_enabled: true` (you get that from `/dashboard` or `/me/access`). Persist changes via `/settings`.

## 7. Sources — rendering them

Every AI response has `sources: [{chunk_id, page_number, snippet, figure_path}]`. `figure_path` is set when the chunk had an embedded diagram extracted from the PDF page (a leaf disease photo, an anatomical figure, etc); render it inline as an image. When the doc is a single-page PDF (HTML-to-PDF export), the backend sends `figure_path: null` on every source because positional figure-to-chunk assignment isn't trustworthy there — render text-only sources for those docs.

Standard rendering: a thin row of tappable cards below the answer.

```tsx
function Sources({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      {sources.map(s => (
        <Pressable
          key={s.chunk_id}
          onPress={() => openSourceModal(s)}
          style={styles.sourceCard}
        >
          <Text style={styles.sourcePage}>
            {s.page_number ? `Page ${s.page_number}` : 'Source'}
          </Text>
          <Text style={styles.sourceSnippet} numberOfLines={2}>
            {s.snippet}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
```

Show this under every answer, lesson, summary, flashcard, and graded question.

### 7a. Rendering figures (`figure_path`) via signed URLs

`figure_path` is a private Supabase Storage path like `<user_id>/<doc_id>/figures/p7_0.png`. The bucket is private, so the path isn't directly fetchable — call `GET /files/signed-url?path=<encoded_path>` to mint a 1-hour signed URL, then pass that URL to `<Image>`. The endpoint validates the path starts with the caller's user_id, so even a guessed path for another user's file returns 403.

```tsx
function Figure({ path, caption }: { path: string; caption?: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ url: string }>(`/files/signed-url?path=${encodeURIComponent(path)}`)
      .then(({ url }) => setUri(url));
  }, [path]);
  if (!uri) return null;
  return (
    <View style={{ marginVertical: 8 }}>
      <Image source={{ uri }} style={{ width: '100%', aspectRatio: 1.6 }} resizeMode="cover" />
      {caption ? <Text style={{ fontSize: 12, marginTop: 4 }}>{caption}</Text> : null}
    </View>
  );
}
```

Reuse the same component for: lessons (figures next to topic text), `/ask` and `/ask-photo` (figures next to answers), test-taking screen (`figure_sources` on each question), test-review screen (`sources[].figure_path`).

### 7b. Persisting sources across screen reloads

Teach lessons and /ask replies have their `sources` arrays persisted on the assistant message in `messages.metadata.sources` (jsonb). `GET /sessions/{id}/messages` returns the `metadata` field on each message, so a transcript view or a resumed /ask chat can render the same figures + page citations without re-running RAG.

```tsx
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string | null;
  metadata?: { sources?: Source[]; topic?: string } | null;
  created_at: string;
};
```

For assistant turns, hydrate `sources` from `m.metadata?.sources` when re-rendering. Older messages (pre-column) have `metadata = null` — fall back to just the text bubble.

## 8. Test, exam, and grading UI patterns

The assessment system has a few distinctive patterns that need specific frontend behavior.

### 8a. Pre-creation time hint

Before the student commits to a test, call `/assessment/estimate` so the "Create test" screen can show "this should take ~50 minutes":

```ts
const hint = await apiGet<{
  kind: string;
  format: string;
  num_questions: number;
  estimated_time_seconds: number;
}>(`/assessment/estimate?kind=${kind}&format=${format}&num_questions=${num}`);

const mins = Math.round(hint.estimated_time_seconds / 60);
showLabel(`This test will take about ${mins} minutes.`);
```

Default `num_questions` if omitted — backend returns the per-`(kind, format)` default (test: 30/10/12, exam: 60/30/30).

### 8b. Test vs exam — visual treatment

`/dashboard.recent_assessments[]` now includes `id` and `kind`. Render exams as more prominent cards than tests, and deep-link to `/history/{id}`:

```tsx
{dashboard.recent_assessments.map(a => (
  <Pressable
    key={a.id}
    onPress={() => navigation.navigate('AssessmentReview', { id: a.id })}
    style={a.kind === 'exam' ? styles.examCard : styles.testRow}
  >
    {a.kind === 'exam' && <Badge>OFFICIAL EXAM</Badge>}
    <Text>{Math.round((a.score / a.total_points) * 100)}%</Text>
    <Text>{new Date(a.submitted_at).toLocaleDateString()}</Text>
  </Pressable>
))}
```

### 8c. Exam answer-lock countdown

For `kind="exam"`, both `/assessment/submit` and `/history/{id}` strip `reference_answer` and `reasoning` for the first 10 minutes and include `answers_release_at`. Score and per-question correctness still ship; only the marking scheme is hidden. Render a countdown until release:

```tsx
function ExamResults({ data }: { data: SubmitResponse }) {
  const releaseAt = data.answers_release_at
    ? new Date(data.answers_release_at)
    : null;
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const locked = releaseAt && now < releaseAt;

  return (
    <View>
      <Text>Score: {data.score} / {data.total}</Text>
      {locked && releaseAt && (
        <Banner>Full results unlock in {formatCountdown(releaseAt.getTime() - now.getTime())}</Banner>
      )}
      {data.results.map(r => (
        <ResultCard key={r.answer_id}>
          <Text>{r.question}</Text>
          <Text>Score: {r.score} / {r.out_of}</Text>
          {!locked && (
            <>
              <Text>Reference: {r.reference_answer}</Text>
              <Markdown>{r.reasoning}</Markdown>
            </>
          )}
        </ResultCard>
      ))}
    </View>
  );
}
```

Tests skip all this — `answers_release_at` is absent and answers ship immediately.

### 8d. Dispute a grade

Below every graded answer, show a small "this seems wrong" button that posts to `/answer/{id}/dispute`. The grade does not change — disputes are a signal channel for the operator.

```ts
async function disputeAnswer(answerId: string, reason: string) {
  await apiPost(`/answer/${answerId}/dispute`, { reason });
  showToast('Thanks — we will review this.');
}
```

`disputed: true` and `dispute_reason` come back on the same answer on subsequent `/history/{id}` calls, so you can show "disputed — under review."

### 8e. Auto-submit at timer zero

When `/answer/save` or `/answer/save-photo` returns **HTTP 410**, `e.detail.results` already has the graded results. Don't re-call `/assessment/submit` — just navigate to the results screen with that payload:

```ts
try {
  await apiPost('/answer/save', { assessment_id, question_id, student_answer });
} catch (e) {
  if (e instanceof ApiError && e.status === 410) {
    navigation.replace('AssessmentReview', { results: e.detail.results });
    return;
  }
  throw e;
}
```

## 9. Focus areas (Area of Concentration)

A focus area is a saved list of topics from a document, named for an upcoming exam. It can scope `/assessment/create`, `/flashcards/generate`, and `/lesson/start` via `focus_area_id` on each. Full backend reference: [user-flow.md §5](user-flow.md).

### Type and CRUD

```ts
type FocusArea = {
  id: string;
  document_id: string;
  name: string;
  topics: string[];
  exam_date: string | null;       // ISO date, e.g. "2026-06-30"
  created_at: string;
};

// Create
const created = await apiPost<FocusArea>('/focus-areas', {
  document_id: docId,
  name: 'Mid-term: pests',
  topics: ['spider mites', 'fungus gnats', 'root rot'],
  exam_date: '2026-06-30',
});

// List for a document
const { focus_areas } = await apiGet<{ focus_areas: FocusArea[] }>(
  `/focus-areas?document_id=${docId}`,
);

// Open one
const fa = await apiGet<FocusArea>(`/focus-areas/${id}`);

// Rename / change topics / change date — PATCH only the fields you send
await api(`/focus-areas/${id}`, {
  method: 'PATCH',
  body: JSON.stringify({ topics: [...fa.topics, 'aphids'] }),
});

// Delete
await apiDelete(`/focus-areas/${id}`);
```

### Use it on a generation endpoint

Once the user has a focus area selected, every relevant action takes a single extra field:

```ts
// Scoped test
await apiPost('/assessment/create', {
  document_id: docId,
  kind: 'test',
  format: 'objective',
  focus_area_id: focusId,
});

// Scoped flashcards
await apiPost('/flashcards/generate', {
  document_id: docId,
  num: 10,
  focus_area_id: focusId,
});

// Scoped lesson — the session stores focus_area_id and teach_next walks only those topics
await apiPost('/lesson/start', {
  document_id: docId,
  level: 'novice',
  focus_area_id: focusId,
});
```

### The "exam prep" screen

The natural Expo screen for this: a "Prepare for exam" home button → focus area editor (name, topics from the outline, exam date) → save → drop the student into a three-button view:

```
[Walk me through these topics]   → /lesson/start  + /lesson/next loop
[Make flashcards]                → /flashcards/generate, then /flashcards/due
[Test me]                        → /assessment/create + /assessment/start
```

All three pre-populated with the `focus_area_id`. On the home screen, show a countdown to `exam_date` to gentle-nudge them back into the loop.

## 10. Polling cadence

| What you're watching | Endpoint | Suggested interval | Stop when |
|---|---|---|---|
| Ingestion finishing | `/dashboard` or `/documents/{id}/progress` | 2 seconds | `status === 'ready'` or `'failed'` |
| Assessment timer | `/assessment/{id}/time` | 1 second (only while screen is focused) | `seconds_left === 0` or student submits |
| Due cards count badge | `/flashcards/due?limit=1` (cheap) | when the home screen mounts, again every 30 min | always-on |

Don't poll on hidden screens. React Navigation has `useFocusEffect` for this.

## 11. Push notifications and study reminders

Local notifications (scheduled on the device, no backend involvement) are enough for v1:

```ts
import * as Notifications from 'expo-notifications';

await Notifications.requestPermissionsAsync();

await Notifications.scheduleNotificationAsync({
  content: {
    title: 'Time to review',
    body: `${dueCount} flashcards are waiting.`,
  },
  trigger: { hour: 19, minute: 0, repeats: true },   // 7 PM every day
});
```

Persist the user's preferred reminder time locally (e.g. with `AsyncStorage`). Cancel and re-schedule when they change it.

**Server-pushed reminders** ("you haven't reviewed in 3 days") need the backend to hold each user's Expo push token + a cron, which is deliberately deferred. See `backend-status.md` → Deferred → "study reminders" — only do it once you actually need re-engagement nudges.

## 12. Onboarding sequence

The product flow that maps screens to endpoints (from [user-flow.md §15](user-flow.md)):

1. **Sign up** → `supabase.auth.signUp` → "Check your inbox" screen.
2. **Confirm email** → user taps email link → app opens at login.
3. **Sign in** → `supabase.auth.signInWithPassword` → home (dashboard).
4. **Empty state: "Upload your first chapter"** → `POST /upload` → progress screen polling `documents.progress`.
5. **Pick teach or ask** → `POST /lesson/start` + `POST /lesson/next`, or `POST /session` + `POST /ask`.
6. **Take a test** → `/assessment/create` → `/start` → `/answer/save` × N → `/submit`.
7. **Review results** → render the submit response. Show `sources` and a "this seems wrong" button per question.
8. **Revise** → `/revision/{doc}/misses` → "Make me a practice test" → `/revision/practice`.
9. **Generate flashcards** → `/flashcards/generate` once → daily `/flashcards/due` review sessions.
10. **Exam prep** → `POST /focus-areas` with name + topics + `exam_date` → three pre-populated CTAs: "Walk me through these topics" (`/lesson/start` with `focus_area_id`), "Make flashcards" (`/flashcards/generate` with `focus_area_id`), "Test me" (`/assessment/create` with `focus_area_id`). Surface a countdown to `exam_date` on the home screen.
11. **Progress screen** → `/documents/{id}/progress` per book, `/dashboard` for overview. Render exams (`kind: "exam"`) as larger cards than tests.
12. **Trial ending banner** → `/me/access` says `trial` with little time left → upgrade screen built from `/plans`.

Returning users live mostly in steps 5, 6, 8, 9, 10 — every other screen is set-and-forget.

## A final reminder

The backend assumes the frontend supplies user context via the JWT. **Never** trust client-side state for things like ownership or plan limits — every check is server-side. The frontend is purely a renderer of backend state. Treat it accordingly.
