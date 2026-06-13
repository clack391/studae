import { Text, View } from 'react-native';
import { F, useTextScale, useTheme } from '@/lib/theme';
import { T } from './T';

export function Bar({ pct, color }: { pct: number; color?: string }) {
  const C = useTheme();
  const p = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ height: 9, borderRadius: 6, backgroundColor: C.card2, borderWidth: 1.6, borderColor: C.line, overflow: 'hidden' }}>
      <View style={{ width: `${p}%`, height: '100%', backgroundColor: color ?? C.accent }} />
    </View>
  );
}

export function Stat({ big, small }: { big: string; small: string }) {

  const C = useTheme();
  const scale = useTextScale();
  const s = (n: number) => Math.round(n * scale);
  return (
    <View style={{ alignItems: 'center', minWidth: 60 }}>
      {/* Raw RNText + system bold + fixed-height container, no font-specific
          metric tricks. Worked around persistent Caveat clipping on Android.
          Height scales with the reading size so the number never clips. */}
      <View style={{ height: s(36), justifyContent: 'center' }}>
        <Text
          style={{
            fontSize: s(28),
            fontWeight: '800',
            color: C.ink,
            letterSpacing: 0.3,
            textAlign: 'center',
          }}
        >
          {big}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: F.note,
          fontSize: s(11),
          color: C.ink2,
          marginTop: 2,
        }}
      >
        {small}
      </Text>
    </View>
  );
}
