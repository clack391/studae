/* Backend response types — each one mapped to a real endpoint handler in
   Studae/study-app-backend/app/. Field names match the wire format exactly.
   Verified against app/main.py, app/assess.py, app/chat.py, app/flashcards.py,
   app/focus.py, app/billing.py and the test fixtures in tests/smoke_test.py. */

export type Level = 'novice' | 'amateur' | 'professional';
export type DocStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type QuestionType = 'objective' | 'theory';
export type AssessmentKind = 'test' | 'exam';
export type AssessmentFormat = 'objective' | 'theory' | 'mixed';
export type AccessReason = 'trial' | 'trial_expired' | 'subscribed' | 'subscription_expired';
export type MessageRole = 'user' | 'assistant';

// --- /dashboard ----------------------------------------------------------
// app/main.py:479. Dashboard documents are slim — no topic counts. For
// counts, call /documents/{id}/progress.
export interface DashboardDocument {
  id: string;
  title: string;
  status: DocStatus;
  progress: string | null;
  created_at: string;
}

// recent_assessments rows. Note `total_points` (NOT `total`).
export interface DashboardAssessment {
  id: string;
  kind: AssessmentKind;
  score: number | null;
  total_points: number | null;
  level: Level;
  submitted_at: string;
  document_id: string;
}

export interface Dashboard {
  name: string | null;
  plan: string | null;
  trial_ends_at: string | null;
  preferred_level: Level;
  tts_enabled: boolean;
  documents_count: number;
  documents: DashboardDocument[];
  assessments_taken: number;
  average_score_percent: number | null;
  recent_assessments: DashboardAssessment[];
}

// --- /me/access ----------------------------------------------------------
// app/main.py:714 + app/billing.py:40. `state` is an OBJECT, limits can be
// `null` for unlimited (Pro plan).
export interface AccessState {
  plan: string;
  active: boolean;
  reason: AccessReason;
}

export interface MeAccess {
  state: AccessState;
  usage: { questions: number; assessments: number };
  limits: { documents: number | null; questions: number | null; assessments: number | null };
}

// --- /plans (public) -----------------------------------------------------
// app/main.py:520. max_* are `null` for unlimited.
export interface Plan {
  id: string;
  code: string;          // 'basic' | 'standard' | 'pro'
  name: string;
  price_cents: number;
  currency: string;      // e.g. 'USD'
  billing_period: string; // e.g. 'month'
  max_documents: number | null;
  max_questions: number | null;
  max_assessments: number | null;
  is_active: boolean;
}

// --- /upload -------------------------------------------------------------
export interface UploadResponse {
  document_id: string;
  status: DocStatus;
}

// --- /documents/{id} -----------------------------------------------------
// Added in this session — app/main.py:636 (just above /progress).
export interface DocumentDetail {
  id: string;
  title: string;
  status: DocStatus;
  progress: string | null;
  page_count: number | null;
  created_at: string;
  outline_points: string[];
  topics_total: number;
  topics_taught: number;
}

// --- /documents/{id}/progress -------------------------------------------
// app/main.py:636.
export interface DocumentProgress {
  document_id: string;
  title: string;
  topics_total: number;
  topics_taught: number;
  assessments_taken: number;
  average_score_percent: number | null;
  flashcards_in_library: number;
  flashcards_mastered: number;
}

// --- /session, /lesson/start --------------------------------------------
export interface NewSessionResponse {
  session_id: string;
}

// --- /sessions, /sessions/{id}/messages ---------------------------------
// app/main.py:236 + 255.
export interface ChatSession {
  id: string;
  mode: 'teach' | 'ask';
  level: Level;
  document_id: string;
  title: string | null;
  current_outline_point: number | null;
  focus_area_id: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string | null;
  image_path: string | null;
  // Free-form jsonb the backend attaches to lesson messages. Currently
  // carries { sources, topic } for teach-mode replies so the transcript
  // can re-render the same figures and material citations without
  // re-running RAG.
  metadata?: { sources?: Source[]; topic?: string } | null;
  created_at: string;
}

// --- /ask, /ask-photo ---------------------------------------------------
// app/main.py:202 + 215.
export interface Source {
  chunk_id: string;
  page_number: number | null;
  // Storage path of the figure/diagram that backs this chunk, when the
  // chunk is a `[bracketed description]` of a figure pulled from the PDF.
  // Resolve via api.signedUrl(figure_path) before <Image source={{ uri }}>.
  figure_path?: string | null;
  snippet: string;
}

export interface AskResponse {
  answer: string;
  sources: Source[];
}

export interface AskPhotoResponse extends AskResponse {
  read_back: string;
}

// --- /lesson/next -------------------------------------------------------
// app/chat.py:243. Flat shape. `lesson` is the markdown body (string).
// `progress` is the string "N of M".
export interface LessonNextResponse {
  done: boolean;
  topic?: string;
  lesson: string;
  progress?: string;
  sources?: Source[];
  // Level the session was originally created with. The teach screen
  // forwards this to the Ask button so a mid-lesson chat inherits the
  // lesson's level instead of falling back to the user's preferred.
  level?: Level;
}

// --- /assessment/estimate -----------------------------------------------
// app/main.py:294.
export interface AssessmentEstimate {
  kind: AssessmentKind;
  format: AssessmentFormat;
  num_questions: number;
  estimated_time_seconds: number;
  rule: {
    seconds_per_objective: number;
    seconds_per_theory_avg: number;
    seconds_per_theory_point: number;
    min_seconds_per_theory: number;
    min_seconds_total: number;
  };
}

// --- /assessment/create -------------------------------------------------
export interface AssessmentCreateResponse {
  assessment_id: string;
}

// --- /assessment/start --------------------------------------------------
// app/assess.py:310 (safe_question) + 320 (start_assessment).
// `question_text` NOT `prompt`. No reference_answer / rubric leaked.
export interface SafeQuestion {
  id: string;
  question_type: QuestionType;
  question_text: string;
  options: string[] | null;
  points: number;
  // Figures extracted from source chunks. The snippet is empty here so the
  // chunk text doesn't leak the answer; only the diagram itself and the
  // page number are exposed.
  figure_sources: Source[];
}

export interface AssessmentStartResponse {
  questions: SafeQuestion[];
  seconds_left: number;
  time_limit_seconds: number;
}

// --- /assessment/{id}/time ----------------------------------------------
export interface AssessmentTimeResponse {
  seconds_left: number;
}

// --- /answer/save, /answer/save-photo -----------------------------------
// Returns {saved:true} on success. On expiry: 410 with detail = AssessmentClosedDetail.
export interface AnswerSaveResponse {
  saved: true;
}

// --- /assessment/submit, /history/{id} per-result item ------------------
// app/assess.py:_results_from_saved + main.py:399. `question`, `your_answer`,
// `correct`, `score`, `out_of`. Theory items may have `extracted_work` echo
// inside `reasoning` (the backend prefixes it).
export interface AssessmentResult {
  answer_id: string | null;
  question: string;
  type?: QuestionType;          // present on /history/{id}, not on /submit
  your_answer: string | null;
  reference_answer: string | null;
  correct: boolean | null;
  score: number | null;
  out_of: number;
  reasoning: string | null;
  sources: Source[];
  disputed: boolean;
  dispute_reason: string | null;
}

// --- /assessment/submit -------------------------------------------------
export interface AssessmentSubmitResponse {
  score: number;
  total: number;
  results: AssessmentResult[];
  answers_release_at?: string;  // present for exams within 10 min of submit
}

// --- 410 from /answer/save when timer expired ---------------------------
export interface AssessmentClosedDetail {
  message: string;
  results: AssessmentSubmitResponse;
  read_back?: string;           // present for save-photo path
}

// --- /history -----------------------------------------------------------
export interface HistoryItem {
  id: string;
  document_id: string;
  kind: AssessmentKind;
  format: AssessmentFormat;
  level: Level;
  score: number | null;
  total_points: number | null;
  submitted_at: string;
}

export interface HistoryListResponse {
  assessments: HistoryItem[];
}

// --- /history/{id} ------------------------------------------------------
// Top-level NO score/total — those live inside `assessment` as score + total_points.
export interface AssessmentRow {
  id: string;
  user_id: string;
  document_id: string;
  kind: AssessmentKind;
  format: AssessmentFormat;
  level: Level;
  time_limit_seconds: number;
  status: 'ready' | 'in_progress' | 'submitted';
  started_at: string | null;
  submitted_at: string | null;
  created_at: string;
  score: number | null;
  total_points: number | null;
}

export interface HistoryDetailResponse {
  assessment: AssessmentRow;
  results: AssessmentResult[];
  answers_release_at?: string;
}

// --- /revision/{doc}/misses ---------------------------------------------
// app/main.py:441. `question` not `prompt`, `your_answer` not `student_answer`.
export interface RevisionMiss {
  question: string | null;
  your_answer: string | null;
  reference_answer: string | null;
  reasoning: string | null;
}

export interface MissesResponse {
  misses: RevisionMiss[];
}

// --- /revision/practice -------------------------------------------------
export type PracticeResponse = AssessmentCreateResponse;

// --- /answer/{id}/dispute -----------------------------------------------
export interface DisputeResponse {
  disputed: true;
}

// --- /flashcards/* ------------------------------------------------------
// app/flashcards.py.
export interface Flashcard {
  id: string;
  user_id: string;
  document_id: string;
  front: string;
  back: string;
  source_chunk_ids: string[] | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  sources: Source[];
}

export interface CardsResponse {
  cards: Flashcard[];
}

export interface ReviewResponse {
  next_review_at: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
}

// --- /focus-areas -------------------------------------------------------
// app/main.py:592 + app/focus.py. LIST requires ?document_id=
export interface FocusArea {
  id: string;
  user_id: string;
  document_id: string;
  name: string;
  topics: string[];
  exam_date: string | null;     // ISO date "YYYY-MM-DD"
  created_at: string;
}

export interface FocusAreasResponse {
  focus_areas: FocusArea[];
}

export interface DeletedResponse {
  deleted: true;
}

// --- /documents/{id}/summarize ------------------------------------------
export interface SummarizeResponse {
  summary: string;
  sources: Source[];
}

// --- /sessions, /sessions/{id}/messages list shapes ---------------------
export interface SessionsResponse {
  sessions: ChatSession[];
}

export interface MessagesResponse {
  messages: ChatMessage[];
}

// --- /settings ----------------------------------------------------------
export interface SettingsBody {
  preferred_level?: Level;
  tts_enabled?: boolean;
}

export interface SettingsResponse {
  updated: SettingsBody;
}

// --- /plans -------------------------------------------------------------
export interface PlansResponse {
  plans: Plan[];
}

// --- /me/account DELETE -------------------------------------------------
export interface AccountDeletedResponse {
  deleted: true;
}

// --- /healthz -----------------------------------------------------------
export interface HealthzResponse {
  ok: true;
}
