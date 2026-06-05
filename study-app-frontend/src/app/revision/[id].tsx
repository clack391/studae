import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { MD } from '@/components/ui/MD';
import { Loading } from '@/components/ui/Loading';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { useTheme } from '@/lib/theme';
export default function Revise() {
  const C = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  const misses = useQuery({
    queryKey: ['misses', id],
    queryFn: () => api.revisionMisses(id!),
  });

  const practice = useMutation({
    mutationFn: () => api.revisionPractice({
      document_id: id!,
      level: dash.data?.preferred_level ?? 'novice',
    }),
    onSuccess: (r) => router.replace({ pathname: '/test/take/[id]', params: { id: r.assessment_id } }),
    onError: (e: any) => {
      if (on402(e, router, 'assessment')) return;
      Alert.alert('Could not generate', e?.message ?? '');
    },
  });

  const list = misses.data?.misses ?? [];
  const title = dash.data?.documents.find((d) => d.id === id)?.title ?? 'Revise';

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Revise" />
      <Screen refreshing={misses.isRefetching} onRefresh={() => misses.refetch()}>
        <T v="mut">FROM</T>
        <T v="handH3">{title}</T>

        {misses.isPending ? (
          <Loading />
        ) : list.length ? (
          <>
            <T v="handH2">{list.length} question{list.length === 1 ? '' : 's'} you missed</T>
            {list.map((m, i) => (
              <Card key={i} kind="soft" style={{ borderColor: C.err }}>
                <Row between>
                  <Badge label="Missed" kind="err" />
                </Row>
                <T v="bodyB">{m.question}</T>
                <Row top gap={6}>
                  <T v="mut">You said:</T>
                  <T style={{ flex: 1 }}>{m.your_answer || '(left blank)'}</T>
                </Row>
                {m.reference_answer ? (
                  <Row top gap={6}>
                    <T v="mut">Reference:</T>
                    <T style={{ flex: 1 }}>{m.reference_answer}</T>
                  </Row>
                ) : null}
                {m.reasoning ? (
                  <Col gap={2}>
                    <T v="mut">REASONING</T>
                    <MD>{m.reasoning}</MD>
                  </Col>
                ) : null}
              </Card>
            ))}
          </>
        ) : (
          <Card kind="soft">
            <View style={{ alignItems: 'center', padding: 20, gap: 8 }}>
              <Ionicons name="checkmark-circle-outline" size={40} color={C.ok} />
              <T v="handH3">Nothing missed yet</T>
              <T v="small" style={{ textAlign: 'center' }}>
                Take a test on this document — the questions you get wrong land here, and you can practice them.
              </T>
              <Button label="Take a test" kind="pri" onPress={() => router.replace({ pathname: '/test/create', params: { documentId: id } })} />
            </View>
          </Card>
        )}

        {practice.isPending ? (
          <>
            <IndeterminateBar />
            <AIThinking
              title="Writing a practice test"
              tips={[
                'Practice tests lean toward topics you got wrong before.',
                'Take it through the normal flow — same timer, same grading.',
              ]}
            />
          </>
        ) : null}
      </Screen>
      {list.length > 0 ? (
        <View style={{ padding: 12, borderTopWidth: 2, borderColor: C.ink, backgroundColor: C.card }}>
          <Button
            label={practice.isPending ? 'Generating…' : 'Make a practice test biased to these'}
            kind="pri"
            block
            onPress={() => practice.mutate()}
            disabled={practice.isPending}
          />
        </View>
      ) : null}
    </View>
  );
}
