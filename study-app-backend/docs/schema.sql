-- Studae — full Postgres schema for a fresh Supabase project.
--
-- Paste this whole file into Supabase SQL Editor → New Query → Run.
-- Safe to re-run: every CREATE uses IF NOT EXISTS and every DROP guards
-- with IF EXISTS, so it acts as a careful upsert against an existing
-- project too. Intended use is greenfield, though.
--
-- What you get after running this:
--   1. pgvector extension enabled
--   2. 13 domain tables under public.* with all keys, defaults, and uniques
--   3. RLS enabled + standard auth.uid()-based policies on every table
--   4. handle_new_user() trigger that mints a public.users row whenever
--      a Supabase Auth user signs up
--   5. match_chunks() pgvector RPC used by /ask, /lesson/next, etc.
--   6. uploads storage bucket policies
--   7. plans catalogue seeded with basic / standard / pro
--
-- After running, in Supabase Studio:
--   - Storage → New bucket → name "uploads", set Private (NOT public)
--   - Project Settings → API → JWT Settings → JWT Secret → copy into
--     SUPABASE_JWT_SECRET on the backend
--
-- Reference: docs/database.md for column-by-column rationale.

-- =========================================================================
-- 0. Extensions
-- =========================================================================

create extension if not exists vector;
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- =========================================================================
-- 1. Tables (in FK-dependency order)
-- =========================================================================

-- users — extends auth.users 1:1.
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  plan text default 'basic',
  trial_ends_at timestamptz default (now() + interval '7 days'),
  preferred_level text default 'novice',
  tts_enabled boolean default false,
  subscription_ends_at timestamptz,
  created_at timestamptz default now()
);

-- documents — one row per uploaded PDF / image.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  subject text,
  file_path text,
  source_type text,
  status text default 'processing',
  outline text,
  progress text,
  created_at timestamptz default now()
);
create index if not exists documents_user_id_idx on public.documents(user_id);

-- chunks — embedded passages of every document.
create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  chunk_index int,
  page_number int,
  content_type text default 'text',
  figure_path text,
  created_at timestamptz default now()
);
create index if not exists chunks_doc_idx on public.chunks(document_id);
create index if not exists chunks_user_idx on public.chunks(user_id);
-- Add this when you cross ~500 users for faster vector search:
--   create index on public.chunks using hnsw (embedding vector_cosine_ops);

-- focus_areas — saved exam-prep topic lists. (Declared before chat_sessions
-- because chat_sessions has an FK to focus_areas.)
create table if not exists public.focus_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  name text not null,
  topics jsonb not null,
  exam_date date,
  created_at timestamptz default now()
);
create index if not exists focus_areas_user_doc_idx on public.focus_areas(user_id, document_id);

-- chat_sessions — ask conversations and teach lessons.
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  title text,
  mode text default 'ask',
  level text default 'novice',
  current_outline_point int default 0,
  lesson_summary text default '',
  focus_area_id uuid references public.focus_areas(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists chat_sessions_user_idx on public.chat_sessions(user_id);
create index if not exists chat_sessions_doc_idx on public.chat_sessions(document_id);

-- messages — append-only log of every chat turn.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,
  content text,
  image_path text,
  metadata jsonb,
  created_at timestamptz default now()
);
create index if not exists messages_session_idx on public.messages(session_id, created_at);

-- assessments — one row per test or exam attempt.
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  kind text default 'test',
  format text default 'mixed',
  level text default 'novice',
  time_limit_seconds int default 600,
  status text default 'ready',
  started_at timestamptz,
  submitted_at timestamptz,
  score numeric,
  total_points int,
  created_at timestamptz default now()
);
create index if not exists assessments_user_idx on public.assessments(user_id);
create index if not exists assessments_doc_idx on public.assessments(document_id);

-- questions — generated questions for an assessment.
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_text text not null,
  question_type text not null,
  options jsonb,
  reference_answer text,
  rubric jsonb,
  points int default 1,
  source_chunk_ids jsonb,
  created_at timestamptz default now()
);
create index if not exists questions_assessment_idx on public.questions(assessment_id);

-- answers — student's responses, one per (assessment, question).
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  student_answer text,
  answer_image_path text,
  extracted_work text,
  is_correct boolean,
  score_awarded numeric,
  grade_reasoning text,
  graded_at timestamptz,
  disputed boolean default false,
  dispute_reason text,
  disputed_at timestamptz,
  created_at timestamptz default now(),
  constraint uniq_answer unique (assessment_id, question_id)
);
create index if not exists answers_user_idx on public.answers(user_id);

-- plans — global subscription catalogue (no per-user ownership).
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  price_cents int not null,
  currency text default 'USD',
  billing_period text default 'month',
  max_documents int,
  max_questions int,
  max_assessments int,
  is_active boolean default true
);

-- usage — per-user, per-month metering.
create table if not exists public.usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period_start date not null default (date_trunc('month', now())::date),
  questions_used int default 0,
  assessments_used int default 0,
  constraint uniq_usage_period unique (user_id, period_start)
);

-- flashcards — generated cards with SM-2 spaced-repetition state.
create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  front text not null,
  back text not null,
  source_chunk_ids jsonb,
  ease_factor numeric default 2.5,
  interval_days int default 0,
  repetitions int default 0,
  next_review_at timestamptz default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists flashcards_due_idx on public.flashcards(user_id, next_review_at);
create index if not exists flashcards_doc_idx on public.flashcards(user_id, document_id);

-- flashcard_reviews — append-only log of every card review.
create table if not exists public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating int not null,
  ease_factor_after numeric,
  interval_days_after int,
  reviewed_at timestamptz default now()
);
create index if not exists flashcard_reviews_user_idx on public.flashcard_reviews(user_id, reviewed_at desc);

-- =========================================================================
-- 2. Row Level Security
--
-- The backend uses the service-role key (which bypasses RLS), but RLS is
-- the safety net for any future direct user-JWT access (e.g. from the
-- Supabase JS client). Every domain table has its standard
-- auth.uid() = user_id policy. questions is the odd one because it
-- doesn't carry user_id directly — it joins to assessments.
-- =========================================================================

alter table public.users           enable row level security;
alter table public.documents       enable row level security;
alter table public.chunks          enable row level security;
alter table public.chat_sessions   enable row level security;
alter table public.messages        enable row level security;
alter table public.assessments     enable row level security;
alter table public.questions       enable row level security;
alter table public.answers         enable row level security;
alter table public.plans           enable row level security;
alter table public.usage           enable row level security;
alter table public.flashcards      enable row level security;
alter table public.flashcard_reviews enable row level security;
alter table public.focus_areas     enable row level security;

drop policy if exists "own profile"          on public.users;
create policy "own profile"          on public.users           for all using (auth.uid() = id);

drop policy if exists "own documents"        on public.documents;
create policy "own documents"        on public.documents       for all using (auth.uid() = user_id);

drop policy if exists "own chunks"           on public.chunks;
create policy "own chunks"           on public.chunks          for all using (auth.uid() = user_id);

drop policy if exists "own sessions"         on public.chat_sessions;
create policy "own sessions"         on public.chat_sessions   for all using (auth.uid() = user_id);

drop policy if exists "own messages"         on public.messages;
create policy "own messages"         on public.messages        for all using (auth.uid() = user_id);

drop policy if exists "own assessments"      on public.assessments;
create policy "own assessments"      on public.assessments     for all using (auth.uid() = user_id);

drop policy if exists "own questions"        on public.questions;
create policy "own questions"        on public.questions       for all using (
  exists (
    select 1 from public.assessments a
    where a.id = questions.assessment_id and a.user_id = auth.uid()
  )
);

drop policy if exists "own answers"          on public.answers;
create policy "own answers"          on public.answers         for all using (auth.uid() = user_id);

drop policy if exists "anyone reads plans"   on public.plans;
create policy "anyone reads plans"   on public.plans           for select using (true);

drop policy if exists "own usage"            on public.usage;
create policy "own usage"            on public.usage           for all using (auth.uid() = user_id);

drop policy if exists "own flashcards"       on public.flashcards;
create policy "own flashcards"       on public.flashcards      for all using (auth.uid() = user_id);

drop policy if exists "own flashcard reviews" on public.flashcard_reviews;
create policy "own flashcard reviews" on public.flashcard_reviews for all using (auth.uid() = user_id);

drop policy if exists "own focus areas"      on public.focus_areas;
create policy "own focus areas"      on public.focus_areas     for all using (auth.uid() = user_id);

-- =========================================================================
-- 3. Functions and triggers
-- =========================================================================

-- handle_new_user — runs after a Supabase Auth signup. Creates the
-- matching public.users row by copying email and full_name across.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- match_chunks — pgvector RPC. Returns top-N most similar chunks for a
-- given embedding, filtered by user + document.
create or replace function public.match_chunks(
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
  from public.chunks
  where chunks.user_id = match_user_id
    and chunks.document_id = match_document_id
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- =========================================================================
-- 4. Storage policies
--
-- These run on storage.objects. The bucket itself must be created
-- separately in Supabase Studio (Storage → New bucket → name "uploads",
-- privacy "Private"). The backend always namespaces uploads under
-- <user_id>/..., and these policies enforce that for any direct-from-
-- client access too.
-- =========================================================================

drop policy if exists "own files upload" on storage.objects;
create policy "own files upload" on storage.objects
  for insert with check (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own files read" on storage.objects;
create policy "own files read" on storage.objects
  for select using (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================================================================
-- 5. Seed data
--
-- Plans catalogue. Idempotent via ON CONFLICT — re-running just updates
-- the row in place. Price is in cents of the plan's currency.
-- =========================================================================

insert into public.plans (code, name, price_cents, currency, billing_period,
                          max_documents, max_questions, max_assessments, is_active)
values
  ('basic',    'Basic (free trial)', 0,   'USD', 'month', 1,    20,   2,    true),
  ('standard', 'Standard',           399, 'USD', 'month', 5,    200,  15,   true),
  ('pro',      'Pro',                899, 'USD', 'month', null, null, null, true)
on conflict (code) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  billing_period = excluded.billing_period,
  max_documents = excluded.max_documents,
  max_questions = excluded.max_questions,
  max_assessments = excluded.max_assessments,
  is_active = excluded.is_active;

-- =========================================================================
-- Done. After this script runs cleanly:
--   1. Create the "uploads" bucket as Private in Storage.
--   2. Copy the JWT Secret into the backend's SUPABASE_JWT_SECRET env var.
--   3. Sign up a test user; verify a public.users row appears automatically.
--   4. Start the backend and run scripts/test_api_shapes.sh against it.
-- =========================================================================
