import * as Speech from 'expo-speech';

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
  return s
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
