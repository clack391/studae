import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { speakLesson, stopSpeaking, stripMarkdown } from '@/lib/tts';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Bar } from '@/components/ui/Bar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Segmented';
import { T } from '@/components/ui/T';
import { MD } from '@/components/ui/MD';
import { Sources } from '@/components/ui/Sources';
import { Figure } from '@/components/ui/Figure';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { Row } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { parseProgressText } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { LessonNextResponse } from '@/lib/types';

// The screen already shows the topic name as a heading, and the lesson body
// often opens with its own "# Topic" title — which doubled it up. Strip a
// leading markdown heading from the lesson when it just repeats the topic.
function stripTopicHeading(lesson: string, topic: string): string {
  const m = lesson.match(/^\s*#{1,6}\s+(.+?)\s*\n+/);
  if (!m) return lesson;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const h = norm(m[1]);
  const t = norm(topic || '');
  if (t && (h === t || h.includes(t) || t.includes(h))) return lesson.slice(m[0].length);
  return lesson;
}

export default function Teach() {
  const C = useTheme();
  const router = useRouter();
  const { sessionId, documentId } = useLocalSearchParams<{ sessionId: string; documentId: string }>();
  const [data, setData] = useState<LessonNextResponse | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const next = useMutation({
    mutationFn: () => api.lessonNext(sessionId!),
    onSuccess: (r) => setData(r),
    onError: (e: any) => {
      if (on402(e, router, 'question')) return;
      Alert.alert('Could not load next', e?.message ?? '');
    },
  });

  // "Next topic" first asks the backend to mark the current topic done
  // (advance the cursor), then fetches the lesson for the new current
  // topic. Backend treats opening the screen as a peek, so progress only
  // ticks up when the user explicitly advances.
  const advance = useMutation({
    mutationFn: async (opts?: { skip?: boolean }) => {
      await api.lessonAdvance(sessionId!, opts);
      return api.lessonNext(sessionId!);
    },
    onSuccess: (r) => setData(r),
    onError: (e: any) => {
      if (on402(e, router, 'question')) return;
      Alert.alert('Could not load next', e?.message ?? '');
    },
  });

  useEffect(() => {
    if (sessionId) next.mutate();
  }, [sessionId]);

  // Stop TTS on unmount and whenever a new lesson loads.
  useEffect(() => {
    stopSpeaking();
    setSpeaking(false);
    return () => {
      stopSpeaking();
    };
  }, [data?.lesson]);

  function toggleSpeak() {
    if (!data?.lesson) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    // Claude's lesson body already opens with a heading naming the topic
    // (e.g. "# Spider Mites" → spoken as "Spider Mites"), and the first
    // sentence usually starts with the topic too. Prepending data.topic
    // here meant the topic was spoken three times back-to-back.
    const text = stripMarkdown(data.lesson);
    if (!text) return;
    setSpeaking(true);
    speakLesson(text, {
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }

  const done = !!data?.done;
  const { cur, total, pct } = parseProgressText(data?.progress);
  const title = data?.topic ?? (done ? 'Finished' : 'Lesson');
  const canSpeak = !!data?.lesson && !done;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar
        back
        title={title}
        right={
          canSpeak ? (
            <Pressable
              onPress={toggleSpeak}
              hitSlop={10}
              style={{ padding: 5 }}
              accessibilityLabel={speaking ? 'Stop reading the lesson aloud' : 'Read the lesson aloud'}
            >
              <Ionicons
                name={speaking ? 'stop-circle' : 'volume-medium-outline'}
                size={22}
                color={C.accent}
              />
            </Pressable>
          ) : null
        }
      />
      <Row between style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <T v="bodyB">{data?.progress ? `Topic ${cur} of ${total}` : next.isPending ? 'Loading…' : ''}</T>
        <Chip label="Lesson" on />
      </Row>
      <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
        {next.isPending && !data ? <IndeterminateBar /> : <Bar pct={pct} />}
      </View>
      <Screen>
        {next.isPending || advance.isPending ? (
          <AIThinking
            title={advance.isPending ? 'Loading the next topic' : (data ? 'Loading' : 'Studae is teaching')}
            tips={[
              'Lessons are grounded in your uploaded material.',
              'Tap "Ask" any time during a lesson, your place is saved.',
              'Pick a different level on the next lesson if it feels too easy or too dense.',
              'Studae walks topics in outline order so each builds on the last.',
            ]}
          />
        ) : null}
        {done ? (
          <>
            <T v="handH2" style={{ textAlign: 'center', marginTop: 28 }}>You've finished the outline.</T>
            <T style={{ textAlign: 'center' }}>{data?.lesson ?? 'Every topic in this document has been taught.'}</T>
            <Button label="Back to library" kind="pri" block onPress={() => router.replace('/(app)/library')} />
          </>
        ) : data?.lesson && !advance.isPending ? (
          (() => {
            // Filter at the PAGE level. A page is "relevant" if at least
            // one chunk's snippet contains the topic name. Both the
            // inline figures and the "from your material" sources card
            // are filtered by the same relevance set, so the student only
            // sees figures and citations that belong to the current
            // topic. Composite figures (e.g. Anthracnose subfigures A-D
            // attached to four different chunks on the same page) stay
            // intact because the whole page passes through.
            const topic = (data.topic ?? '').toLowerCase().trim();
            const sources = data.sources ?? [];
            const relevantPages = new Set<number>();
            if (topic) {
              for (const s of sources) {
                if (s.page_number != null && (s.snippet ?? '').toLowerCase().includes(topic)) {
                  relevantPages.add(s.page_number);
                }
              }
            }
            const passesTopic = (s: typeof sources[number]) =>
              !topic || (s.page_number != null && relevantPages.has(s.page_number));

            const seenFig = new Set<string>();
            const figureSources = sources
              .filter((s) => !!s.figure_path)
              .filter(passesTopic)
              .filter((s) => {
                const p = s.figure_path as string;
                if (seenFig.has(p)) return false;
                seenFig.add(p);
                return true;
              });

            // "from your material" card: only show sources whose snippet
            // is non-empty (skip pure figure-supplements) AND whose page
            // is topic-relevant. Dedupe by chunk_id.
            const seenChunk = new Set<string>();
            const materialSources = sources
              .filter((s) => !!s.snippet)
              .filter(passesTopic)
              .filter((s) => {
                if (seenChunk.has(s.chunk_id)) return false;
                seenChunk.add(s.chunk_id);
                return true;
              });

            return (
              <>
                <T v="handH3">{data.topic}</T>
                {figureSources.map((s) => (
                  <Figure
                    key={s.chunk_id}
                    path={s.figure_path as string}
                    caption={s.page_number != null ? `page ${s.page_number}` : undefined}
                  />
                ))}
                <MD>{stripTopicHeading(data.lesson, data.topic ?? '')}</MD>
                {materialSources.length ? <Sources items={materialSources} /> : null}
              </>
            );
          })()
        ) : null}
      </Screen>
      {!done ? (
        <Row
          gap={10}
          style={{ padding: 12, borderTopWidth: 2, borderColor: C.ink, backgroundColor: C.card }}
        >
          <Button
            label="Ask"
            kind="soft"
            onPress={() =>
              router.push({
                pathname: '/learn/ask',
                // Pass the lesson's level so the Ask screen inherits it
                // and locks the chip — mid-lesson Ask is tied to the
                // lesson's level, not the student's free choice.
                params: { documentId, sessionId, level: data?.level },
              })
            }
            disabled={next.isPending}
          />
          <Button
            label="Skip"
            kind="ghost"
            onPress={() => advance.mutate({ skip: true })}
            disabled={advance.isPending || next.isPending}
          />
          <View style={{ flex: 1 }}>
            <Button
              label={advance.isPending || next.isPending ? '…' : 'Next topic →'}
              kind="pri"
              block
              onPress={() => advance.mutate(undefined)}
              disabled={advance.isPending || next.isPending || !data?.lesson}
            />
          </View>
        </Row>
      ) : null}
    </View>
  );
}
