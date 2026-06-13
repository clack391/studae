import { useMemo } from 'react';
import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { bodyFont, F, ReadingFont, useReadingFont, useTextScale, useTheme } from '@/lib/theme';

type Variant = 'hand' | 'handH2' | 'handH3' | 'handBig' | 'body' | 'bodyB' | 'small' | 'note' | 'mut' | 'label';

// Hand variants use Kalam (see theme.ts) so descenders don't clip on Android.
// 1.4× lineHeight and modest paddingBottom keep glyphs inside their line box.
// Styles are memoised per palette + text scale + reading font. `scale`
// multiplies fontSize / lineHeight / paddingBottom so the rhythm stays intact
// at any reading size. The reading font applies to plain reading variants
// (body / bodyB / small / mut); hand + note variants keep Kalam (the brand).
function makeStyles(
  C: ReturnType<typeof useTheme>,
  scale: number,
  rf: ReadingFont,
): Record<Variant, TextStyle> {
  const s = (n: number) => Math.round(n * scale);
  const reg = bodyFont(rf);
  const bold = bodyFont(rf, true);
  return {
    hand:    { fontFamily: F.hand, fontSize: s(26), color: C.ink, lineHeight: s(36), paddingBottom: s(2), letterSpacing: 0.2 },
    handH2:  { fontFamily: F.hand, fontSize: s(22), color: C.ink, lineHeight: s(30), paddingBottom: s(2), letterSpacing: 0.2 },
    handH3:  { fontFamily: F.hand, fontSize: s(19), color: C.ink, lineHeight: s(26), paddingBottom: s(2), letterSpacing: 0.2 },
    handBig: { fontFamily: F.hand, fontSize: s(34), color: C.ink, lineHeight: s(46), paddingBottom: s(3), letterSpacing: 0.3 },
    body:    { fontFamily: reg, fontSize: s(14), color: C.ink, lineHeight: s(21), fontWeight: '500' },
    bodyB:   { fontFamily: bold, fontSize: s(14), color: C.ink, lineHeight: s(21), fontWeight: '700' },
    small:   { fontFamily: reg, fontSize: s(12), color: C.ink, lineHeight: s(17), fontWeight: '500' },
    note:    { fontFamily: F.note, fontSize: s(14), color: C.ink, lineHeight: s(20) },
    mut:     { fontFamily: reg, fontSize: s(11), color: C.ink2, lineHeight: s(16), fontWeight: '600', letterSpacing: 0.3 },
    label:   { fontFamily: F.note, fontSize: s(13), color: C.ink, marginBottom: s(5), fontWeight: '700' },
  };
}

export function T({ v = 'body', style, ...rest }: TextProps & { v?: Variant }) {
  const C = useTheme();
  const scale = useTextScale();
  const rf = useReadingFont();
  const styles = useMemo(() => makeStyles(C, scale, rf), [C, scale, rf]);
  return <RNText {...rest} style={[styles[v], style]} />;
}
