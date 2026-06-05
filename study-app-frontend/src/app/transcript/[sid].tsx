import { Fragment } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Badge } from '@/components/ui/Badge';
import { Chip } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { Row } from '@/components/ui/Card';
import { AiBubble, MeBubble } from '@/components/ui/Bubble';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { shortDate } from '@/lib/format';
import type { Source } from '@/lib/types';

// Same page-level relevance filter the live lesson screen uses, applied
// here so saved transcripts surface the same figures + material citations
// (and no unrelated stragglers from neighboring pages).
function filterSourcesByTopic(sources: Source[], topic?: string | null) {
  const t = (topic ?? '').toLowerCase().trim();
  const relevantPages = new Set<number>();
  if (t) {
    for (const s of sources) {
      if (s.page_number != null && (s.snippet ?? '').toLowerCase().includes(t)) {
        relevantPages.add(s.page_number);
      }
    }
  }
  const passes = (s: Source) =>
    !t || (s.page_number != null && relevantPages.has(s.page_number));

  const seenFig = new Set<string>();
  const figureSources = sources
    .filter((s) => !!s.figure_path)
    .filter(passes)
    .filter((s) => {
      const p = s.figure_path as string;
      if (seenFig.has(p)) return false;
      seenFig.add(p);
      return true;
    });

  const seenChunk = new Set<string>();
  const materialSources = sources
    .filter((s) => !!s.snippet)
    .filter(passes)
    .filter((s) => {
      if (seenChunk.has(s.chunk_id)) return false;
      seenChunk.add(s.chunk_id);
      return true;
    });

  // AiBubble renders one list — figures first, then "from your material"
  // chips at the bottom. Merge by figure_path: a single combined list lets
  // the bubble pick up figures from `figureSources` while still showing
  // the deduped material rows. Keep figure rows even when their snippet
  // is empty so subfigures still render.
  const seenCombo = new Set<string>();
  return [...figureSources, ...materialSources].filter((s) => {
    const key = s.chunk_id;
    if (seenCombo.has(key)) return false;
    seenCombo.add(key);
    return true;
  });
}

function cap(s?: string | null) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

export default function Transcript() {
  const C = useTheme();
  const router = useRouter();
  const { sid, docId } = useLocalSearchParams<{ sid: string; docId?: string }>();

  // Pure read — no Claude cost.
  const msgs = useQuery({
    queryKey: ['messages', sid],
    queryFn: () => api.sessionMessages(sid!, 1000),
  });

  // Look up the session row to get mode/level/title/created_at/current_outline_point.
  // Uses the same cache key as the lesson-history list so it's already warm
  // if you arrived from /history/[docId].
  const sessions = useQuery({
    queryKey: ['sessions', docId, 'history'],
    queryFn: () => api.listSessions({ document_id: docId, limit: 50 }),
    enabled: !!docId,
  });
  const s = sessions.data?.sessions.find((x) => x.id === sid);

  const messages = msgs.data?.messages ?? [];
  const isTeach = s?.mode === 'teach';
  // Any teach session is resumable, even one where the user opened the
  // lesson screen but hasn't pressed "Next topic" yet (current_outline_point
  // still 0). The teach screen handles the finished case on its own.
  const resumable = isTeach;

  // "{Lesson | Ask} · {date}". Falls back to "Transcript" while the session
  // row hasn't loaded.
  const headerTitle = s
    ? `${s.title ?? (isTeach ? 'Lesson' : 'Ask')} · ${shortDate(s.created_at)}`
    : 'Transcript';

  // For teach sessions: a user message marks the start of a mid-lesson Q&A.
  // We render a "YOU ASKED, MID-LESSON" small section header before each
  // contiguous run of user→assistant turns.
  let prevRole: 'user' | 'assistant' | null = null;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title={headerTitle} />

      {/* Sub-bar: mode badge + level chip. Read-only badge only shows for
          ask sessions, since teach sessions can be resumed from the
          bottom button. Showing it on teach mode misled the user into
          thinking they couldn't continue. */}
      <Row
        gap={8}
        style={{
          paddingHorizontal: 14,
          paddingTop: 4,
          paddingBottom: 12,
          borderBottomWidth: 1.6,
          borderColor: C.line,
        }}
      >
        {s ? (
          <>
            <Chip label={isTeach ? 'Teach' : 'Ask'} on />
            <Chip label={cap(s.level)} />
            <View style={{ flex: 1 }} />
            {!isTeach ? <Badge label="Read-only" kind="out" /> : null}
          </>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </Row>

      <Screen>
        {msgs.isPending ? <Loading /> : null}
        {messages.map((m) => {
          const showMidLesson = isTeach && m.role === 'user' && prevRole !== 'user';
          prevRole = m.role;
          return (
            <Fragment key={m.id}>
              {showMidLesson ? (
                <T v="mut" style={{ marginTop: 6, marginBottom: 2 }}>
                  YOU ASKED, MID-LESSON
                </T>
              ) : null}
              {m.role === 'user' ? (
                <MeBubble text={m.content ?? ''} />
              ) : (
                <AiBubble
                  text={m.content ?? ''}
                  sources={filterSourcesByTopic(
                    m.metadata?.sources ?? [],
                    m.metadata?.topic,
                  )}
                />
              )}
            </Fragment>
          );
        })}
        {!msgs.isPending && !messages.length ? (
          <T v="small" style={{ textAlign: 'center', marginTop: 24 }}>
            This session has no messages yet.
          </T>
        ) : null}
      </Screen>

      {/* Bottom action bar with Resume this lesson, only for resumable teach sessions */}
      {resumable && s ? (
        <View
          style={{
            padding: 12,
            borderTopWidth: 2,
            borderColor: C.ink,
            backgroundColor: C.card,
          }}
        >
          <Button
            label="Resume this lesson →"
            kind="pri"
            block
            onPress={() =>
              router.replace({
                pathname: '/learn/teach',
                params: { sessionId: s.id, documentId: s.document_id },
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
}
