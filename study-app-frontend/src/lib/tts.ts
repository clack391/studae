import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Voice = { id: string; name: string };

// Selected TTS voice. Voice identifiers are device-specific (they come from
// Speech.getAvailableVoicesAsync), so this is persisted locally rather than on
// the server. Hydrated on module load into a module var so the synchronous
// speakLesson can read it without awaiting.
const VOICE_KEY = 'studae.ttsVoice';
let _voiceId: string | undefined;
let _voiceMeta: Voice | null = null;
AsyncStorage.getItem(VOICE_KEY)
  .then((raw) => {
    if (!raw) return;
    try {
      const v = JSON.parse(raw) as Voice;
      _voiceMeta = v;
      _voiceId = v?.id || undefined;
    } catch {
      _voiceId = raw || undefined;
    }
  })
  .catch(() => {});

/** All voices the device's TTS engine offers (empty list on failure). */
export async function listVoices(): Promise<Speech.Voice[]> {
  try {
    return await Speech.getAvailableVoicesAsync();
  } catch {
    return [];
  }
}

export type CuratedVoice = { id: string; name: string; accent: string; gender?: 'female' | 'male' };

// Allowlist of natural-sounding human English voices (Apple), male + female
// across accents. We curate by name rather than blocklisting junk so the
// picker NEVER shows the novelty/robotic voices (Bells, Boing, Zarvox,
// Whisper, Trinoids, Fred, Albert, the Eloquence character voices, ...).
const VOICE_GENDER: Record<string, 'female' | 'male'> = {
  // American
  samantha: 'female', allison: 'female', ava: 'female', susan: 'female',
  nicky: 'female', zoe: 'female', joelle: 'female', noelle: 'female',
  aaron: 'male', tom: 'male', evan: 'male', nathan: 'male',
  // British
  kate: 'female', serena: 'female', stephanie: 'female', martha: 'female',
  daniel: 'male', oliver: 'male', arthur: 'male',
  // Australian
  karen: 'female', matilda: 'female', catherine: 'female', lee: 'male',
  // Irish / South African / Indian
  moira: 'female', tessa: 'female', veena: 'female', rishi: 'male',
};

const ACCENT_BY_LANG: Record<string, string> = {
  'en-us': 'American', 'en-gb': 'British', 'en-au': 'Australian', 'en-ie': 'Irish',
  'en-za': 'South African', 'en-in': 'Indian', 'en-nz': 'New Zealand', 'en-sc': 'Scottish',
};
function accentFor(lang?: string): string {
  const l = (lang || '').toLowerCase();
  return ACCENT_BY_LANG[l] || (l.startsWith('en') ? 'English' : (lang || ''));
}
const isEnhanced = (q: unknown) => String(q ?? '').toLowerCase().includes('enhanced');
const ACCENT_ORDER = ['American', 'British', 'Australian', 'Irish', 'South African', 'Indian', 'New Zealand', 'Scottish', 'English'];

/**
 * Up to 20 natural human voices to offer in the picker. iOS: matches the
 * allowlist above by voice name (picking the highest-quality variant per
 * name). Fallback (e.g. Android, whose ids are not human names, or a device
 * with none of the allowlisted voices): English voices minus obvious
 * novelty/robotic ones, so the list is never empty.
 */
export async function listCuratedVoices(): Promise<CuratedVoice[]> {
  const all = await listVoices();
  const byName = new Map<string, Speech.Voice>();
  for (const v of all) {
    if (!(v.language || '').toLowerCase().startsWith('en')) continue;
    const key = (v.name || '').trim().toLowerCase();
    if (!(key in VOICE_GENDER)) continue;
    const cur = byName.get(key);
    if (!cur || (isEnhanced(v.quality) && !isEnhanced(cur.quality))) byName.set(key, v);
  }
  let out: CuratedVoice[] = [...byName.values()].map((v) => ({
    id: v.identifier,
    name: v.name,
    accent: accentFor(v.language),
    gender: VOICE_GENDER[(v.name || '').trim().toLowerCase()],
  }));

  if (out.length < 3) {
    const NOVELTY = /bells|boing|bubbl|bahh|cellos|wobble|whisper|zarvox|trinoid|organ|jester|good news|bad news|albert|fred|junior|ralph|bruce|agnes|deranged|hysterical|princess|superstar|pipe|eloquence|grandma|grandpa|rocko|shelley|sandy|flo|reed|eddy/i;
    const seen = new Set<string>();
    out = all
      .filter((v) => (v.language || '').toLowerCase().startsWith('en'))
      .filter((v) => !NOVELTY.test(v.name || '') && !NOVELTY.test(v.identifier || ''))
      .filter((v) => (seen.has(v.identifier) ? false : (seen.add(v.identifier), true)))
      .map((v) => {
        const id = (v.identifier || '').toLowerCase();
        const gender = id.includes('female') ? ('female' as const) : id.includes('male') ? ('male' as const) : undefined;
        return { id: v.identifier, name: v.name || v.identifier, accent: accentFor(v.language), gender };
      });
  }

  out.sort((a, b) => {
    const ai = ACCENT_ORDER.indexOf(a.accent), bi = ACCENT_ORDER.indexOf(b.accent);
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    if (a.gender !== b.gender) return a.gender === 'female' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out.slice(0, 20);
}

/** The currently chosen voice, or null for the device default. */
export async function getTtsVoice(): Promise<Voice | null> {
  if (_voiceMeta) return _voiceMeta;
  const raw = await AsyncStorage.getItem(VOICE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Voice;
    _voiceMeta = v;
    _voiceId = v?.id || undefined;
    return v;
  } catch {
    return null;
  }
}

/** Choose a voice (null = device default). Persists + updates the cache. */
export async function setTtsVoice(v: Voice | null): Promise<void> {
  _voiceMeta = v;
  _voiceId = v?.id || undefined;
  if (v) await AsyncStorage.setItem(VOICE_KEY, JSON.stringify(v));
  else await AsyncStorage.removeItem(VOICE_KEY);
}

/** Speak a short sample with a specific voice so the user can hear it while
 *  choosing. Stops any current speech first. */
export function previewVoice(voiceId?: string) {
  Speech.stop();
  Speech.speak('Hi, this is how I will read your lessons aloud.', {
    voice: voiceId,
    rate: SPEECH_RATE,
  });
}

type Cbs = {
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (e: unknown) => void;
};

// Expo Speech has a hard 4000-char limit per Speech.speak call. Long
// lessons easily exceed this and the native side rejects the whole
// utterance, leaving the user with no audio. Cap a bit below the limit
// to leave room for whatever transformations the platform applies (TTS
// engines sometimes expand abbreviations / punctuation internally).
const CHUNK_LIMIT = 3500;

// Speaking rate passed to every Speech.speak call. 1.0 is the engine default,
// which reads noticeably fast; 0.8 is a calmer, more lesson-friendly pace.
// Lower = slower. Adjust here to change the read-aloud speed app-wide.
const SPEECH_RATE = 0.8;

// Module-level cancellation token. Each speakLesson call bumps the
// generation; if a chunk's onDone fires while a NEWER speak is in
// flight (or after stopSpeaking), we drop it instead of advancing.
let speakGen = 0;

/**
 * Split text into TTS-friendly chunks under CHUNK_LIMIT. Tries to
 * break on a sentence boundary, then any whitespace, then a hard
 * cut at the limit. Empty input returns an empty array.
 */
function chunkForSpeech(text: string): string[] {
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > CHUNK_LIMIT) {
    // Look for the last sentence-ending punctuation inside the window.
    // Prefer .?! at the end of a sentence; fall back to a newline; fall
    // back to any whitespace; fall back to a hard cut.
    const window = remaining.slice(0, CHUNK_LIMIT);
    let cut = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('\n'),
    );
    if (cut < CHUNK_LIMIT * 0.5) {
      // No sentence break in the upper half — try any whitespace, then
      // accept a mid-word cut as last resort.
      cut = window.lastIndexOf(' ');
      if (cut < CHUNK_LIMIT * 0.5) cut = CHUNK_LIMIT - 1;
    }
    out.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1);
  }
  if (remaining.trim()) out.push(remaining.trim());
  return out;
}

export function speakLesson(text: string, cbs: Cbs = {}) {
  const chunks = chunkForSpeech(text);
  if (!chunks.length) {
    cbs.onDone?.();
    return;
  }
  const gen = ++speakGen;
  let idx = 0;

  function next() {
    // Bail if a newer speak started or stopSpeaking was called between
    // utterances. Without this, the previous lesson's tail could keep
    // playing over the new one's start.
    if (gen !== speakGen) return;
    if (idx >= chunks.length) {
      cbs.onDone?.();
      return;
    }
    const chunk = chunks[idx++];
    Speech.speak(chunk, {
      voice: _voiceId,
      rate: SPEECH_RATE,
      onDone: () => {
        if (gen !== speakGen) return;
        next();
      },
      onStopped: cbs.onStopped,
      onError: cbs.onError,
    });
  }
  next();
}

export function stopSpeaking() {
  // Invalidate any in-flight speakLesson chunk chain so its onDone
  // callback can't advance to the next chunk after we stop.
  speakGen++;
  Speech.stop();
}

// ---- Math / chemistry to speech ------------------------------------------
// Lesson/summary/answer content can contain LaTeX ($...$, $$...$$) and mhchem
// (\ce{...}) now that the UI typesets math. Read aloud, raw LaTeX is gibberish
// ("dollar backslash sqrt brace"). mathToSpeech turns it into words. It is
// deliberately heuristic: it covers school-level maths / physics / chemistry
// well rather than being a complete LaTeX speech engine.

const GREEK: Record<string, string> = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta',
  epsilon: 'epsilon', zeta: 'zeta', eta: 'eta', theta: 'theta',
  kappa: 'kappa', lambda: 'lambda', mu: 'mu', nu: 'new', xi: 'ksai',
  pi: 'pie', rho: 'row', sigma: 'sigma', tau: 'tow', phi: 'fie',
  chi: 'kai', psi: 'sigh', omega: 'omega', Delta: 'delta', Sigma: 'sigma',
  Omega: 'omega', Theta: 'theta', Phi: 'fie', Pi: 'pie', nabla: 'del',
};

const OPS: Record<string, string> = {
  times: ' times ', cdot: ' dot ', div: ' divided by ',
  pm: ' plus or minus ', mp: ' minus or plus ', approx: ' approximately ',
  neq: ' not equal to ', ne: ' not equal to ',
  leq: ' less than or equal to ', le: ' less than or equal to ',
  geq: ' greater than or equal to ', ge: ' greater than or equal to ',
  rightarrow: ' approaches ', to: ' approaches ', leftarrow: ' from ',
  infty: ' infinity ', sum: ' the sum of ', prod: ' the product of ',
  int: ' the integral of ', partial: ' partial ', propto: ' proportional to ',
  cdots: ' and so on ', ldots: ' and so on ', dots: ' and so on ',
  circ: ' degrees ', degree: ' degrees ',
};

// Convert one mhchem body, e.g. "2H2 + O2 -> 2H2O" -> "2 H 2 plus O 2 yields..".
function chemToWords(body: string): string {
  return body
    .replace(/<=>>?|<->/g, ' in equilibrium with ')
    .replace(/->|→/g, ' yields ')
    .replace(/\+/g, ' plus ')
    .replace(/\(\s*(aq|s|l|g)\s*\)/g, ' $1 ')
    // split before each element symbol (uppercase) so "SO4" -> "S O 4",
    // "NH3" -> "N H 3", while two-letter symbols like "Na"/"Cl" stay intact
    .replace(/([A-Za-z0-9])(?=[A-Z])/g, '$1 ')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    // speak grouping brackets, e.g. Ca(OH)2 -> "Ca open bracket O H close bracket 2"
    .replace(/\(/g, ' open bracket ')
    .replace(/\)/g, ' close bracket ')
    .replace(/[{}^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Convert the inside of a math span to words.
function texToWords(tex: string): string {
  let s = tex;
  s = s.replace(/\\ce\s*\{([^}]*)\}/g, (_m, b) => ' ' + chemToWords(b) + ' ');
  s = s.replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 over $2 ');
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, ' the square root of ($1) ');
  s = s.replace(/\\vec\s*\{([^{}]*)\}/g, ' vector $1 ');
  s = s.replace(/\\(hat|bar|dot|tilde)\s*\{([^{}]*)\}/g, ' $2 $1 ');
  s = s.replace(/\\text\s*\{([^{}]*)\}/g, ' $1 ');
  s = s.replace(/\^\s*\{?\s*2\s*\}?/g, ' squared ');
  s = s.replace(/\^\s*\{?\s*3\s*\}?/g, ' cubed ');
  s = s.replace(/\^\s*\{([^{}]*)\}/g, ' to the power $1 ');
  s = s.replace(/\^\s*(\w)/g, ' to the power $1 ');
  s = s.replace(/_\s*\{([^{}]*)\}/g, ' sub $1 ');
  s = s.replace(/_\s*(\w)/g, ' sub $1 ');
  s = s.replace(/\\([A-Za-z]+)/g, (_m, name: string) => {
    if (GREEK[name]) return ' ' + GREEK[name] + ' ';
    if (OPS[name]) return OPS[name];
    if (name === 'left' || name === 'right' || name === 'displaystyle') return '';
    return ' ' + name + ' ';
  });
  s = s
    .replace(/\|([^|]+)\|/g, ' the magnitude of $1 ')
    // Speak grouping brackets so "(a+b) squared" is not heard as "a+b squared".
    .replace(/\(/g, ' open bracket ')
    .replace(/\)/g, ' close bracket ')
    .replace(/\[/g, ' open square bracket ')
    .replace(/\]/g, ' close square bracket ')
    .replace(/=/g, ' equals ')
    .replace(/\+/g, ' plus ')
    .replace(/-/g, ' minus ')
    .replace(/\*/g, ' times ')
    .replace(/</g, ' less than ')
    .replace(/>/g, ' greater than ')
    .replace(/[{}]/g, ' ')
    .replace(/\\[,;!:>]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// Replace LaTeX / mhchem in a full string with speakable words. Delimited math
// ($$..$$, \[..\], \(..\), $..$) is converted; a bare "$5" price is left alone.
export function mathToSpeech(s: string): string {
  let out = s
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, m) => ' ' + texToWords(m) + ' ')
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, m) => ' ' + texToWords(m) + ' ')
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, m) => ' ' + texToWords(m) + ' ')
    .replace(/\$([^$\n]+)\$/g, (full, m) =>
      /[\\^_{}=|]|[A-Za-z]\d|\d[A-Za-z]/.test(m) ? ' ' + texToWords(m) + ' ' : full);
  // any \ce{...} that was not wrapped in math delimiters (older content / chat)
  out = out.replace(/\\ce\s*\{([^}]*)\}/g, (_m, b) => ' ' + chemToWords(b) + ' ');
  return out;
}

/**
 * Remove markdown syntax so TTS reads the actual content, not "hash hash
 * star star important star star". Two earlier copies of this lived in
 * teach.tsx and summary/[docId].tsx with a tighter regex that missed
 * common cases:
 *   - "##Heading" (no space after the hashes)
 *   - Stray `|` from tables
 *   - Standalone "***" / "---" horizontal rules
 *   - "***bold italic***"
 *   - Footnote markers like "[^1]"
 *   - Block quote markers nested with content
 * This consolidated version handles all of those.
 */
export function stripMarkdown(s: string): string {
  // Math first: convert LaTeX/mhchem to words before the markdown passes,
  // which would otherwise mangle subscripts (the `_x_` italic rule) and leave
  // raw "$ \sqrt { }" for TTS to read literally.
  return mathToSpeech(s)
    // Code fences: drop entirely, the contents are usually code and we
    // don't want TTS to read code aloud.
    .replace(/```[\s\S]*?```/g, ' ')
    // Inline code: keep the content, drop the backticks.
    .replace(/`([^`]+)`/g, '$1')
    // Images: drop completely.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    // Links: keep the label text, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Footnote markers like [^1] or [^note].
    .replace(/\[\^[^\]]+\]/g, ' ')
    // Headings at line start. Match any number of `#` with optional
    // following whitespace, so "##Heading" and "# Heading" both clean
    // up. Previous regex required the trailing space.
    .replace(/^#+\s*/gm, '')
    // Strikethrough.
    .replace(/~~([^~]+)~~/g, '$1')
    // Bold-italic (***x***) handled before bold (**x**) before italic (*x*).
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Block-quote markers (possibly nested like ">>") at line start.
    .replace(/^>+\s*/gm, '')
    // Bullet markers at line start.
    .replace(/^[-*+]\s+/gm, '')
    // Horizontal rule lines (--- *** ___).
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    // Table pipes: read as a soft pause, not "pipe pipe pipe".
    .replace(/\s*\|\s*/g, ', ')
    // Final nuclear pass: any remaining `#` or `*` characters that survived
    // the structured passes get stripped. Covers mid-line `#tags`, lone
    // asterisks Claude sometimes drops for emphasis (`*important*` without
    // close), and other malformed markdown that the line-anchored regexes
    // above won't catch. We deliberately leave `_` and `` ` `` alone since
    // they appear legitimately in code, variable names, and formulas.
    .replace(/[#*]/g, '')
    // Collapse extra whitespace so TTS doesn't pause oddly.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();
}
