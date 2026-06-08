import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { F, useTheme } from '@/lib/theme';
import { T } from './T';
import type { Source } from '@/lib/types';

export function Sources({ items }: { items: Source[] }) {

  const C = useTheme();
  if (!items?.length) return null;
  return (
    <View
      style={{
        borderWidth: 1.6,
        borderColor: C.accent,
        borderStyle: 'dashed',
        borderRadius: 11,
        padding: 9,
        backgroundColor: C.accentSoft,
        gap: 7,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="document-text-outline" size={13} color={C.accentInk} />
        <T v="small" style={{ fontFamily: F.note, color: C.accentInk, fontWeight: '700' }}>from your material</T>
      </View>
      {items.map((s, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            gap: 7,
            alignItems: 'flex-start',
            backgroundColor: C.card,
            borderWidth: 1.5,
            borderColor: C.line,
            borderRadius: 8,
            padding: 7,
          }}
        >
          <Ionicons name="document-text-outline" size={13} color={C.accent} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <T v="mut" style={{ fontWeight: '800', color: C.accentInk, letterSpacing: 0.2 }}>page {s.page_number ?? '?'}</T>
            {s.snippet ? <T v="small" style={{ color: C.ink }} numberOfLines={3}>{s.snippet}</T> : null}
          </View>
        </View>
      ))}
    </View>
  );
}
