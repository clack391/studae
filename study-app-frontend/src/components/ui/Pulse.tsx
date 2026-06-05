import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { T } from './T';

function Dot({ delay, size = 8 }: { delay: number; size?: number }) {

  const C = useTheme();
  const o = useSharedValue(0.25);
  const scale = useSharedValue(0.85);
  useEffect(() => {
    o.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
    scale.value = withDelay(
      delay,
      withRepeat(withTiming(1.15, { duration: 600, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, [delay, o, scale]);
  const style = useAnimatedStyle(() => ({
    opacity: o.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: C.accent },
        style,
      ]}
    />
  );
}

export function Pulse({ label, align = 'center' }: { label?: string; align?: 'left' | 'center' }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        justifyContent: align === 'left' ? 'flex-start' : 'center',
        padding: 14,
      }}
    >
      <Dot delay={0} />
      <Dot delay={200} />
      <Dot delay={400} />
      {label ? <T v="small" style={{ marginLeft: 8 }}>{label}</T> : null}
    </View>
  );
}

/* A spinning sparkles glyph — slow continuous rotation. */
function SparkleSpin({ size = 28, color }: { size?: number; color?: string }) {
  const C = useTheme();
  const rot = useSharedValue(0);
  const tint = color ?? C.accent;
  useEffect(() => {
    rot.value = withRepeat(
      withTiming(360, { duration: 3500, easing: Easing.linear }),
      -1,
      false,
    );
  }, [rot]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <Ionicons name="sparkles" size={size} color={tint} />
    </Animated.View>
  );
}

/**
 * A more prominent "AI is thinking" indicator: spinning sparkle + handwritten
 * heading + a rotating tip every 4 s, in a soft accent card. Use this when the
 * wait is real (5–20 s Claude call).
 */
export function AIThinking({
  title = 'Studae is thinking',
  tips,
}: {
  title?: string;
  tips?: string[];
}) {
  const C = useTheme();
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    if (!tips?.length) return;
    const id = setInterval(() => setTipIdx((i) => (i + 1) % tips.length), 4000);
    return () => clearInterval(id);
  }, [tips]);

  return (
    <View
      style={{
        alignItems: 'center',
        gap: 14,
        padding: 20,
        backgroundColor: C.accentSoft,
        borderColor: C.accent,
        borderStyle: 'dashed',
        borderWidth: 1.6,
        borderRadius: 18,
      }}
    >
      <SparkleSpin size={32} color={C.accent} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Dot delay={0} size={10} />
        <Dot delay={200} size={10} />
        <Dot delay={400} size={10} />
      </View>
      <T v="handH3" style={{ textAlign: 'center', color: C.accentInk }}>{title}</T>
      {tips?.length ? (
        <T v="small" style={{ textAlign: 'center', minHeight: 30 }}>{tips[tipIdx]}</T>
      ) : null}
    </View>
  );
}
