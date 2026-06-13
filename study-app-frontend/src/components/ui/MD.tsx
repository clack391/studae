import { useMemo } from 'react';
import Markdown from 'react-native-markdown-display';
import { bodyFont, F, ReadingFont, useReadingFont, useTextScale, useTheme } from '@/lib/theme';
import { MathHTML } from './MathHTML';

// Detects LaTeX / chemistry math so only those bodies pay the WebView cost;
// plain markdown keeps the native renderer. Matches $$...$$ display math, an
// inline $...$ pair whose contents look mathematical (so a bare "$5" price is
// NOT treated as math), \( / \[ delimiters, or a known LaTeX/mhchem command.
const MATH_RE =
  /\$\$[\s\S]+?\$\$|\$[^$\n]*[\\^_{}|][^$\n]*\$|\\[([]|\\(?:ce|frac|sqrt|sum|int|vec|begin|cdot|times|approx|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|Delta|Omega)\b/;

// A ```mermaid``` fenced block means there's a diagram to render in the WebView.
const MERMAID_RE = /```mermaid/;

// True when a string contains LaTeX/chemistry math. Lets callers (test
// questions, MCQ options) keep their own styled <T> for plain text and only
// switch to the math renderer when there's actually math to typeset.
export function hasMath(s: string | null | undefined): boolean {
  return !!s && MATH_RE.test(s);
}

// True when content needs the rich WebView renderer (math OR a Mermaid diagram).
// Exported so screens (test question / review) can decide whether to route a
// field through MD instead of a plain styled <T>.
export function needsRichRender(s: string | null | undefined): boolean {
  return !!s && (MATH_RE.test(s) || MERMAID_RE.test(s));
}

// Tuned so lesson bodies, summaries, and grading reasoning read sharply on
// the paper background. Body is 15 px / lh 24 with ink-color text. Sizes scale
// with the user's reading size; the reading font applies to body text while
// headings keep Kalam (the brand). `s` rounds a base size times the scale.
function makeStyles(C: ReturnType<typeof useTheme>, scale: number, rf: ReadingFont) {
  const s = (n: number) => Math.round(n * scale);
  const reg = bodyFont(rf);
  const bold = bodyFont(rf, true);
  return {
    body:        { fontFamily: reg, fontSize: s(15), color: C.ink, lineHeight: s(24) },
    paragraph:   { marginTop: 0, marginBottom: 12 },
    heading1:    { fontFamily: F.hand, fontSize: s(26), color: C.ink, marginTop: 16, marginBottom: 6, lineHeight: s(38), paddingBottom: 5, letterSpacing: 0.3 },
    heading2:    { fontFamily: F.hand, fontSize: s(22), color: C.ink, marginTop: 14, marginBottom: 6, lineHeight: s(32), paddingBottom: 4, letterSpacing: 0.3 },
    heading3:    { fontFamily: F.hand, fontSize: s(19), color: C.ink, marginTop: 12, marginBottom: 6, lineHeight: s(28), paddingBottom: 4, letterSpacing: 0.3 },
    heading4:    { fontFamily: F.hand, fontSize: s(17), color: C.ink, marginTop: 10, marginBottom: 4, lineHeight: s(26), paddingBottom: 3, letterSpacing: 0.3 },
    hr:          { backgroundColor: C.line, height: 1, marginVertical: 14 },
    strong:      { fontFamily: bold, fontWeight: '800' as const, color: C.ink },
    em:          { fontFamily: reg, fontStyle: 'italic' as const, color: C.ink },
    bullet_list: { marginTop: 0, marginBottom: 10 },
    ordered_list:{ marginTop: 0, marginBottom: 10 },
    list_item:   { marginVertical: 3 },
    bullet_list_icon: { color: C.accent, marginRight: 8, lineHeight: s(24), fontSize: s(15) },
    ordered_list_icon: { color: C.accent, marginRight: 6, lineHeight: s(24), fontSize: s(15), fontWeight: '700' as const },
    code_inline: { backgroundColor: C.card2, color: C.ink, paddingHorizontal: 5, borderRadius: 4, fontFamily: 'monospace', fontSize: s(13) },
    code_block:  { backgroundColor: C.card2, color: C.ink, padding: 10, borderRadius: 8, fontFamily: 'monospace', fontSize: s(13), marginVertical: 8 },
    fence:       { backgroundColor: C.card2, color: C.ink, padding: 10, borderRadius: 8, fontFamily: 'monospace', fontSize: s(13), marginVertical: 8 },
    blockquote:  { backgroundColor: C.card2, borderLeftWidth: 3, borderColor: C.accent, paddingLeft: 12, paddingVertical: 6, marginVertical: 8 },
    link:        { fontFamily: reg, color: C.accent, textDecorationLine: 'underline' as const },
    table:       { borderWidth: 1, borderColor: C.line, marginVertical: 10 },
    th:          { fontFamily: bold, backgroundColor: C.card2, padding: 7, fontWeight: '700' as const, color: C.ink },
    td:          { fontFamily: reg, padding: 7, borderColor: C.line, borderTopWidth: 1, color: C.ink },
  };
}

export function MD({ children }: { children: string }) {
  const C = useTheme();
  const scale = useTextScale();
  const rf = useReadingFont();
  const styles = useMemo(() => makeStyles(C, scale, rf), [C, scale, rf]);
  if (children && needsRichRender(children)) {
    return <MathHTML>{children}</MathHTML>;
  }
  return <Markdown style={styles}>{children}</Markdown>;
}
