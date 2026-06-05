import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Segmented';
import { Ring } from '@/components/ui/Ring';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { daysUntil } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { FocusArea } from '@/lib/types';

type AreaWithDoc = FocusArea & { document_title: string };

export default function ExamsHome() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const prefetchFocus = (id: string) =>
    qc.prefetchQuery({ queryKey: ['focus', id], queryFn: () => api.focusGet(id) });

  // Across-doc focus areas — /focus-areas requires document_id, so we fan
  // out one query per ready document.
  const all = useQuery<AreaWithDoc[]>({
    queryKey: ['focus-areas-all'],
    queryFn: async () => {
      const dash = await api.dashboard();
      const ready = dash.documents.filter((d) => d.status === 'ready');
      const results = await Promise.all(
        ready.map(async (doc) => {
          const r = await api.focusList(doc.id);
          return r.focus_areas.map((fa) => ({ ...fa, document_title: doc.title }));
        }),
      );
      return results
        .flat()
        .sort((a, b) => {
          const aDate = a.exam_date ? new Date(a.exam_date).getTime() : Infinity;
          const bDate = b.exam_date ? new Date(b.exam_date).getTime() : Infinity;
          return aDate - bDate;
        });
    },
  });
  useFocusEffect(useCallback(() => { all.refetch(); }, []));

  const areas = all.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar title="Exam prep" />
      <Screen refreshing={all.isRefetching} onRefresh={() => all.refetch()}>
        <T style={{ textAlign: 'center' }}>
          Group the topics your teacher gave you, set the exam date, and study only those.
        </T>

        <Button
          label="+ New area of concentration"
          kind="pri"
          block
          onPress={() => router.push('/(app)/exams/focus-new')}
        />

        {areas.map((fa) => {
          const days = daysUntil(fa.exam_date);
          return (
            <Pressable
              key={fa.id}
              onPressIn={() => prefetchFocus(fa.id)}
              onPress={() => router.push({ pathname: '/(app)/exams/focus/[id]', params: { id: fa.id } })}
            >
              <Card kind="soft">
                <Row top>
                  <Col gap={4} style={{ flex: 1 }}>
                    <T v="handH3" numberOfLines={2}>{fa.name}</T>
                    <T v="mut" numberOfLines={1}>{fa.document_title}</T>
                  </Col>
                  {days != null
                    ? <Ring pct={Math.max(8, 100 - days * 4)} label={String(days)} sub={days === 1 ? 'day' : 'days'} />
                    : null}
                </Row>
                <Row wrap gap={6}>
                  {fa.topics.slice(0, 4).map((t) => <Chip key={t} label={t} />)}
                  {fa.topics.length > 4 ? <Chip label={`+${fa.topics.length - 4}`} /> : null}
                </Row>
              </Card>
            </Pressable>
          );
        })}

        {!all.isPending && !areas.length ? (
          <Card kind="soft">
            <View style={{ alignItems: 'center', padding: 20, gap: 8 }}>
              <Ionicons name="flag-outline" size={40} color={C.ink3} />
              <T v="handH3">No focus areas yet</T>
              <T v="small" style={{ textAlign: 'center' }}>
                Create one for your next exam — pick the topics, set the date, and Studae will focus the lessons, flashcards, and tests on them.
              </T>
            </View>
          </Card>
        ) : null}
      </Screen>
    </View>
  );
}
