import { View } from 'react-native';
import { useTheme } from '@/lib/theme';
export function DocThumb({ w = 46, h = 58 }: { w?: number; h?: number }) {
  const C = useTheme();
  return (
    <View
      style={{
        width: w, height: h, borderRadius: 6, borderWidth: 2, borderColor: C.line,
        backgroundColor: C.card2, padding: 7, gap: 4, overflow: 'hidden',
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ height: 3, backgroundColor: C.grey2, borderRadius: 1.5 }} />
      ))}
    </View>
  );
}
