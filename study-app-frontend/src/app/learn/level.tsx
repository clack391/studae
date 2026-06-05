import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { useTheme } from '@/lib/theme';
import type { Level } from '@/lib/types';

const LEVELS: { value: Level; label: string; sub: string }[] = [
  { value: 'novice',       label: 'Novice',       sub: 'Plain language, everyday examples, step-by-step.' },
  { value: 'amateur',      label: 'Amateur',      sub: 'Assumes the basics. Proper terms, a bit faster.' },
  { value: 'professional', label: 'Professional', sub: 'Dense and rigorous. Exam-grade depth and detail.' },
];

export default function PickLevel() {

  const C = useTheme();
  const router = useRouter();
  const { documentId, focusAreaId } = useLocalSearchParams<{ documentId: string; focusAreaId?: string }>();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  const doc = useQuery({
    queryKey: ['doc', documentId],
    queryFn: () => api.getDocument(documentId!),
    enabled: !!documentId && !focusAreaId,
  });
  const focus = useQuery({
    queryKey: ['focus', focusAreaId],
    queryFn: () => api.focusGet(focusAreaId!),
    enabled: !!focusAreaId,
  });
  const [level, setLevel] = useState<Level>(dash.data?.preferred_level ?? 'novice');
  const [busy, setBusy] = useState(false);

  // The first topic the lesson will cover. Outline points are 0-indexed; topics_taught
  // is the count already covered, so the next one is outline_points[topics_taught].
  // For a focus-area lesson, the first focus topic instead.
  const nextTopic = focusAreaId
    ? focus.data?.topics?.[0]
    : doc.data?.outline_points?.[doc.data?.topics_taught ?? 0];

  async function start() {
    if (!documentId) return;
    setBusy(true);
    try {
      const r = await api.lessonStart({ document_id: documentId, level, focus_area_id: focusAreaId ?? null });
      router.replace({ pathname: '/learn/teach', params: { sessionId: r.session_id, documentId } });
    } catch (e: any) {
      if (on402(e, router, 'question')) return;
      Alert.alert('Could not start', e?.message ?? '');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Pick a level" />
      <Screen>
        <T style={{ textAlign: 'center' }}>
          Studae will teach{nextTopic ? <> <T v="bodyB">{nextTopic}</T></> : ''} at the depth you choose. You can change it any time.
        </T>
        {LEVELS.map((l) => (
          <Pressable key={l.value} onPress={() => setLevel(l.value)}>
            <Card kind={level === l.value ? 'accent' : 'soft'}>
              <Row between>
                <T v="handH3">{l.label}</T>
                {level === l.value ? (
                  <Ionicons name="checkmark-circle" size={20} color={C.accent} />
                ) : (
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.line }} />
                )}
              </Row>
              <T v="small">{l.sub}</T>
            </Card>
          </Pressable>
        ))}
        <Button label={busy ? 'Starting…' : 'Start lesson →'} kind="pri" size="lg" block onPress={start} disabled={busy} />
      </Screen>
    </View>
  );
}
