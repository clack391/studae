import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Segmented';
import { AiBubble, MeBubble } from '@/components/ui/Bubble';
import { Composer } from '@/components/ui/Composer';
import { Figure } from '@/components/ui/Figure';
import { Pulse } from '@/components/ui/Pulse';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { useTheme } from '@/lib/theme';
import type { Level, Source } from '@/lib/types';

// Short labels for the AppBar chip — full names ('Professional') wrap
// on narrow screens against a long document title.
const LEVEL_CHIP_LABEL: Record<Level, string> = {
  novice: 'Novice',
  amateur: 'Amateur',
  professional: 'Pro',
};

const LEVEL_OPTIONS: { value: Level; label: string; sub: string }[] = [
  { value: 'novice', label: 'Novice', sub: 'Simple, friendly, lots of examples' },
  { value: 'amateur', label: 'Amateur', sub: 'Balanced, less hand-holding' },
  { value: 'professional', label: 'Professional', sub: 'Precise, terse, closer to source' },
];

// `imagePath` is set on user turns that came from a photo Ask, so the
// transcript can re-render the original photo above the typed question.
// Persists the visual context — without it, lesson history shows the
// student asking about "this" with no idea what "this" referred to.
type Turn = { role: 'user' | 'assistant'; text: string; sources?: Source[]; imagePath?: string };

export default function Ask() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ documentId: string; sessionId?: string; level?: Level }>();
  const documentId = params.documentId;

  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  // Level is LOCKED when the caller passed one in (history resume,
  // mid-lesson Ask, post-photo redirect). The chip shows it but tapping
  // does nothing — the level for a resumed conversation belongs to the
  // session that created it, not to a stray tap during review.
  // When NOT locked (fresh /Ask from the library), the chip is tappable
  // and the user can switch via the bottom-sheet picker.
  const levelLocked = !!params.level;
  const [level, setLevel] = useState<Level>(
    params.level ?? dash.data?.preferred_level ?? 'novice',
  );
  useEffect(() => {
    if (levelLocked) return;
    if (dash.data?.preferred_level && level === 'novice'
        && dash.data.preferred_level !== 'novice') {
      setLevel(dash.data.preferred_level);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash.data?.preferred_level]);

  const [levelPickerOpen, setLevelPickerOpen] = useState(false);
  function pickLevel() {
    // Always open the bottom sheet — the picker renders read-only when
    // levelLocked is true, so a tap still opens a styled, on-brand
    // explanation instead of the OS Material Alert.
    setLevelPickerOpen(true);
  }
  const [sessionId, setSessionId] = useState<string | undefined>(params.sessionId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const title = dash.data?.documents.find((d) => d.id === documentId)?.title ?? 'Ask';

  // Hydrate the conversation from the backend. Forced to refetch on every
  // mount and ignore the global staleTime so a navigate-away then back
  // doesn't show a stale message list.
  const history = useQuery({
    queryKey: ['ask-messages', sessionId],
    queryFn: () => api.sessionMessages(sessionId!, 200),
    enabled: !!sessionId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
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
    onSuccess: (r, vars) => {
      setTurns((t) => [...t, { role: 'assistant', text: r.answer, sources: r.sources }]);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
      // Drop the cached message list for this session so re-entering the
      // ask screen refetches and shows the turn we just sent. Without
      // this, the user navigates away, comes back within the staleTime,
      // and the screen rehydrates from a cached response that doesn't
      // include their most recent turn.
      qc.invalidateQueries({ queryKey: ['ask-messages', vars.sid] });
    },
    onError: (e: any) => {
      if (on402(e, router, 'question')) return;
      Alert.alert('Ask failed', e?.message ?? '');
    },
  });

  // Re-sync the on-screen turns from the server every time a fresh fetch
  // completes. Two guards:
  //   - history.isFetching: while react-query is mid-refetch the value
  //     it hands us is the previous cached list (which won't include
  //     the turn the user just sent). Wait for the fresh payload.
  //   - ask.isPending: while a question is in flight we just appended
  //     the optimistic user turn locally; don't clobber it with the
  //     server list (which won't have the assistant reply yet).
  useEffect(() => {
    if (!history.data) return;
    if (history.isFetching) return;
    if (ask.isPending) return;
    const seeded: Turn[] = history.data.messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        text: m.content as string,
        sources: m.role === 'assistant' ? (m.metadata?.sources ?? undefined) : undefined,
        imagePath: m.role === 'user' ? (m.image_path ?? undefined) : undefined,
      }));
    setTurns(seeded);
    if (!hydrated) {
      setHydrated(true);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data, history.isFetching, ask.isPending]);

  // Lazy session creation. We only create a chat_sessions row on the
  // first send. If the user opens this screen and leaves without asking,
  // nothing lands in the DB and the history page stays clean.
  //
  // Optimistic render of the user's turn comes FIRST, before any network
  // call. Otherwise the first message of a new session sits invisible
  // for the ~200-500 ms session-creation roundtrip and the screen looks
  // frozen. If session creation then fails, we roll the turn back so
  // the user isn't left looking at an orphan question with no reply.
  async function send(text: string) {
    setTurns((t) => [...t, { role: 'user', text }]);
    setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    let sid = sessionId;
    if (!sid) {
      try {
        const created = await ensureSession.mutateAsync();
        sid = created.session_id;
      } catch {
        // Roll back the optimistic turn — ensureSession's onError already alerted.
        setTurns((t) => t.slice(0, -1));
        return;
      }
    }
    ask.mutate({ question: text, sid });
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar
        back
        title={title}
        right={
          <Chip
            label={LEVEL_CHIP_LABEL[level]}
            on
            onPress={pickLevel}
          />
        }
      />
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
              ? (
                <View key={i} style={{ gap: 6 }}>
                  {t.imagePath ? <Figure path={t.imagePath} /> : null}
                  <MeBubble text={t.text} />
                </View>
              )
              : <AiBubble key={i} text={t.text} sources={t.sources} />,
          )}
          {/* Show the pulse the moment the user sends, not just once
              /ask is in flight. On the first message of a new session
              there's a ~200-500 ms gap while POST /session creates the
              chat_sessions row, and `ask.isPending` is still false
              during that window. Falling back to either mutation being
              pending makes the pulse appear immediately under the user's
              optimistic turn on every send. */}
          {ask.isPending || ensureSession.isPending ? (
            <Pulse label="Studae is thinking" align="left" />
          ) : null}
        </ScrollView>
        <Composer
          onSend={send}
          // Carry the active Ask level into the photo screen so the
          // session's level isn't silently reset to novice (photo.tsx
          // falls back to 'novice' when params.level is missing, and
          // the backend then persists that on chat_sessions.level).
          onPhoto={() => router.push({ pathname: '/learn/photo', params: { documentId, sessionId, level } })}
          // Always editable. Session is created lazily on first send, so
          // we don't gate input on it. Send button is soft-locked while
          // a question is in flight or a session is being created.
          sending={ask.isPending || ensureSession.isPending}
        />
      </KeyboardAvoidingView>

      {/* Premium-styled level picker. Bottom sheet over a dimmed scrim,
          ink border + accent highlight on the current level. Replaces
          the default OS Alert which felt off-brand. */}
      <Modal
        transparent
        visible={levelPickerOpen}
        animationType="fade"
        onRequestClose={() => setLevelPickerOpen(false)}
      >
        <Pressable
          onPress={() => setLevelPickerOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'flex-end',
          }}
        >
          <Pressable
            onPress={() => {/* swallow taps inside sheet */}}
            style={{
              backgroundColor: C.card,
              borderTopWidth: 2,
              borderLeftWidth: 2,
              borderRightWidth: 2,
              borderColor: C.ink,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              paddingHorizontal: 16,
              paddingTop: 18,
              paddingBottom: 28,
              gap: 12,
            }}
          >
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 12 }} />
            </View>
            <T v="handH2">{levelLocked ? 'Level locked' : 'Answer level'}</T>
            <T v="small" style={{ marginBottom: 6 }}>
              {levelLocked
                ? 'This level was set when the lesson or chat was first started. To choose a different level, begin a fresh Ask from the document page.'
                : 'How should Studae talk to you?'}
            </T>
            {LEVEL_OPTIONS.map((opt) => {
              const on = level === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  disabled={levelLocked}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setLevel(opt.value);
                    setLevelPickerOpen(false);
                  }}
                  style={{
                    borderWidth: 1.6,
                    borderColor: on ? C.accent : C.line,
                    backgroundColor: on ? C.accentSoft : 'transparent',
                    borderRadius: 14,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    // Slightly fade the options the user can't choose
                    // when locked, but keep the selected one fully
                    // visible so the active level is obvious.
                    opacity: levelLocked && !on ? 0.45 : 1,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="bodyB" style={{ color: on ? C.accentInk : C.ink }}>{opt.label}</T>
                    <T v="small">{opt.sub}</T>
                  </View>
                  {on ? (
                    <Ionicons
                      name={levelLocked ? 'lock-closed' : 'checkmark-circle'}
                      size={22}
                      color={C.accent}
                    />
                  ) : (
                    <View style={{
                      width: 22, height: 22, borderRadius: 11,
                      borderWidth: 1.6, borderColor: C.line,
                    }} />
                  )}
                </Pressable>
              );
            })}
            {levelLocked ? (
              <Button label="Got it" kind="dark" block onPress={() => setLevelPickerOpen(false)} />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
