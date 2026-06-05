import * as Speech from 'expo-speech';

type Cbs = {
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (e: unknown) => void;
};

export function speakLesson(text: string, cbs: Cbs = {}) {
  Speech.speak(text, {
    onDone: cbs.onDone,
    onStopped: cbs.onStopped,
    onError: cbs.onError,
  });
}

export function stopSpeaking() {
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
