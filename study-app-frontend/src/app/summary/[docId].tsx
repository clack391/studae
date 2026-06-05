import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MD } from '@/components/ui/MD';
import { Sources } from '@/components/ui/Sources';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { speakLesson, stopSpeaking } from '@/lib/tts';
import { useTheme } from '@/lib/theme';

// Some document titles arrived URL-encoded from the file picker on certain
// devices (spaces stored as %20, etc). Decode for display so users see real
// filenames.
function decodeTitle(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Same markdown-stripping helper used in the lesson screen so TTS reads
// "important" instead of "star star important star star".
function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function Summary() {
  const C = useTheme();
  const router = useRouter();
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  const docTitle = decodeTitle(dash.data?.documents.find((d) => d.id === docId)?.title ?? 'Document');
  const level = dash.data?.preferred_level ?? 'novice';
  const [speaking, setSpeaking] = useState(false);

  const m = useMutation({
    mutationFn: () => api.summarize(docId!, { level }),
    onError: (e: any) => {
      if (on402(e, router, 'question')) return;
      Alert.alert('Could not summarize', e?.message ?? '');
    },
  });

  useEffect(() => { if (docId) m.mutate(); }, [docId]);

  // Stop TTS when the screen unmounts or a new summary loads.
  useEffect(() => {
    stopSpeaking();
    setSpeaking(false);
    return () => { stopSpeaking(); };
  }, [m.data?.summary]);

  function toggleSpeak() {
    if (!m.data?.summary) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const text = stripMarkdown(m.data.summary);
    if (!text) return;
    setSpeaking(true);
    speakLesson(text, {
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }

  const canSpeak = !!m.data?.summary;

  return (
    <View style={{ flex: 1 }}>
      <AppBar
        back
        title="Summary"
        right={
          canSpeak ? (
            <Pressable
              onPress={toggleSpeak}
              hitSlop={10}
              style={{ padding: 5 }}
              accessibilityLabel={speaking ? 'Stop reading the summary' : 'Read the summary aloud'}
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
      <Screen>
        <T v="handH3" numberOfLines={2}>{docTitle}</T>

        {m.isPending ? (
          <>
            <IndeterminateBar />
            <AIThinking
              title="Studae is reading the outline"
              tips={[
                'Summaries pull the most important takeaways across every chapter.',
                'For a deeper look at one chapter, take a topic-scoped test instead.',
                'Counts as 1 question against your monthly plan cap.',
              ]}
            />
          </>
        ) : null}

        {m.data ? (
          <Card>
            <Col gap={6}>
              <MD>{m.data.summary}</MD>
              {m.data.sources?.length ? <Sources items={m.data.sources} /> : null}
            </Col>
          </Card>
        ) : null}

        <Button
          label={m.isPending ? '…' : 'Regenerate'}
          kind="soft"
          block
          onPress={() => m.mutate()}
          disabled={m.isPending}
        />
      </Screen>
    </View>
  );
}
