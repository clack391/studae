import { View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { T } from './T';
import { MD } from './MD';
import { Sources } from './Sources';
import { Figure } from './Figure';
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
  // Pull out any source chunks that have a real figure image so we can
  // render them inline. Same component the lesson and test screens use.
  const figureSources = (sources ?? []).filter((s) => !!s.figure_path);
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
      {figureSources.map((s) => (
        <Figure
          key={s.chunk_id}
          path={s.figure_path as string}
          caption={s.page_number != null ? `page ${s.page_number}` : undefined}
        />
      ))}
      {sources?.length ? <Sources items={sources} /> : null}
    </View>
  );
}
