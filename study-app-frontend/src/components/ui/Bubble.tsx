import { View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { T } from './T';
import { MD } from './MD';
import { Sources } from './Sources';
import type { Source } from '@/lib/types';

export function MeBubble({ text }: { text: string }) {

  const C = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        backgroundColor: C.accent,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 15,
        borderBottomRightRadius: 5,
        maxWidth: '85%',
      }}
    >
      <T style={{ color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{text}</T>
    </View>
  );
}

export function AiBubble({ text, sources }: { text: string; sources?: Source[] }) {

  const C = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: C.card2,
        borderWidth: 1.6,
        borderColor: C.line,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 15,
        borderBottomLeftRadius: 5,
        maxWidth: '92%',
        gap: 9,
      }}
    >
      <MD>{text}</MD>
      {sources?.length ? <Sources items={sources} /> : null}
    </View>
  );
}
