/**
 * Backend shape probe.
 *
 * Usage:
 *   node scripts/probe-backend.mjs <email> <password>
 *
 * Hits every read-only endpoint on the local backend, validates each response
 * against the shapes declared in src/lib/types.ts, and prints a pass/fail
 * report. Pure reads only — no Claude calls, no plan-cap charges, except a
 * single create+delete cycle on /focus-areas to verify its shape (free).
 *
 * The write-side endpoints (/ask, /lesson/next, /assessment/create+submit,
 * /flashcards/generate, /documents/{id}/summarize, /upload) cost real money
 * and are already covered by Studae/study-app-backend/tests/smoke_test.py.
 * Run that separately when you want full coverage.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- load .env -----------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(here, '..', '.env'), 'utf-8');
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SUPA_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:8000';

if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('usage: node scripts/probe-backend.mjs <email> <password>');
  process.exit(1);
}

// --- sign in via Supabase Auth REST (no JS client → no WebSocket dep) ---
const tokenRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!tokenRes.ok) {
  const t = await tokenRes.text();
  console.error(`sign-in failed (HTTP ${tokenRes.status}): ${t.slice(0, 300)}`);
  process.exit(1);
}
const authJson = await tokenRes.json();
const TOKEN = authJson.access_token;
console.log(`signed in as ${authJson.user.email}\nbackend: ${BASE}\n`);

// --- helpers -------------------------------------------------------------
const passed = [];
const failed = [];

async function call(path, { method = 'GET', body, query, auth = true } = {}) {
  let url = BASE + path;
  if (query) {
    const q = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (q) url += (path.includes('?') ? '&' : '?') + q;
  }
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${TOKEN}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${typeof j === 'string' ? j.slice(0, 200) : JSON.stringify(j).slice(0, 200)}`);
  }
  return j;
}

function missing(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return keys.map((k) => `not an object`);
  return keys.filter((k) => !(k in obj));
}

async function probe(name, fn, validate) {
  try {
    const data = await fn();
    const issues = validate ? validate(data) : [];
    if (issues.length) {
      failed.push({ name, issues });
      console.log(`✗ ${name}`);
      for (const i of issues) console.log(`    ${i}`);
    } else {
      passed.push(name);
      console.log(`✓ ${name}`);
    }
    return data;
  } catch (e) {
    failed.push({ name, issues: [e.message] });
    console.log(`✗ ${name} — ${e.message}`);
    return null;
  }
}

// --- public --------------------------------------------------------------
console.log('Public');
await probe('GET /healthz', () => call('/healthz', { auth: false }), (o) => missing(o, 'ok'));
await probe('GET /plans', () => call('/plans', { auth: false }), (o) => {
  const issues = missing(o, 'plans');
  if (Array.isArray(o?.plans) && o.plans[0]) {
    issues.push(...missing(o.plans[0], 'id', 'code', 'name', 'price_cents', 'currency', 'max_documents', 'max_questions', 'max_assessments').map((s) => `plans[0] missing '${s}'`));
  }
  return issues;
});

// --- profile + access ---------------------------------------------------
console.log('\nProfile + access');
const dash = await probe('GET /dashboard', () => call('/dashboard'), (o) =>
  missing(o, 'name', 'plan', 'trial_ends_at', 'preferred_level', 'tts_enabled', 'documents_count', 'documents', 'assessments_taken', 'average_score_percent', 'recent_assessments'),
);
if (dash?.documents?.[0]) {
  const d = dash.documents[0];
  for (const k of ['id', 'title', 'status', 'progress', 'created_at']) {
    if (!(k in d)) failed.push({ name: 'GET /dashboard documents[0]', issues: [`missing '${k}'`] });
  }
}
if (dash?.recent_assessments?.[0]) {
  const a = dash.recent_assessments[0];
  for (const k of ['id', 'kind', 'score', 'total_points', 'level', 'submitted_at', 'document_id']) {
    if (!(k in a)) failed.push({ name: 'GET /dashboard recent_assessments[0]', issues: [`missing '${k}'`] });
  }
}

const access = await probe('GET /me/access', () => call('/me/access'), (o) => {
  const issues = missing(o, 'state', 'usage', 'limits');
  if (o?.state) issues.push(...missing(o.state, 'plan', 'active', 'reason').map((s) => `state missing '${s}'`));
  if (o?.usage) issues.push(...missing(o.usage, 'questions', 'assessments').map((s) => `usage missing '${s}'`));
  if (o?.limits) issues.push(...missing(o.limits, 'documents', 'questions', 'assessments').map((s) => `limits missing '${s}'`));
  return issues;
});

const history = await probe('GET /history', () => call('/history'), (o) => missing(o, 'assessments'));
if (history?.assessments?.[0]) {
  const a = history.assessments[0];
  for (const k of ['id', 'document_id', 'kind', 'format', 'level', 'score', 'total_points', 'submitted_at']) {
    if (!(k in a)) failed.push({ name: 'GET /history assessments[0]', issues: [`missing '${k}'`] });
  }
}

// --- document-scoped (only if there's a ready doc) ----------------------
const readyDoc = dash?.documents?.find((d) => d.status === 'ready');
if (!readyDoc) {
  console.log('\nNo ready document on this account — skipping document-scoped probes.');
} else {
  console.log(`\nDocument-scoped (using ${readyDoc.id})`);
  await probe(`GET /documents/{id}`, () => call(`/documents/${readyDoc.id}`), (o) =>
    missing(o, 'id', 'title', 'status', 'page_count', 'outline_points', 'topics_total', 'topics_taught'),
  );
  await probe(`GET /documents/{id}/progress`, () => call(`/documents/${readyDoc.id}/progress`), (o) =>
    missing(o, 'document_id', 'title', 'topics_total', 'topics_taught', 'assessments_taken', 'average_score_percent', 'flashcards_in_library', 'flashcards_mastered'),
  );
  const sessions = await probe('GET /sessions?document_id=', () => call('/sessions', { query: { document_id: readyDoc.id, limit: 5 } }), (o) =>
    missing(o, 'sessions'),
  );
  if (sessions?.sessions?.[0]) {
    const s = sessions.sessions[0];
    for (const k of ['id', 'mode', 'level', 'document_id', 'title', 'current_outline_point', 'focus_area_id', 'created_at']) {
      if (!(k in s)) failed.push({ name: 'GET /sessions[0]', issues: [`missing '${k}'`] });
    }
    await probe(`GET /sessions/{id}/messages`, () => call(`/sessions/${sessions.sessions[0].id}/messages`, { query: { limit: 10 } }), (o) =>
      missing(o, 'messages'),
    );
  }
  await probe(`GET /focus-areas?document_id=`, () => call('/focus-areas', { query: { document_id: readyDoc.id } }), (o) =>
    missing(o, 'focus_areas'),
  );
  await probe(`GET /documents/{id}/flashcards`, () => call(`/documents/${readyDoc.id}/flashcards`), (o) => missing(o, 'cards'));
  await probe(`GET /flashcards/due?document_id=`, () => call('/flashcards/due', { query: { document_id: readyDoc.id, limit: 5 } }), (o) => missing(o, 'cards'));
  await probe(`GET /revision/{doc}/misses`, () => call(`/revision/${readyDoc.id}/misses`), (o) => missing(o, 'misses'));
  await probe(`GET /assessment/estimate`, () => call('/assessment/estimate', { query: { kind: 'test', format: 'mixed', num_questions: 4 } }), (o) =>
    missing(o, 'kind', 'format', 'num_questions', 'estimated_time_seconds', 'rule'),
  );

  // --- focus-area CRUD cycle (free, no AI) ----------------------------
  console.log('\nFocus-area CRUD cycle');
  let created;
  await probe('POST /focus-areas', async () => {
    created = await call('/focus-areas', {
      method: 'POST',
      body: { document_id: readyDoc.id, name: 'probe focus', topics: ['key terms'], exam_date: '2027-01-01' },
    });
    return created;
  }, (o) => missing(o, 'id', 'name', 'topics', 'exam_date', 'document_id'));

  if (created?.id) {
    await probe('GET /focus-areas/{id}', () => call(`/focus-areas/${created.id}`), (o) => missing(o, 'id', 'topics'));
    await probe('PATCH /focus-areas/{id}', () => call(`/focus-areas/${created.id}`, { method: 'PATCH', body: { name: 'probe focus (renamed)' } }), (o) => missing(o, 'name'));
    await probe('DELETE /focus-areas/{id}', () => call(`/focus-areas/${created.id}`, { method: 'DELETE' }), (o) => missing(o, 'deleted'));
  }
}

// --- report --------------------------------------------------------------
console.log(`\n${passed.length} passed, ${failed.length} failed.`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) {
    console.log(`  ${f.name}`);
    for (const i of f.issues) console.log(`    - ${i}`);
  }
  process.exit(1);
}
