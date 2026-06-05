import { useEffect } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Bar } from '@/components/ui/Bar';
import { T } from '@/components/ui/T';
import { DocThumb } from '@/components/domain/DocThumb';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
const STAGES = [
  { key: 'extract', label: 'Extracting text', tokens: ['extract', 'reading', 'ocr'] },
  { key: 'embed',   label: 'Embedding chunks', tokens: ['embed', 'chunk'] },
  { key: 'outline', label: 'Building outline', tokens: ['outline'] },
];

export default function Ingest() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = useQuery({
    queryKey: ['doc', id],
    queryFn: () => api.getDocument(id!),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.status === 'ready' || d.status === 'failed') ? false : 2000;
    },
  });

  // When ingestion settles, invalidate the dashboard so the next visit to
  // Home / Library shows the doc in its final state without waiting for the
  // 30 s staleTime to expire. Then auto-route the user into the doc detail
  // once status flips to ready.
  useEffect(() => {
    const status = doc.data?.status;
    if (status === 'ready' || status === 'failed') {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    }
    if (status === 'ready') {
      const t = setTimeout(() => router.replace(`/(app)/library/${id}`), 600);
      return () => clearTimeout(t);
    }
  }, [doc.data?.status, id, router, qc]);

  const del = useMutation({
    mutationFn: () => api.deleteDocument(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.removeQueries({ queryKey: ['doc', id] });
      router.back();
    },
    onError: (e: any) => Alert.alert('Could not delete', e?.message ?? ''),
  });

  function confirmDelete() {
    Alert.alert(
      'Delete this document?',
      'It will be removed from your library and from storage. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
      ],
    );
  }

  const d = doc.data;
  const prog = (d?.progress ?? '').toLowerCase();
  const stageIdx = STAGES.findIndex((s) => s.tokens.some((t) => prog.includes(t)));
  const idx = stageIdx === -1 ? 0 : stageIdx;
  const m = prog.match(/(\d+)\s*(?:of|\/)\s*(\d+)/);
  const pct = m ? Math.round((+m[1] / +m[2]) * 100) : d?.status === 'ready' ? 100 : Math.min(95, (idx + 1) * 30);

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar
        back
        title="Processing"
        right={
          <Pressable onPress={confirmDelete} hitSlop={10} disabled={del.isPending}>
            <Ionicons name="trash-outline" size={20} color={C.ink} />
          </Pressable>
        }
      />
      <Screen>
        <Card>
          <Row top>
            <DocThumb />
            <Col gap={6} style={{ flex: 1 }}>
              <T v="bodyB" numberOfLines={2}>{d?.title ?? 'New document'}</T>
              <T v="small">{d?.outline_points?.length ? `${d.outline_points.length} topics` : 'reading…'}</T>
            </Col>
          </Row>
          <Divider />
          <T v="bodyB">{d?.progress ?? (d?.status === 'ready' ? 'Done!' : 'Starting…')}</T>
          <Bar pct={pct} />
          <T v="mut">Ingestion runs in the background — you can leave this screen.</T>
        </Card>
        <Col>
          {STAGES.map((s, i) => {
            const state = d?.status === 'ready' ? 'done' : i < idx ? 'done' : i === idx ? 'now' : 'wait';
            return (
              <Row key={s.key}>
                <View
                  style={{
                    width: 22, height: 22, borderRadius: 11,
                    borderWidth: 2, borderStyle: state === 'wait' ? 'dashed' : 'solid',
                    borderColor: state === 'wait' ? C.line : C.accent,
                    backgroundColor: state === 'done' ? C.accent : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {state === 'done' ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                  {state === 'now' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} /> : null}
                </View>
                <T v={state === 'wait' ? 'body' : 'bodyB'} style={{ flex: 1 }}>{s.label}</T>
                {state === 'now' ? <T v="mut">working…</T> : null}
              </Row>
            );
          })}
        </Col>
        {d?.status === 'failed' ? (
          <Card flat style={{ borderColor: C.err }}>
            <Row>
              <Ionicons name="alert-circle" size={18} color={C.err} />
              <T v="small" style={{ flex: 1 }}>
                Ingestion failed: {d.progress ?? 'unknown reason'}.
              </T>
            </Row>
          </Card>
        ) : null}
      </Screen>
    </View>
  );
}
