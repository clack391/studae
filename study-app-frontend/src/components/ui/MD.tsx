import { useMemo } from 'react';
import Markdown from 'react-native-markdown-display';
import { F, useTheme } from '@/lib/theme';

// Tuned so lesson bodies, summaries, and grading reasoning read sharply on
// the paper background. Body is 15 px / lh 24 with ink-color text.
function makeStyles(C: ReturnType<typeof useTheme>) {
  return {
    body:        { fontSize: 15, color: C.ink, lineHeight: 24 },
    paragraph:   { marginTop: 0, marginBottom: 12 },
    heading1:    { fontFamily: F.hand, fontSize: 26, color: C.ink, marginTop: 16, marginBottom: 6, lineHeight: 38, paddingBottom: 5, letterSpacing: 0.3 },
    heading2:    { fontFamily: F.hand, fontSize: 22, color: C.ink, marginTop: 14, marginBottom: 6, lineHeight: 32, paddingBottom: 4, letterSpacing: 0.3 },
    heading3:    { fontFamily: F.hand, fontSize: 19, color: C.ink, marginTop: 12, marginBottom: 6, lineHeight: 28, paddingBottom: 4, letterSpacing: 0.3 },
    heading4:    { fontFamily: F.hand, fontSize: 17, color: C.ink, marginTop: 10, marginBottom: 4, lineHeight: 26, paddingBottom: 3, letterSpacing: 0.3 },
    hr:          { backgroundColor: C.line, height: 1, marginVertical: 14 },
    strong:      { fontWeight: '800' as const, color: C.ink },
    em:          { fontStyle: 'italic' as const, color: C.ink },
    bullet_list: { marginTop: 0, marginBottom: 10 },
    ordered_list:{ marginTop: 0, marginBottom: 10 },
    list_item:   { marginVertical: 3 },
    bullet_list_icon: { color: C.accent, marginRight: 8, lineHeight: 24, fontSize: 15 },
    ordered_list_icon: { color: C.accent, marginRight: 6, lineHeight: 24, fontSize: 15, fontWeight: '700' as const },
    code_inline: { backgroundColor: C.card2, color: C.ink, paddingHorizontal: 5, borderRadius: 4, fontFamily: 'monospace', fontSize: 13.5 },
    code_block:  { backgroundColor: C.card2, color: C.ink, padding: 10, borderRadius: 8, fontFamily: 'monospace', fontSize: 13, marginVertical: 8 },
    fence:       { backgroundColor: C.card2, color: C.ink, padding: 10, borderRadius: 8, fontFamily: 'monospace', fontSize: 13, marginVertical: 8 },
    blockquote:  { backgroundColor: C.card2, borderLeftWidth: 3, borderColor: C.accent, paddingLeft: 12, paddingVertical: 6, marginVertical: 8 },
    link:        { color: C.accent, textDecorationLine: 'underline' as const },
    table:       { borderWidth: 1, borderColor: C.line, marginVertical: 10 },
    th:          { backgroundColor: C.card2, padding: 7, fontWeight: '700' as const, color: C.ink },
    td:          { padding: 7, borderColor: C.line, borderTopWidth: 1, color: C.ink },
  };
}

export function MD({ children }: { children: string }) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  return <Markdown style={styles}>{children}</Markdown>;
}
