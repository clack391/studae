import { useCallback } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useTheme } from '@/lib/theme';
function cap(s?: string | null) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

export default function LessonHistory() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const sessions = useQuery({
    queryKey: ['sessions', docId, 'history'],
    queryFn: () => api.listSessions({ document_id: docId, limit: 50 }),
  });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  useFocusEffect(useCallback(() => { sessions.refetch(); }, [docId]));

  const reset = useMutation({
    mutationFn: (sessionId: string) => api.lessonReset(sessionId),
    onSuccess: () => {
      // Topics-taught count comes off chat_sessions, so the doc detail and
      // dashboard need to refetch after a reset.
      qc.invalidateQueries({ queryKey: ['sessions', docId, 'history'] });
      qc.invalidateQueries({ queryKey: ['doc', docId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: any) => Alert.alert('Could not reset', e?.message ?? ''),
  });

  const del = useMutation({
    mutationFn: (sessionId: string) => api.sessionDelete(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions', docId, 'history'] });
      qc.invalidateQueries({ queryKey: ['sessions', 'all-recent'] });
      qc.invalidateQueries({ queryKey: ['doc', docId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: any) => Alert.alert('Could not delete', e?.message ?? ''),
  });

  function confirmReset(sessionId: string) {
    Alert.alert(
      'Restart this lesson?',
      'Progress and saved transcript will be cleared. You can walk the topics again from the beginning.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restart', style: 'destructive', onPress: () => reset.mutate(sessionId) },
      ],
    );
  }

  function confirmDelete(sessionId: string, mode: 'teach' | 'ask') {
    Alert.alert(
      mode === 'teach' ? 'Delete this lesson?' : 'Delete this conversation?',
      'The transcript will be removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => del.mutate(sessionId) },
      ],
    );
  }

  const list = sessions.data?.sessions ?? [];
  const docTitle = dash.data?.documents.find((d) => d.id === docId)?.title ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Lesson history" />
      <Screen refreshing={sessions.isRefetching} onRefresh={() => sessions.refetch()}>
        <T v="mut">FROM</T>
        <T v="handH3" numberOfLines={1}>{docTitle}</T>
        <T v="small">Every lesson and chat is saved. Reviewing is always free.</T>

        {sessions.isPending ? <Loading /> : null}

        {list.map((s) => {
          const isTeach = s.mode === 'teach';
          const resumable = isTeach && (s.current_outline_point ?? 0) > 0;
          return (
            // Teach sessions: tap → transcript (read-only past lessons).
            // Ask sessions: tap → /learn/ask (continue chatting; the
            // screen rehydrates the conversation from messages).
            <Pressable
              key={s.id}
              onPress={() => {
                if (isTeach) {
                  router.push({ pathname: '/transcript/[sid]', params: { sid: s.id, docId: s.document_id } });
                } else {
                  router.push({ pathname: '/learn/ask', params: { sessionId: s.id, documentId: s.document_id, level: s.level } });
                }
              }}
            >
              <Card kind="soft">
                <Row top>
                  <Col gap={4} style={{ flex: 1 }}>
                    <Row gap={6}>
                      <Badge label={isTeach ? 'Teach' : 'Ask'} kind={isTeach ? 'exam' : 'out'} />
                      <Badge label={cap(s.level)} kind="plain" />
                    </Row>
                    <T v="bodyB" numberOfLines={1}>{s.title ?? (isTeach ? 'Lesson' : 'Conversation')}</T>
                    <T v="mut">
                      {resumable ? `topic ${s.current_outline_point} · in progress` : shortDate(s.created_at)}
                    </T>
                  </Col>
                  {resumable ? (
                    <Button
                      label="Resume"
                      kind="soft"
                      size="sm"
                      onPress={() =>
                        router.push({ pathname: '/learn/teach', params: { sessionId: s.id, documentId: s.document_id } })
                      }
                    />
                  ) : null}
                  {isTeach ? (
                    <Pressable
                      onPress={() => confirmReset(s.id)}
                      hitSlop={10}
                      style={{ padding: 4 }}
                      disabled={reset.isPending}
                    >
                      <Ionicons name="refresh-outline" size={18} color={C.ink2} />
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => confirmDelete(s.id, isTeach ? 'teach' : 'ask')}
                    hitSlop={10}
                    style={{ padding: 4 }}
                    disabled={del.isPending}
                  >
                    <Ionicons name="trash-outline" size={18} color={C.ink2} />
                  </Pressable>
                </Row>
              </Card>
            </Pressable>
          );
        })}

        {!sessions.isPending && !list.length ? (
          <Card kind="soft">
            <View style={{ alignItems: 'center', padding: 20, gap: 8 }}>
              <Ionicons name="time-outline" size={40} color={C.ink3} />
              <T v="handH3">No lessons or chats yet</T>
              <T v="small" style={{ textAlign: 'center' }}>
                Start a lesson or ask a question. They'll all show up here.
              </T>
            </View>
          </Card>
        ) : null}
      </Screen>
    </View>
  );
}
