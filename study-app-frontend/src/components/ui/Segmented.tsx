import { Pressable, View } from 'react-native';
import { F, useTheme } from '@/lib/theme';
import { T } from './T';

export function Segmented<V extends string>({ value, options, onChange }: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  const C = useTheme();
  return (
    <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: C.ink, borderRadius: 11, overflow: 'hidden' }}>
      {options.map((opt, i) => {
        const on = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1,
              paddingVertical: 8,
              paddingHorizontal: 6,
              backgroundColor: on ? C.ink : 'transparent',
              borderRightWidth: i === options.length - 1 ? 0 : 2,
              borderColor: C.ink,
              alignItems: 'center',
            }}
          >
            <T style={{ fontFamily: F.hand, fontSize: 17, color: on ? C.card : C.ink2 }}>{opt.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  const C = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: 1.6,
        borderColor: on ? C.accent : C.line,
        backgroundColor: on ? C.accentSoft : C.card,
        borderRadius: 20,
        paddingVertical: 4,
        paddingHorizontal: 11,
      }}
    >
      <T style={{ fontFamily: F.note, fontSize: 13, color: on ? C.accentInk : C.ink2, fontWeight: on ? '700' : '400' }}>{label}</T>
    </Pressable>
  );
}
