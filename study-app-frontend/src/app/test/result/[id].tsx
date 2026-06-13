import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Ring } from '@/components/ui/Ring';
import { Bar } from '@/components/ui/Bar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
function pct(score: number | null | undefined, total: number | null | undefined): number {
  if (!score || !total) return 0;
  return Math.round((score / total) * 100);
}

export default function Result() {
  const C = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['history', id], queryFn: () => api.historyDetail(id!) });

  if (q.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="Results" />
        <Screen>
          <IndeterminateBar />
          <AIThinking
            title="Marking your test"
            tips={[
              'Objective questions are checked against the saved correct option.',
              'Theory answers are graded against the rubric, scored by meaning rather than exact wording.',
              'Photo answers run OCR first, then are graded on the work shown.',
              'Your overall score and per-question breakdown appear when grading finishes.',
            ]}
          />
        </Screen>
      </View>
    );
  }

  const a = q.data?.assessment;
  const results = q.data?.results ?? [];
  const score = a?.score ?? 0;
  const total = a?.total_points ?? 0;
  const overall = pct(score, total);

  const obj = results.filter((r) => r.type === 'objective');
  const the = results.filter((r) => r.type === 'theory');
  const objScore = obj.reduce((s, r) => s + (r.score ?? 0), 0);
  const objTotal = obj.reduce((s, r) => s + r.out_of, 0);
  const theScore = the.reduce((s, r) => s + (r.score ?? 0), 0);
  const theTotal = the.reduce((s, r) => s + r.out_of, 0);

  const isExam = a?.kind === 'exam';
  const releaseAt = q.data?.answers_release_at ? new Date(q.data.answers_release_at) : null;
  const locked = isExam && releaseAt && releaseAt > new Date();

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title={isExam ? 'Exam results' : 'Results'} />
      <Screen>
        {isExam ? (
          <View style={{ alignItems: 'center' }}>
            <Badge label="Official exam" kind="exam" />
          </View>
        ) : null}

        <View style={{ alignItems: 'center', gap: 6 }}>
          <Ring pct={overall} label={`${overall}%`} sub="score" size={100} />
          <T v="handH2">{score} of {total} correct</T>
          <T v="mut">{a?.format} {a?.kind}</T>
        </View>

        {locked && releaseAt ? (
          <Card kind="accent" flat>
            <Row>
              <Ionicons name="time-outline" size={16} color={C.accent} />
              <T v="small" style={{ flex: 1 }}>
                Full marking scheme unlocks {releaseAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
              </T>
            </Row>
          </Card>
        ) : null}

        <Card kind="soft">
          {objTotal > 0 ? (
            <Col gap={6}>
              <Row between>
                <T v="bodyB">Objective</T>
                <T v="small">{objScore} / {objTotal}</T>
              </Row>
              <Bar pct={objTotal ? (objScore / objTotal) * 100 : 0} color={C.ok} />
            </Col>
          ) : null}
          {objTotal > 0 && theTotal > 0 ? <Divider /> : null}
          {theTotal > 0 ? (
            <Col gap={6}>
              <Row between>
                <T v="bodyB">Theory</T>
                <T v="small">{theScore} / {theTotal}</T>
              </Row>
              <Bar pct={theTotal ? (theScore / theTotal) * 100 : 0} color={C.warn} />
            </Col>
          ) : null}
        </Card>

        <Button
          label="Review answers"
          kind="pri"
          block
          onPress={() => router.push({ pathname: '/test/review/[id]', params: { id: id! } })}
        />
        <Button label="Back to home" kind="soft" block onPress={() => router.replace('/(app)/home')} />
      </Screen>
    </View>
  );
}
