# Student Learning App: Build Plan

A study app that teaches students from their own material, powered by the Claude API. Students upload a textbook or notebook, the app teaches them at a level they pick, answers their questions, and sets tests and exams that it also grades. This document lays out the stack, how it works, the database, the payment plans, and the order to build it in.

Target for launch: 200 to 500 users.

---

## 1. What the app does

The student does three main things, and they flow into each other.

First they upload their material. A PDF or photos of pages. The app reads it and turns it into clean text it can teach from.

Then they learn. They pick a level (novice, amateur, professional), and the AI teaches them the topic at that level, the way a teacher would. After the lesson they can ask questions, going back and forth as long as they want. Learning and asking run on the same engine, the student just decides which one they want at any moment.

Then they test themselves. They choose objective, theory, or both, and the AI sets the test from their material at the chosen level. A timer runs. When they submit, they get their score right away and can review the ones they missed, with the reasoning behind each grade.

There is also an optional voice feature, so the lesson can be read aloud if the student turns it on.

Payment comes later. Everyone starts on a 7 day free trial, then picks a paid plan to keep going.

---

## 2. The stack

Everything here is settled.

**Frontend:** Expo (React Native). One codebase ships to iOS, Android, and the web browser. Build once, run everywhere.

**Backend:** Python with FastAPI. It is the brain. The apps never talk to the AI models directly, the backend does, which keeps the API keys safe and gives one place to count usage and enforce plan limits.

**Data, auth, and files:** Supabase. This covers four jobs in one service.
- Postgres for all the tables.
- pgvector (a Postgres add-on) for the RAG chunks and their vectors.
- Built in auth for signup and login.
- Storage for the uploaded files.

At this scale the free tier is plenty, and one service is far less to manage than four separate ones.

**Reading images and embeddings:** Gemini Flash-Lite. It reads photos and scanned pages, and it creates the embeddings used for search. Cheap, and it reads images on its own with no separate OCR tool.

**Teaching, setting tests, and grading:** Claude Sonnet. This is the reasoning heavy work where quality matters most.

So there are two model providers. Gemini does the reading and the search side. Claude does the thinking.

---

## 3. How it fits together

Everything funnels through the FastAPI backend. The two apps send requests to it, and it decides what to call.

```
Mobile app  Web app
        \   /
     FastAPI backend
        /        \
  AI services   Supabase
  - Gemini      - Postgres + pgvector
  - Claude      - Auth
                - Storage
```

Auth sits in front of all of it. Every flow below assumes the student is already logged in. Row level security in Postgres is what makes sure one student can never see another student's material or grades. This is not optional and it goes in from the start.

---

## 4. The four flows

### Ingestion (runs once per document)

1. Student uploads a PDF or photos.
2. The backend checks the file type.
3. If it is a PDF with real text, pull the text straight out. Cheap and fast, no AI.
4. If it is photos or a scanned PDF, Gemini reads the pages. Math is captured as LaTeX so it stays correct, and diagrams are kept as images with a short description.
5. The clean text is split into chunks.
6. Each chunk is embedded with Gemini.
7. The chunks and their vectors are stored in Postgres, tagged to that student and that document.
8. Claude reads the document once and writes an outline of it, the topics and sub-topics in order, like a table of contents it builds itself. The outline is stored on the document.

This is the one step worth paying a little for, because everything later depends on this text being right. The outline costs one extra Claude call per document, and it is what makes teach mode and resumable lessons work later, so it earns its place here.

### Learn and ask (the study loop)

1. Student picks a level and either asks a question or asks to be taught a topic.
2. The backend embeds the request with Gemini.
3. It searches only that student's chunks and pulls the closest matches.
4. It sends Claude the request, the chunks, and the level.
5. Claude responds, grounded in that material, at the right depth.
6. The answer shows on screen, with optional voice reading it aloud, and the exchange is saved.

There is one engine here with two modes. In ask mode it pulls the single best passage and answers one question. In teach mode it walks down the outline that was built at ingestion, so it never has to guess where a section starts or ends. The lesson keeps a small bit of state: which point on the outline it is on, and a short running summary of what has been covered so far. Each turn the backend sends Claude the current sub-topic, the relevant chunks, the level, and that summary. The summary is how Claude avoids repeating itself or contradicting what it said two turns earlier, it can see what it already taught. Same pipeline as ask mode, just a different instruction to Claude and the outline driving the order.

The structure above is settled. The part that is not settled on paper is the exact teaching prompt, the wording that makes Claude explain in steps instead of dumping everything at once. That gets tuned by trying it on real material once teach mode is built, not by writing more here.

A photo of a problem enters here too. It joins at step 1 as part of the question.

### Assessment

1. Student requests a test, picks objective, theory, or both, and a level.
2. Claude generates the questions from the retrieved chunks. For each question it produces three things at once: the question, the reference answer, and the rubric, meaning the key points worth marks. All three are stored on the question, along with which chunks it came from. This is the important move. The rubric is built when the material is in front of Claude, not at grading time when the student's notes may have no marking scheme.
3. The student takes the test with a timer running.
4. On submit, grading splits two ways.
   - Objective questions are matched instantly. No AI call, basically free.
   - Theory answers go to Claude as the judge at temperature 0. Because the rubric already exists from step 2, grading is almost mechanical: Claude checks the answer against each stored point, scoring on meaning rather than exact wording, and adds it up. A right answer in the student's own words still counts. The full reasoning is stored, not just the score.
5. The student sees their score and the questions they missed, each with the reasoning.

### Photo math grading (a kind of theory answer)

For math, the student does not type. They work it out on paper, snap a photo of their working (one page or several, in any order), and upload.

1. Gemini reads the handwriting and turns it into text.
2. Claude judges the working at temperature 0, not just the final answer, so good method with a small slip can earn partial credit and a lucky guess with broken steps does not pass.
3. The grade and reasoning are stored, along with what was read from the photo.

The catch: this stacks two things that can each go wrong. The photo has to be read right first, then the math judged. If a 7 is misread as a 1, the student gets marked wrong for a mistake they never made. The fix is to show the student what the AI read from their work, alongside the grade. If it misread, they see it at once. The stored reasoning should include what was seen, not only the verdict.

The uploaded solution photo is kept with that answer record for review. It is not mixed into the student's study chunks.

---

## 5. The database

Supabase handles auth, so the `users` table is really a profile linked to it.

**users**
- id, email, name
- plan_id (links to plans)
- trial_ends_at
- subscription_ends_at
- preferred_level
- tts_enabled
- created_at

**plans**
- id, code (basic, standard, pro), name
- price_cents (399, 899, stored as whole numbers to avoid rounding bugs)
- billing_period (month)
- max_documents, max_questions, max_assessments
- is_active

Plans live in the database, not in code, so a price or a limit can change by editing one row instead of redeploying the app.

**usage**
- id, user_id
- period_start
- questions_used, assessments_used

Questions and assessments reset each month. Documents do not need tracking here, you can count the rows in the documents table.

**documents**
- id, user_id, title, subject
- file_path
- source_type (pdf_text, image, scanned)
- status (processing, ready, failed)
- outline (the ordered table of contents Claude builds at ingestion)
- created_at

**chunks**
- id, document_id, user_id
- content
- embedding (vector)
- chunk_index, page_number
- content_type (text, math, figure)
- figure_path

`user_id` sits on chunks directly, not just through the document, so search can filter to one student fast and the security rules stay simple.

**chat_sessions**
- id, user_id, document_id, title
- mode (teach or ask)
- current_outline_point (where teach mode is up to)
- lesson_summary (the short running summary of what has been covered)
- created_at

**messages**
- id, session_id, role (user or assistant)
- content
- image_path
- created_at

**assessments**
- id, user_id, document_id
- kind (test or exam)
- format (objective, theory, mixed)
- level
- time_limit_seconds
- status
- started_at, submitted_at

**questions**
- id, assessment_id
- question_text, question_type
- options
- reference_answer, rubric
- points
- source_chunk_ids

**answers**
- id, question_id, assessment_id, user_id
- student_answer
- answer_image_path (for photo math)
- extracted_work (what Gemini read from the photo)
- is_correct
- score_awarded
- grade_reasoning
- graded_at

Turn on row level security from the start. Retrofitting it later is painful, and it is the thing that guarantees students stay separated.

---

## 6. Three decisions to lock now

Most of teach mode and grading you will get right by building, not by planning, because you have to watch Claude actually do them first. But three decisions are cheap to make now and painful to change later, the same way row level security and the plan fields were. Lock these three and the rest unlocks.

**Build the outline during ingestion.** Have Claude read each document once and produce its outline at upload time, stored on the document. Teach mode and resumable lessons both lean on it. This is why the ingestion flow has that extra step.

**Generate the rubric when you generate the question.** The reference answer and the rubric are created together with the question, while the source material is in front of Claude, and stored on the question. Grading then just reads against a rubric that already exists, instead of trying to invent one from notes that have no marking scheme.

**Make the exam timer server-side, with autosave.** The timer lives on the backend, not the phone, and answers save as the student goes. This one is real architecture, not policy, and it is ugly to retrofit, so decide it before building assessment. A dropped connection then does not lose the exam: the student reconnects, the server still knows the time left, and the answers are already saved.

---

## 7. Checking grading quality

Grading is the one place where "looks fine" is not good enough, because a slightly unfair grade is the thing students complain about loudest. Before any student depends on it, check it the way you would check any model output.

Build a small set of theory answers, grade them by hand, then have Claude grade the same set and compare. Where Claude disagrees with you, you learn whether the rubric approach holds and where the prompt needs work. This is the same shape as a model evaluation, a set of samples judged against a known standard. Run it once before launch, and again whenever you change the grading prompt or the model version.

---

## 8. Error handling

Most of this is just deciding a policy up front, not discovering anything.

A failed or unreadable upload sets the document status to failed and tells the student to try again, rather than leaving it stuck on processing forever.

A Claude or Gemini call that times out retries. Because teach mode keeps its state in the session, a retry picks up from the current outline point instead of starting the lesson over.

A page that Gemini clearly misreads is covered by the fix already in the plan: the student can see what was read back, both for study material and for graded math, so a bad read is visible rather than silent.

The timed exam with a dropped connection is the one that matters most, and it is handled by the server-side timer with autosave from section 6. That single decision kills the worst support message before it can happen.

---

## 9. Model settings

Pin the exact model versions for both Gemini and Claude. This keeps grading consistent, because a model update can shift how it judges.

Grading runs at temperature 0, and the full reasoning is stored every time, not just the score. That way "why did I get this wrong" always has an answer, and you can spot when the judge is being unfair.

For reading pages, the cheap Gemini tier is fine for clean printed PDFs and decent photos. Save a stronger read for the pages that actually have heavy math or rough handwriting, since those are where a cheap model can quietly misread something.

A note on prices: the figures here are good enough to plan with, but they drift, so check the live pricing before locking budgets.

---

## 10. Payment plans

Three tiers. The numbers below are placeholders you will adjust. The structure is what matters.

**Basic (free, 7 days only).** A taste. Around 1 document, 20 questions, 2 assessments. Enough to feel the value, then it runs out.

**Standard ($3.99 a month).** The everyday plan. Say 5 documents, a couple hundred questions, 15 or so assessments.

**Pro ($8.99 a month).** The heavy user. Lots of documents, high or unlimited questions and assessments. If a paid premium voice gets added later, it lives here.

The limits are tied to the things that cost money, which are the Claude calls. Every chat answer, every test set, every theory answer judged is a Claude call. Capping those caps your costs and gives people a reason to upgrade at the same time.

Before each Claude call, the backend checks the count against the plan limit and either allows it or tells the student they have hit their cap.

The trial logic is simple and does not need a payment provider, so it can be built early. A new user starts on basic with `trial_ends_at` set 7 days out. When that passes without a subscription, the premium features lock. Paid plans run a month at a time, tracked by `subscription_ends_at`.

### One heads up for mobile billing

Apple and Google require subscriptions sold inside an app to go through their own billing, and they take a cut, usually 15 to 30 percent. So a $3.99 subscription does not all reach you, and you cannot just drop a normal payment library into the iOS app for these subscriptions. The web version has more freedom. This is a known headache for every mobile subscription app, worth knowing now so the pricing does not surprise you later.

---

## 11. Build order

Get one thin slice working end to end first, then widen it.

**Phase 1, foundation.** Auth and accounts, file upload into storage, and the full ingestion pipeline, including the outline step. Goal: a student logs in, uploads one document, and it comes out the other side as clean, embedded chunks plus a stored outline. Nothing else works until this does.

**Phase 2, the study loop.** Retrieval plus Claude answering, grounded in that document, with level selection and both teach mode and ask mode. This is the heart of the product, and it includes the photo of a problem chat. Once this feels good, you have basically proven the app.

**Phase 3, assessment.** Start with objective tests, since the grading is simple. Then add theory, generating the rubric with each question and judging against it. Then add photo math grading. Build the timer server-side with autosave from the start. Before launch, run the grading check from section 7 so you trust the scores. Add the instant score and the review your misses screen.

**Phase 4, history and polish.** Grade history, revision mode, a simple dashboard, the optional voice feature.

**Phase 5, payment.** Billing and the free versus paid gate. The plans table, usage table, and trial fields are already there from the start, so this is mostly wiring in the provider and turning on the checks.

---

## 12. Cost notes

The thing to watch is ingestion, because that is where the image reading happens. But it runs once per document, and 200 to 500 students is not heavy volume. Chatting and grading are cheap per use.

The real trap is a student uploading a 400 page book in one go. It costs more to read and makes every later search fuzzier. So even though you allow whole books, nudge students toward a chapter or topic at a time. Cheaper, sharper search, and it matches how people actually study.

---

## 13. Still open

Small things to settle as you build, not blockers:
- Exact chunk size and overlap.
- Which Gemini tier to use for a clean page versus a messy or math heavy one.
- Whether the server-side timer auto submits at zero or allows a short grace period.
- The exact plan limits once you see real usage.
- The exact teaching prompt and grading prompt, both tuned on real material rather than decided now.
- The optional voice: start with the free built in phone and browser voice, and only pay for a nicer cloud voice later if students actually use the feature.
