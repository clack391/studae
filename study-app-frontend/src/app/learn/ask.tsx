import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AppBar } from '@/components/ui/AppBar';
import { Chip } from '@/components/ui/Segmented';
import { AiBubble, MeBubble } from '@/components/ui/Bubble';
import { Composer } from '@/components/ui/Composer';
import { Pulse } from '@/components/ui/Pulse';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { useTheme } from '@/lib/theme';
import type { Level, Source } from '@/lib/types';

type Turn = { role: 'user' | 'assistant'; text: string; sources?: Source[] };

export default function Ask() {
  const C = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ documentId: string; sessionId?: string; level?: Level }>();
  const documentId = params.documentId;

  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  const [level] = useState<Level>(params.level ?? 'novice');
  const [sessionId, setSessionId] = useState<string | undefined>(params.sessionId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const title = dash.data?.documents.find((d) => d.id === documentId)?.title ?? 'Ask';

  // Hydrate the conversation from the backend so prior messages (including
  // photo-ask answers from the photo screen) show up when the user lands
  // here. Only runs once per sessionId.
  const history = useQuery({
    queryKey: ['ask-messages', sessionId],
    queryFn: () => api.sessionMessages(sessionId!, 200),
    enabled: !!sessionId && !hydrated,
  });
  useEffect(() => {
    if (history.data && !hydrated) {
      // Restore sources from metadata for assistant turns. Backend saves
      // {sources: [...]} on every /ask reply so figures and page citations
      // round-trip across screen reloads. Older messages saved before the
      // metadata write was added simply have metadata=null → no sources,
      // just the text bubble.
      const seeded: Turn[] = history.data.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          text: m.content as string,
          sources: m.role === 'assistant' ? (m.metadata?.sources ?? undefined) : undefined,
        }));
      setTurns(seeded);
      setHydrated(true);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [history.data, hydrated]);

  // Create a fresh session if one wasn't passed.
  const ensureSession = useMutation({
    mutationFn: () => api.createSession({ document_id: documentId, level, mode: 'ask' }),
    onSuccess: (r) => { setSessionId(r.session_id); setHydrated(true); },
    onError: (e: any) => Alert.alert('Could not start session', e?.message ?? ''),
  });

  const ask = useMutation({
    mutationFn: ({ question, sid }: { question: string; sid: string }) => api.ask({
      session_id: sid,
      document_id: documentId,
      question,
      level,
    }),
    onSuccess: (r) => {
      setTurns((t) => [...t, { role: 'assistant', text: r.answer, sources: r.sources }]);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    },
    onError: (e: any) => {
      if (on402(e, router, 'question')) return;
      Alert.alert('Ask failed', e?.message ?? '');
    },
  });

  // Lazy session creation. We only create a chat_sessions row on the
  // first send. If the user opens this screen and leaves without asking,
  // nothing lands in the DB and the history page stays clean.
  async function send(text: string) {
    let sid = sessionId;
    if (!sid) {
      try {
        const created = await ensureSession.mutateAsync();
        sid = created.session_id;
      } catch {
        return; // ensureSession's onError already alerted
      }
    }
    setTurns((t) => [...t, { role: 'user', text }]);
    ask.mutate({ question: text, sid });
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title={title} right={<Chip label={level[0].toUpperCase() + level.slice(1)} on />} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // Force padding-based offset on both platforms. Expo Go's Android
        // default sometimes pans the whole window which leaves the input
        // hidden behind the keyboard, so we drive the offset ourselves.
        behavior="padding"
      >
        <ScrollView
          ref={scroller}
          contentContainerStyle={{ padding: 14, gap: 12, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          {!turns.length ? (
            <T v="small" style={{ textAlign: 'center', marginTop: 24 }}>
              Ask anything about this document. Studae only answers from your material.
            </T>
          ) : null}
          {turns.map((t, i) =>
            t.role === 'user'
              ? <MeBubble key={i} text={t.text} />
              : <AiBubble key={i} text={t.text} sources={t.sources} />,
          )}
          {ask.isPending ? <Pulse label="Studae is thinking" align="left" /> : null}
        </ScrollView>
        <Composer
          onSend={send}
          onPhoto={() => router.push({ pathname: '/learn/photo', params: { documentId, sessionId } })}
          // Always editable. Session is created lazily on first send, so
          // we don't gate input on it. Send button is soft-locked while
          // a question is in flight or a session is being created.
          sending={ask.isPending || ensureSession.isPending}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
