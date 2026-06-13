import { useWindowDimensions, View } from 'react-native';
import { bodyFont, useReadingFont, useTextScale, useTheme } from '@/lib/theme';
import { T } from './T';
import { MD, needsRichRender } from './MD';
import { Sources } from './Sources';
import { Figure } from './Figure';
import type { Source } from '@/lib/types';

export function MeBubble({ text }: { text: string }) {
  const C = useTheme();
  const scale = useTextScale();
  const rf = useReadingFont();
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        backgroundColor: C.accentD,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 15,
        borderBottomRightRadius: 5,
        maxWidth: '85%',
      }}
    >
      <T style={{ fontFamily: bodyFont(rf), color: '#fff', fontSize: Math.round(14 * scale), lineHeight: Math.round(20 * scale), fontWeight: '500' }}>{text}</T>
    </View>
  );
}

export function AiBubble({ text, sources }: { text: string; sources?: Source[] }) {
  const C = useTheme();
  const { width: winW } = useWindowDimensions();
  // A math/diagram answer renders in a WebView, which needs a CONCRETE width.
  // This bubble is content-sized (alignSelf flex-start + maxWidth), so a
  // WebView with width:'100%' collapses to a sliver. Give rich content the
  // bubble's usable width: window minus the chat list padding (14*2) and the
  // bubble padding (12*2), capped at the 92% bubble max.
  const richWidth = Math.floor((winW - 28) * 0.92) - 30;
  // Split the source list. figureSources renders as inline images; the
  // "from your material" card only shows entries with a real snippet so
  // page-expansion supplements (figure-only rows with empty snippets)
  // don't pile up as duplicate "page 7" rows in the citation list.
  // Dedupe figures by figure_path so the same image doesn't render twice
  // when multiple chunks happen to reference it.
  const all = sources ?? [];
  const seenFig = new Set<string>();
  const figureSources = all
    .filter((s) => !!s.figure_path)
    .filter((s) => {
      const p = s.figure_path as string;
      if (seenFig.has(p)) return false;
      seenFig.add(p);
      return true;
    });
  const materialSources = all.filter((s) => !!s.snippet);
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
      {needsRichRender(text) ? (
        <View style={{ width: richWidth }}><MD>{text}</MD></View>
      ) : (
        <MD>{text}</MD>
      )}
      {figureSources.map((s) => (
        <Figure
          key={s.chunk_id}
          path={s.figure_path as string}
          caption={s.page_number != null ? `page ${s.page_number}` : undefined}
        />
      ))}
      {materialSources.length ? <Sources items={materialSources} /> : null}
    </View>
  );
}
