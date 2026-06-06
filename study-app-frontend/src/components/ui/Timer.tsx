import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { T } from './T';
import { clockTime } from '@/lib/format';

export function Timer({ secondsLeft, onZero }: { secondsLeft: number; onZero?: () => void }) {
  const C = useTheme();
  const [left, setLeft] = useState(secondsLeft);
  const firedRef = useRef(false);
  // Latest onZero behind a ref. The parent passes an inline arrow
  // (`() => submit.mutate()`) so its identity changes every render. If
  // we depended on it directly, the countdown effect below would tear
  // down and recreate setInterval every parent re-render, which on the
  // take screen flickered the timer/question area on first mount as
  // state settled. Going through a ref means onZero updates are picked
  // up without invalidating the effect.
  const onZeroRef = useRef(onZero);
  useEffect(() => { onZeroRef.current = onZero; }, [onZero]);

  // Sync when the server reports a fresh value.
  useEffect(() => {
    setLeft(secondsLeft);
    firedRef.current = false;
  }, [secondsLeft]);

  // Single countdown. Set once, ticks every second; no dependency on
  // `left` (we use the functional setLeft form) and no dependency on
  // `onZero` (read through the ref). The interval lives for the whole
  // mount and is cleared on unmount.
  useEffect(() => {
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 0) return 0;
        const next = s - 1;
        if (next <= 0 && !firedRef.current) {
          firedRef.current = true;
          // Defer to a microtask so we don't call setState mid-render.
          Promise.resolve().then(() => onZeroRef.current?.());
        }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const low = left < 60;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: low ? C.warn : C.ink,
        paddingVertical: 4,
        paddingHorizontal: 11,
        borderRadius: 20,
      }}
    >
      <Ionicons name="time-outline" size={13} color={C.card} />
      <T style={{ color: C.card, fontSize: 13, fontWeight: '700' }}>{clockTime(left)}</T>
    </View>
  );
}
