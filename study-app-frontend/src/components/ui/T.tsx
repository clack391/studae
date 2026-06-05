import { useMemo } from 'react';
import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { F, useTheme } from '@/lib/theme';

type Variant = 'hand' | 'handH2' | 'handH3' | 'handBig' | 'body' | 'bodyB' | 'small' | 'note' | 'mut' | 'label';

// Hand variants use Kalam (see theme.ts) so descenders don't clip on Android.
// 1.4× lineHeight and modest paddingBottom keep glyphs inside their line box.
// Styles are memoised per palette so we don't rebuild the object every render.
function makeStyles(C: ReturnType<typeof useTheme>): Record<Variant, TextStyle> {
  return {
    hand:    { fontFamily: F.hand, fontSize: 26, color: C.ink, lineHeight: 36, paddingBottom: 2, letterSpacing: 0.2 },
    handH2:  { fontFamily: F.hand, fontSize: 22, color: C.ink, lineHeight: 30, paddingBottom: 2, letterSpacing: 0.2 },
    handH3:  { fontFamily: F.hand, fontSize: 19, color: C.ink, lineHeight: 26, paddingBottom: 2, letterSpacing: 0.2 },
    handBig: { fontFamily: F.hand, fontSize: 34, color: C.ink, lineHeight: 46, paddingBottom: 3, letterSpacing: 0.3 },
    body:    { fontSize: 14, color: C.ink, lineHeight: 21, fontWeight: '500' },
    bodyB:   { fontSize: 14, color: C.ink, lineHeight: 21, fontWeight: '700' },
    small:   { fontSize: 12, color: C.ink, lineHeight: 17, fontWeight: '500' },
    note:    { fontFamily: F.note, fontSize: 14, color: C.ink, lineHeight: 20 },
    mut:     { fontSize: 11, color: C.ink2, lineHeight: 16, fontWeight: '600', letterSpacing: 0.3 },
    label:   { fontFamily: F.note, fontSize: 13, color: C.ink, marginBottom: 5, fontWeight: '700' },
  };
}

export function T({ v = 'body', style, ...rest }: TextProps & { v?: Variant }) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  return <RNText {...rest} style={[styles[v], style]} />;
}
