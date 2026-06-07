# Database schema

Postgres 15 (via Supabase), with the `vector` (pgvector) extension. 13 tables total, all under the `public` schema, plus the auth-managed `auth.users` table that `public.users` extends.

> **Spinning up a fresh Supabase project?** Paste [`schema.sql`](schema.sql) into the Supabase SQL Editor and run it. The file is a single self-contained migration of everything in this doc — tables, indexes, RLS policies, the `handle_new_user` trigger, the `match_chunks` RPC, storage policies for the `uploads` bucket, and the seeded `plans` rows. Safe to re-run. After the script: create the `uploads` storage bucket (Private), copy the JWT Secret into the backend's `SUPABASE_JWT_SECRET` env var, and you're done. The per-table sections below are the reference for why each column / policy exists; the SQL file is what you actually execute.

## Schema overview

Every table cascades from `auth.users` (managed by Supabase Auth). Deleting an auth user deletes its `public.users` profile, which in turn cascades through every owned row in every domain table, plus removes the user's storage folder via the application-layer `DELETE /me/account` logic.

```
auth.users   (Supabase Auth)
    │  id → public.users.id   ON DELETE CASCADE
    ▼
public.users
    │
    ├──► documents              (user_id → users, CASCADE)
    │      ├──► chunks          (document_id + user_id → users/documents, both CASCADE)
    │      ├──► focus_areas     (document_id + user_id → users/documents, both CASCADE)
    │      └──► flashcards      (document_id + user_id → users/documents, both CASCADE)
    │             └──► flashcard_reviews   (flashcard_id + user_id, both CASCADE)
    │
    ├──► chat_sessions          (user_id + document_id, CASCADE; focus_area_id, SET NULL)
    │      └──► messages        (session_id + user_id, both CASCADE)
    │
    ├──► assessments            (user_id + document_id, both CASCADE)
    │      ├──► questions       (assessment_id, CASCADE)
    │      └──► answers         (question_id + assessment_id + user_id, all CASCADE)
    │
    └──► usage                  (user_id, CASCADE)

plans   (no ownership FK — global catalogue. `users.plan` text matches `plans.code`.)
```

The chain matters: dropping a user really does drop everything, in one cascade. That's what makes `DELETE /me/account` honest about right-to-erasure compliance.

## Conventions

- **IDs**: every primary key is `uuid` defaulting to `gen_random_uuid()`.
- **Timestamps**: every `*_at` column is `timestamptz` stored in UTC.
- **RLS**: enabled on every domain table. The standard policy is `auth.uid() = user_id` for full access (read + write). Exceptions are called out per table below.
- **Backend bypasses RLS**: the FastAPI backend uses Supabase's service-role key (which bypasses RLS) and explicitly filters every query by `user_id`. RLS is the safety net for any future direct user-JWT access (e.g., from the Supabase JS client).
- **JSON columns**: `options`, `rubric`, `source_chunk_ids`, `topics` are all `jsonb`. Arrays are stored as JSON arrays.

---

## Table `users`

Profile data for each authenticated user. The `id` is the same UUID as the `auth.users` row this profile extends.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `email` | `text` |  Nullable |
| `name` | `text` |  Nullable |
| `plan` | `text` |  Nullable |
| `trial_ends_at` | `timestamptz` |  Nullable |
| `preferred_level` | `text` |  Nullable |
| `tts_enabled` | `bool` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `subscription_ends_at` | `timestamptz` |  Nullable |

### Relationships

- `id` → `auth.users.id` ON DELETE CASCADE — deleting the auth user drops this profile, which cascades to every owned row.
- `plan` is plain `text` and informally matches `plans.code`; not enforced as a foreign key.

### Defaults

- `plan` = `'basic'`
- `trial_ends_at` = `now() + interval '7 days'`
- `preferred_level` = `'novice'`
- `tts_enabled` = `false`

### RLS

- Policy `own profile`: `auth.uid() = id` — users can only read/modify their own profile row.

---

## Table `documents`

One row per uploaded study document.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `title` | `text` |  Nullable |
| `subject` | `text` |  Nullable |
| `file_path` | `text` |  Nullable |
| `source_type` | `text` |  Nullable |
| `status` | `text` |  Nullable |
| `outline` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `progress` | `text` |  Nullable |

### Relationships

- `user_id` → `public.users.id` ON DELETE CASCADE.

### Defaults

- `status` = `'processing'` (flips to `'ready'` or `'failed'`)
- `progress` is `null` until ingestion starts; gets populated with strings like `'embedding chunk 10 of 34'` while processing, cleared back to `null` on success, left in place on failure (so the failure point stays visible).
- `subject` is unused today — declared in the build plan but never populated by `/upload`.

### RLS

- Policy `own documents`: `auth.uid() = user_id`.

---

## Table `chunks`

The embedded passages of every document. One row per ~800-word chunk.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `document_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `content` | `text` |  |
| `embedding` | `vector(1536)` |  Nullable |
| `chunk_index` | `int4` |  Nullable |
| `page_number` | `int4` |  Nullable |
| `content_type` | `text` |  Nullable |
| `figure_path` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

### Relationships

- `document_id` → `public.documents.id` ON DELETE CASCADE.
- `user_id` → `public.users.id` ON DELETE CASCADE — denormalised onto chunks so the `match_chunks` RPC can filter by user without a join.

### Defaults

- `content_type` = `'text'`. Other values: `'math'` (chunks containing LaTeX markers) and `'figure'` (chunks that are a `[bracketed description]` of a diagram).
- `figure_path` points at `<user_id>/<doc_id>/figures/p<N>_<idx>.png` in the `uploads` bucket when the source page has an embedded image extracted by PyMuPDF; null otherwise. Populated by `ingest_document` since 2026-06-05. Frontend resolves a 1-hour signed URL via `GET /files/signed-url?path=...` to render the diagram next to the chunk text. The `_sources_from_search` figure-expansion path (chat.py) pulls every same-page figure for composite-figure handling (e.g. Anthracnose subfigures A/B/C/D). Single-page PDFs (HTML-to-PDF exports) suppress `figure_path` everywhere at read time because positional figure-to-chunk assignment is unreliable on those documents.

### Indexes

- No HNSW index on `embedding` yet. The plan calls for adding one around 500 users: `create index on public.chunks using hnsw (embedding vector_cosine_ops);`.

### RLS

- Policy `own chunks`: `auth.uid() = user_id`.

---

## Table `chat_sessions`

A study session — either an ask-mode conversation or a teach-mode lesson walk.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `document_id` | `uuid` |  |
| `title` | `text` |  Nullable |
| `mode` | `text` |  Nullable |
| `level` | `text` |  Nullable |
| `current_outline_point` | `int4` |  Nullable |
| `lesson_summary` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `focus_area_id` | `uuid` |  Nullable |

### Relationships

- `user_id` → `public.users.id` ON DELETE CASCADE.
- `document_id` → `public.documents.id` ON DELETE CASCADE.
- `focus_area_id` → `public.focus_areas.id` ON DELETE SET NULL — if the focus area is deleted, the session stays but reverts to whole-outline scope.

### Defaults

- `mode` = `'ask'` (other: `'teach'`)
- `level` = `'novice'`
- `current_outline_point` = `0`
- `lesson_summary` = `''`

### RLS

- Policy `own sessions`: `auth.uid() = user_id`.

---

## Table `messages`

Append-only log of every turn in a chat session.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `session_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `role` | `text` |  |
| `content` | `text` |  Nullable |
| `image_path` | `text` |  Nullable |
| `metadata` | `jsonb` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

### Notes on `metadata`

Free-form bag the backend attaches to assistant turns. Currently shaped as `{"sources": [...], "topic": "..."}`:

- `sources` — the same `Source[]` shape returned to the frontend (`chunk_id`, `page_number`, `figure_path`, `snippet`). Saved on every teach lesson and every `/ask` reply so the transcript view and the cached lesson peek can replay figures + material citations without re-running RAG (which would cost an embed call and could drift between runs).
- `topic` — set by `teach_next` so the transcript view can apply the same page-level topic-relevance filter the live lesson screen uses.

Older rows (pre-column) have `metadata = NULL` — readers must treat that as "no saved sources" and either skip figures or fall back to RAG.

### Relationships

- `session_id` → `public.chat_sessions.id` ON DELETE CASCADE.
- `user_id` → `public.users.id` ON DELETE CASCADE.

### RLS

- Policy `own messages`: `auth.uid() = user_id`.

### Migration

Added 2026-06-05 to enable transcript figure replay and the lesson cached-peek source path:

```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb;
```

---

## Table `assessments`

One row per test or exam attempt.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `document_id` | `uuid` |  |
| `kind` | `text` |  Nullable |
| `format` | `text` |  Nullable |
| `level` | `text` |  Nullable |
| `time_limit_seconds` | `int4` |  Nullable |
| `status` | `text` |  Nullable |
| `started_at` | `timestamptz` |  Nullable |
| `submitted_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `score` | `numeric` |  Nullable |
| `total_points` | `int4` |  Nullable |

### Relationships

- `user_id` → `public.users.id` ON DELETE CASCADE.
- `document_id` → `public.documents.id` ON DELETE CASCADE.

### Defaults

- `kind` = `'test'` (other: `'exam'`)
- `format` = `'mixed'` (other: `'objective'`, `'theory'`)
- `level` = `'novice'`
- `status` = `'ready'` (then `'in_progress'`, then `'submitted'`)
- `time_limit_seconds` column default is `600` but the backend computes a value from the actual questions and writes that instead.

### RLS

- Policy `own assessments`: `auth.uid() = user_id`.

---

## Table `questions`

Generated questions belonging to an assessment. Includes the reference answer and rubric — these are stored on the question itself and stripped server-side before being sent to the student.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `assessment_id` | `uuid` |  |
| `question_text` | `text` |  |
| `question_type` | `text` |  |
| `options` | `jsonb` |  Nullable |
| `reference_answer` | `text` |  Nullable |
| `rubric` | `jsonb` |  Nullable |
| `points` | `int4` |  Nullable |
| `source_chunk_ids` | `jsonb` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

### Relationships

- `assessment_id` → `public.assessments.id` ON DELETE CASCADE.
- `source_chunk_ids` is a `jsonb` array of `chunk.id` UUIDs — not a foreign key, but functionally references `public.chunks.id` for the "sources" transparency feature.

### Defaults

- `points` = `1`.

### RLS

- Policy `own questions`: an EXISTS subquery — `auth.uid()` must match `user_id` on the parent assessment. Different shape from the other tables because `questions` doesn't carry `user_id` directly.

```sql
exists (
  select 1 from public.assessments a
  where a.id = questions.assessment_id and a.user_id = auth.uid()
)
```

---

## Table `answers`

A student's answer to one question. Always exactly one row per `(assessment_id, question_id)` via a unique constraint.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `question_id` | `uuid` |  |
| `assessment_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `student_answer` | `text` |  Nullable |
| `answer_image_path` | `text` |  Nullable |
| `extracted_work` | `text` |  Nullable |
| `is_correct` | `bool` |  Nullable |
| `score_awarded` | `numeric` |  Nullable |
| `grade_reasoning` | `text` |  Nullable |
| `graded_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `disputed` | `bool` |  Nullable |
| `dispute_reason` | `text` |  Nullable |
| `disputed_at` | `timestamptz` |  Nullable |

### Relationships

- `question_id` → `public.questions.id` ON DELETE CASCADE.
- `assessment_id` → `public.assessments.id` ON DELETE CASCADE.
- `user_id` → `public.users.id` ON DELETE CASCADE.

### Unique constraint

- `uniq_answer` on `(assessment_id, question_id)` — guarantees one answer per question per attempt and makes `/answer/save` an idempotent upsert.

### Defaults

- `disputed` = `false`.

### RLS

- Policy `own answers`: `auth.uid() = user_id`.

---

## Table `plans`

Global catalogue of subscription plans. No per-user ownership.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `code` | `text` |  Unique |
| `name` | `text` |  |
| `price_cents` | `int4` |  |
| `currency` | `text` |  Nullable |
| `billing_period` | `text` |  Nullable |
| `max_documents` | `int4` |  Nullable |
| `max_questions` | `int4` |  Nullable |
| `max_assessments` | `int4` |  Nullable |
| `is_active` | `bool` |  Nullable |

### Defaults

- `currency` = `'USD'` (change to `'NGN'` if selling in naira via Paystack)
- `billing_period` = `'month'`
- `is_active` = `true`
- `max_*` columns: `null` means unlimited — the Pro plan uses this.

### Seeded rows

| code | name | price_cents | max_documents | max_questions | max_assessments |
|---|---|---|---|---|---|
| `basic` | Basic (free trial) | 0 | 1 | 20 | 2 |
| `standard` | Standard | 399 | 5 | 200 | 15 |
| `pro` | Pro | 899 | null | null | null |

### RLS

- Policy `anyone reads plans`: `USING (true)` for SELECT — public, no auth required. There's no INSERT/UPDATE/DELETE policy, so writes are admin-only via the service-role key.

---

## Table `usage`

Per-user, per-month counters for the metered actions (questions and assessments). Document count is derived by `count(*) from documents`, not stored here.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `period_start` | `date` |  |
| `questions_used` | `int4` |  Nullable |
| `assessments_used` | `int4` |  Nullable |

### Relationships

- `user_id` → `public.users.id` ON DELETE CASCADE.

### Unique constraint

- `(user_id, period_start)` — one row per user per month. The backend's `get_usage` upserts on this.

### Defaults

- `period_start` = `date_trunc('month', now())::date` — automatically rolls to the next month when a user takes their first action.
- `questions_used` = `0`
- `assessments_used` = `0`

### RLS

- Policy `own usage`: `auth.uid() = user_id`.

---

## Table `flashcards`

Generated flashcards with their SuperMemo 2 state.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `document_id` | `uuid` |  |
| `front` | `text` |  |
| `back` | `text` |  |
| `source_chunk_ids` | `jsonb` |  Nullable |
| `ease_factor` | `numeric` |  Nullable |
| `interval_days` | `int4` |  Nullable |
| `repetitions` | `int4` |  Nullable |
| `next_review_at` | `timestamptz` |  Nullable |
| `last_reviewed_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

### Relationships

- `user_id` → `public.users.id` ON DELETE CASCADE.
- `document_id` → `public.documents.id` ON DELETE CASCADE.

### Defaults

- `ease_factor` = `2.5` (SM-2 starting point)
- `interval_days` = `0`
- `repetitions` = `0`
- `next_review_at` = `now()` (so new cards are immediately due)

### Indexes

- `(user_id, next_review_at)` — the "due cards" query.
- `(user_id, document_id)` — the "library for this document" query.

### RLS

- Policy `own flashcards`: `auth.uid() = user_id`.

---

## Table `flashcard_reviews`

Append-only log of every flashcard review. Useful for analytics later ("which cards reset most often") but not read on the hot path.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `flashcard_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `rating` | `int4` |  |
| `ease_factor_after` | `numeric` |  Nullable |
| `interval_days_after` | `int4` |  Nullable |
| `reviewed_at` | `timestamptz` |  Nullable |

### Relationships

- `flashcard_id` → `public.flashcards.id` ON DELETE CASCADE.
- `user_id` → `public.users.id` ON DELETE CASCADE.

### Indexes

- `(user_id, reviewed_at desc)` — for any future "your review history" query.

### RLS

- Policy `own flashcard reviews`: `auth.uid() = user_id`.

---

## Table `focus_areas`

Areas of Concentration — saved lists of topics from a document for upcoming exams.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `document_id` | `uuid` |  |
| `name` | `text` |  |
| `topics` | `jsonb` |  |
| `exam_date` | `date` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

### Relationships

- `user_id` → `public.users.id` ON DELETE CASCADE.
- `document_id` → `public.documents.id` ON DELETE CASCADE.

### Indexes

- `(user_id, document_id)` — for "focus areas for this document" lookups.

### RLS

- Policy `own focus areas`: `auth.uid() = user_id`.

---

## Database functions

### `handle_new_user()` (trigger function)

Fired after `INSERT` on `auth.users`. Reads `full_name` out of the new user's `raw_user_meta_data` JSON and creates a matching `public.users` row.

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

`security definer` is required so the trigger can write to `public.users` regardless of who triggered the auth signup.

### `match_chunks()` (pgvector RPC)

The vector-similarity search the backend calls for every `/ask`, `/lesson/next`, and topic-scoped assessment. Filters by user and document so RLS is mirrored even when the backend (which bypasses RLS) calls it.

```sql
create or replace function match_chunks(
  query_embedding vector(1536),
  match_user_id uuid,
  match_document_id uuid,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  chunk_index int,
  similarity float
)
language sql stable
as $$
  select
    chunks.id,
    chunks.content,
    chunks.chunk_index,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  where chunks.user_id = match_user_id
    and chunks.document_id = match_document_id
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;
```

The `<=>` operator is pgvector's cosine distance. Lower = more similar; the `1 - ...` flips it into a similarity score.

---

## Storage policies

The `uploads` bucket (private) holds the original PDFs and any answer-photo uploads. Files live under `uploads/<user_id>/...`.

```sql
create policy "own files upload" on storage.objects
  for insert with check (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own files read" on storage.objects
  for select using (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );
```

The first folder segment of the path must match the caller's `auth.uid()`. The backend uploads using the service-role key (which bypasses these), but it always namespaces the path by `user_id` itself — so the policies are the safety net for any future direct-from-client uploads.

DB foreign keys do not cascade into storage. The `DELETE /me/account` endpoint explicitly deletes every storage file for the user before invoking `supabase.auth.admin.delete_user`, otherwise files would be orphaned.
