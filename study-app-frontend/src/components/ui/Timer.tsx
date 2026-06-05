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

  // Sync when the server reports a fresh value.
  useEffect(() => {
    setLeft(secondsLeft);
    firedRef.current = false;
  }, [secondsLeft]);

  useEffect(() => {
    if (left <= 0) {
      if (!firedRef.current) {
        firedRef.current = true;
        onZero?.();
      }
      return;
    }
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [left, onZero]);

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
