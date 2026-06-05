import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
/**
 * Donut progress ring. The number in the center renders with the platform's
 * system bold font in a fixed-height container — Caveat's metrics on Android
 * clip the glyph bottoms at small sizes.
 */
export function Ring({ pct, label, sub, size = 74 }: { pct: number; label: string; sub?: string; size?: number }) {
  const C = useTheme();
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.card2} strokeWidth={8} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={C.accent}
            strokeWidth={8}
            fill="none"
            strokeDasharray={`${dash} ${c - dash}`}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text
          style={{
            fontSize: Math.round(size * 0.28),
            fontWeight: '800',
            color: C.ink,
            letterSpacing: 0.2,
            textAlign: 'center',
          }}
        >
          {label}
        </Text>
        {sub ? (
          <Text style={{ fontSize: 10, color: C.ink2, fontWeight: '600', marginTop: 1 }}>{sub}</Text>
        ) : null}
      </View>
    </View>
  );
}
