/* HTTP client that adds the live Supabase JWT, parses errors into ApiError,
   and handles file uploads via FormData. Verified against every endpoint
   in app/main.py — see ../docs paths in study-app-backend. */

import { getCachedToken } from './token-cache';
import type {
  AccountDeletedResponse,
  AnswerSaveResponse,
  AskPhotoResponse,
  AskResponse,
  AssessmentCreateResponse,
  AssessmentEstimate,
  AssessmentKind,
  AssessmentFormat,
  AssessmentStartResponse,
  AssessmentSubmitResponse,
  AssessmentTimeResponse,
  CardsResponse,
  Dashboard,
  DeletedResponse,
  DisputeResponse,
  DocStatus,
  DocumentDetail,
  DocumentProgress,
  FocusArea,
  FocusAreasResponse,
  HealthzResponse,
  HistoryDetailResponse,
  HistoryListResponse,
  LessonNextResponse,
  Level,
  MeAccess,
  MessagesResponse,
  MissesResponse,
  NewSessionResponse,
  PlansResponse,
  PracticeResponse,
  ReviewResponse,
  SessionsResponse,
  SettingsBody,
  SettingsResponse,
  SummarizeResponse,
  UploadResponse,
} from './types';

const BASE = process.env.EXPO_PUBLIC_API_BASE;
if (!BASE) throw new Error('Missing EXPO_PUBLIC_API_BASE in .env');
export const API_BASE = BASE;

// --- /documents/{id}/reprocess ------------------------------------------
// Mirrors the backend handler's return shape {document_id, status}. Defined
// here rather than in types.ts because it is local to this single endpoint;
// `status` is "processing" on success.
export interface ReprocessResponse {
  document_id: string;
  status: DocStatus;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    const msg =
      typeof detail === 'string'
        ? detail
        : (detail as any)?.message ?? `HTTP ${status}`;
    super(msg);
    this.status = status;
    this.detail = detail;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  let url = API_BASE + path;
  if (!query) return url;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (!parts.length) return url;
  return url + (path.includes('?') ? '&' : '?') + parts.join('&');
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getCachedToken();
  if (!token) throw new ApiError(401, 'Not signed in');
  return { Authorization: `Bearer ${token}` };
}

interface Opts {
  body?: unknown;
  form?: FormData;
  query?: Query;
  auth?: boolean;
}

async function request<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  const { body, form, query, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (auth) Object.assign(headers, await authHeader());

  let payload: BodyInit | undefined;
  if (form) {
    payload = form as unknown as BodyInit;
    // Don't set Content-Type — fetch will fill in the multipart boundary.
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, query), { method, headers, body: payload });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }

  if (!res.ok) {
    const detail = parsed && typeof parsed === 'object' && 'detail' in parsed
      ? parsed.detail
      : parsed;
    throw new ApiError(res.status, detail);
  }
  return parsed as T;
}

const GET = <T>(path: string, query?: Query, auth = true) =>
  request<T>('GET', path, { query, auth });
const POST = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });
const PATCH = <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body });
const DELETE = <T>(path: string) => request<T>('DELETE', path);
const UPLOAD = <T>(path: string, form: FormData) => request<T>('POST', path, { form });

/**
 * Retry an upload-style network call up to 3 times against bare
 * fetch failures, e.g. React Native's "Network request failed" that
 * sometimes drops a multipart POST mid-transfer on flaky LTE (Android
 * in particular). Real backend errors (4xx, 5xx) surface as ApiError
 * and bypass retry — they're the server's verdict and deserve real
 * handling (limit hit, file too large, validation failure, 402).
 *
 * Backoff is 400 ms after attempt 1, 1200 ms after attempt 2 — total
 * worst-case extra wait ~1.6 s before failing for real. Wrap any
 * multipart upload (`api.uploadDocument`, `api.askPhoto`,
 * `api.answerSavePhoto`, `api.uploadAvatar`) so the typical "good
 * connection, dropped packet" hiccup is invisible to the user.
 */
export async function uploadWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_TRIES = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e instanceof ApiError) throw e;
      if (attempt < MAX_TRIES) {
        await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
      }
    }
  }
  throw lastErr;
}

/* Typed, intention-revealing wrappers — one per endpoint. Each comment links
   to the backend handler so future-me knows where the truth lives. */
export const api = {
  // --- Public ---
  healthz: () => GET<HealthzResponse>('/healthz', undefined, false),
  plans: () => GET<PlansResponse>('/plans', undefined, false),

  // --- Profile + access ---
  dashboard: () => GET<Dashboard>('/dashboard'),
  meAccess: () => GET<MeAccess>('/me/access'),
  updateSettings: (body: SettingsBody) => POST<SettingsResponse>('/settings', body),
  // Upload a profile photo. Single image under the multipart field name
  // "file" (mirrors uploadDocument's pattern); the backend stores it at
  // {user_id}/avatar.jpg in the "uploads" bucket and returns the storage
  // KEY as avatar_url. Resolve that key via signedUrl() to render it.
  uploadAvatar: (form: FormData) => UPLOAD<{ avatar_url: string }>('/me/avatar', form),
  deleteAccount: () => DELETE<AccountDeletedResponse>('/me/account'),
  clearMyData: () => DELETE<{ cleared: true }>('/me/data'),

  // --- Files ---
  signedUrl: (path: string) => GET<{ url: string }>('/files/signed-url', { path }),

  // --- Documents ---
  // Upload contract: the multipart field name is always "files", carrying
  // 1..N files (even for a single file). Callers build the FormData with one
  // or more form.append('files', ...) entries; the backend reads
  // files: list[UploadFile]. Returns {document_id}.
  uploadDocument: (form: FormData) => UPLOAD<UploadResponse>('/upload', form),
  getDocument: (id: string) => GET<DocumentDetail>(`/documents/${id}`),
  deleteDocument: (id: string) => DELETE<DeletedResponse>(`/documents/${id}`),
  documentProgress: (id: string) => GET<DocumentProgress>(`/documents/${id}/progress`),
  // Re-runs ingestion from the stored source files. The backend resumes from
  // the existing ingest_cursor (it does NOT reset progress) and flips status
  // back to "processing" so the ingest screen can resume polling. Returns
  // {document_id, status}. 400 if the original source files are gone.
  reprocessDocument: (documentId: string) =>
    POST<ReprocessResponse>(`/documents/${documentId}/reprocess`),
  summarize: (id: string, body: { topic?: string; level: Level }) =>
    POST<SummarizeResponse>(`/documents/${id}/summarize`, body),

  // --- Chat sessions ---
  createSession: (body: { document_id: string; level: Level; mode?: 'ask' | 'teach'; title?: string }) =>
    POST<NewSessionResponse>('/session', body),
  listSessions: (query: { document_id?: string; limit?: number }) =>
    GET<SessionsResponse>('/sessions', query),
  sessionMessages: (sessionId: string, limit = 200) =>
    GET<MessagesResponse>(`/sessions/${sessionId}/messages`, { limit }),

  // --- Ask ---
  ask: (body: { session_id: string; document_id: string; question: string; level: Level }) =>
    POST<AskResponse>('/ask', body),
  askPhoto: (form: FormData) => UPLOAD<AskPhotoResponse>('/ask-photo', form),

  // --- Teach ---
  lessonStart: (body: { document_id: string; level: Level; focus_area_id?: string | null }) =>
    POST<NewSessionResponse>('/lesson/start', body),
  lessonNext: (sessionId: string) =>
    POST<LessonNextResponse>('/lesson/next', { session_id: sessionId }),
  lessonAdvance: (sessionId: string, opts?: { skip?: boolean }) =>
    POST<{ done: boolean; current_outline_point: number }>('/lesson/advance', { session_id: sessionId, skip: opts?.skip ?? false }),
  lessonReset: (sessionId: string) =>
    POST<{ reset: true }>('/lesson/reset', { session_id: sessionId }),
  sessionDelete: (sessionId: string) =>
    DELETE<DeletedResponse>(`/sessions/${sessionId}`),

  // --- Assessment ---
  assessmentEstimate: (query: { kind?: AssessmentKind; format?: AssessmentFormat; num_questions?: number }) =>
    GET<AssessmentEstimate>('/assessment/estimate', query),
  assessmentCreate: (body: {
    document_id: string;
    kind?: AssessmentKind;
    format?: AssessmentFormat;
    level?: Level;
    num_questions?: number;
    time_limit_seconds?: number;
    topic?: string;
    focus_area_id?: string;
  }) => POST<AssessmentCreateResponse>('/assessment/create', body),
  assessmentStart: (assessmentId: string) =>
    POST<AssessmentStartResponse>('/assessment/start', { assessment_id: assessmentId }),
  assessmentTime: (assessmentId: string) =>
    GET<AssessmentTimeResponse>(`/assessment/${assessmentId}/time`),
  answerSave: (body: { assessment_id: string; question_id: string; student_answer: string }) =>
    POST<AnswerSaveResponse>('/answer/save', body),
  answerSavePhoto: (form: FormData) => UPLOAD<{ read_back: string }>('/answer/save-photo', form),
  assessmentSubmit: (assessmentId: string) =>
    POST<AssessmentSubmitResponse>('/assessment/submit', { assessment_id: assessmentId }),
  answerDispute: (answerId: string, reason: string) =>
    POST<DisputeResponse>(`/answer/${answerId}/dispute`, { reason }),

  // --- History + revision ---
  historyList: () => GET<HistoryListResponse>('/history'),
  historyDetail: (assessmentId: string) =>
    GET<HistoryDetailResponse>(`/history/${assessmentId}`),
  revisionMisses: (documentId: string) =>
    GET<MissesResponse>(`/revision/${documentId}/misses`),
  revisionPractice: (body: { document_id: string; level: Level; num_questions?: number }) =>
    POST<PracticeResponse>('/revision/practice', body),

  // --- Flashcards ---
  flashcardsGenerate: (body: { document_id: string; num?: number; level?: Level; focus_area_id?: string }) =>
    POST<CardsResponse>('/flashcards/generate', body),
  flashcardsDue: (query: { document_id?: string; limit?: number }) =>
    GET<CardsResponse>('/flashcards/due', query),
  flashcardsForDocument: (documentId: string) =>
    GET<CardsResponse>(`/documents/${documentId}/flashcards`),
  flashcardReview: (cardId: string, rating: number) =>
    POST<ReviewResponse>(`/flashcards/${cardId}/review`, { rating }),
  flashcardDelete: (cardId: string) => DELETE<DeletedResponse>(`/flashcards/${cardId}`),

  // --- Focus areas ---
  focusCreate: (body: { document_id: string; name: string; topics: string[]; exam_date?: string | null }) =>
    POST<FocusArea>('/focus-areas', body),
  focusList: (documentId: string) =>
    GET<FocusAreasResponse>('/focus-areas', { document_id: documentId }),
  focusListAll: () =>
    GET<{ focus_areas: (import('./types').FocusArea & { document_title: string })[] }>('/focus-areas/all'),
  focusGet: (id: string) => GET<FocusArea>(`/focus-areas/${id}`),
  focusUpdate: (id: string, body: { name?: string; topics?: string[]; exam_date?: string | null }) =>
    PATCH<FocusArea>(`/focus-areas/${id}`, body),
  focusDelete: (id: string) => DELETE<DeletedResponse>(`/focus-areas/${id}`),
};

export type Api = typeof api;
