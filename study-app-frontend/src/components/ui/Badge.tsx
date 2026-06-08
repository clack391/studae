import { View, ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { T } from './T';

type Kind = 'plain' | 'ok' | 'warn' | 'err' | 'out' | 'exam';

export function Badge({ label, kind = 'plain' }: { label: string; kind?: Kind }) {

  const C = useTheme();
  const s: ViewStyle = { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6, backgroundColor: C.ink, alignSelf: 'flex-start' };
  let color = C.card;
  if (kind === 'ok') { s.backgroundColor = C.okSoft; color = C.ok; }
  else if (kind === 'warn') { s.backgroundColor = C.warnSoft; color = C.warn; }
  else if (kind === 'err') { s.backgroundColor = C.errSoft; color = C.err; }
  else if (kind === 'out') { s.backgroundColor = 'transparent'; s.borderWidth = 1.5; s.borderColor = C.line; color = C.ink2; }
  else if (kind === 'exam') { s.backgroundColor = C.accentD; s.borderWidth = 2; s.borderColor = C.ink; color = '#fff'; }
  return (
    <View style={s}>
      <T style={{ color, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 12 }}>{label}</T>
    </View>
  );
}
