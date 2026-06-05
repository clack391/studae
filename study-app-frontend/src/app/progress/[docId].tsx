import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Bar, Stat } from '@/components/ui/Bar';
import { Ring } from '@/components/ui/Ring';
import { Loading } from '@/components/ui/Loading';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
function PBar({ label, val, pct, color }: { label: string; val: string; pct: number; color?: string }) {
  const C = useTheme();
  return (
    <Col gap={6}>
      <Row between>
        <T v="bodyB">{label}</T>
        <T v="small">{val}</T>
      </Row>
      <Bar pct={pct} color={color} />
    </Col>
  );
}

export default function ProgressScreen() {
  const C = useTheme();
  const router = useRouter();
  const { docId } = useLocalSearchParams<{ docId: string }>();
  const prog = useQuery({
    queryKey: ['progress', docId],
    queryFn: () => api.documentProgress(docId!),
  });
  // Pull /history so we can split assessments_taken into tests vs exams.
  // History is paid for by other screens already (Exams tab); cached for 30 s
  // by the root QueryClient.
  const history = useQuery({
    queryKey: ['history'],
    queryFn: () => api.historyList(),
  });
  useFocusEffect(useCallback(() => { prog.refetch(); history.refetch(); }, [docId]));

  if (prog.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="Your progress" />
        <Screen><Loading /></Screen>
      </View>
    );
  }

  const p = prog.data;
  if (!p) return null;

  const taughtPct = p.topics_total ? Math.round((p.topics_taught / p.topics_total) * 100) : 0;
  const cardPct = p.flashcards_in_library ? Math.round((p.flashcards_mastered / p.flashcards_in_library) * 100) : 0;
  const score = p.average_score_percent ?? 0;
  const aheadCount = Math.max(0, p.topics_total - p.topics_taught);

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Your progress" />
      <Screen refreshing={prog.isRefetching} onRefresh={() => prog.refetch()}>
        <View style={{ alignItems: 'center', marginTop: 4 }}>
          <T v="handH3" numberOfLines={1}>{p.title}</T>
        </View>

        <Row top gap={14}>
          <Ring pct={taughtPct} label={`${taughtPct}%`} sub="taught" size={88} />
          <Col gap={4} style={{ flex: 1 }}>
            <T v="small">You have been taught</T>
            <T v="handH3">{p.topics_taught} of {p.topics_total} topics</T>
            <T v="mut">
              {aheadCount === 0
                ? 'every topic covered'
                : `${aheadCount} topic${aheadCount === 1 ? '' : 's'} still ahead`}
            </T>
          </Col>
        </Row>

        <Card kind="soft">
          <PBar label="Topics taught" val={`${p.topics_taught} / ${p.topics_total}`} pct={taughtPct} />
          <Divider />
          <PBar
            label="Average score"
            val={p.average_score_percent != null ? `${p.average_score_percent}%` : '—'}
            pct={score}
            color={score >= 80 ? C.ok : score >= 60 ? C.accent : C.warn}
          />
          <Divider />
          <PBar
            label="Flashcards mastered"
            val={`${p.flashcards_mastered} / ${p.flashcards_in_library}`}
            pct={cardPct}
          />
        </Card>

        {/* Split assessments by kind (test vs exam). Walks /history filtered to this doc. */}
        {(() => {
          const docHistory = (history.data?.assessments ?? []).filter((a) => a.document_id === docId);
          const tests = docHistory.filter((a) => a.kind === 'test').length;
          const exams = docHistory.filter((a) => a.kind === 'exam').length;
          return (
            <Row between gap={20}>
              <Stat big={String(tests)} small={tests === 1 ? 'test' : 'tests'} />
              <Stat big={String(exams)} small={exams === 1 ? 'exam' : 'exams'} />
              <Stat big={String(p.flashcards_in_library)} small="cards" />
            </Row>
          );
        })()}

        {p.average_score_percent != null && p.assessments_taken > 0 ? (
          <Pressable onPress={() => router.push({ pathname: '/revision/[id]', params: { id: docId! } })}>
            <Card kind="accent" flat>
              <Row gap={8}>
                <Ionicons name="flag-outline" size={16} color={C.accent} />
                <T v="small" style={{ flex: 1 }}>
                  Revise the questions you missed before — practice tests bias toward your weak areas.
                </T>
                <Ionicons name="chevron-forward" size={16} color={C.accent} />
              </Row>
            </Card>
          </Pressable>
        ) : null}
      </Screen>
    </View>
  );
}
