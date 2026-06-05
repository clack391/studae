import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Bar } from '@/components/ui/Bar';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { Badge } from '@/components/ui/Badge';
import { DocThumb } from '@/components/domain/DocThumb';
import { DocRowSkeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import type { DocumentProgress } from '@/lib/types';

export default function Library() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  useFocusEffect(useCallback(() => { dash.refetch(); }, []));

  const prefetchDoc = (id: string) =>
    qc.prefetchQuery({ queryKey: ['doc', id], queryFn: () => api.getDocument(id) });

  const filtered = (dash.data?.documents ?? []).filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase()));
  const readyDocs = filtered.filter((d) => d.status === 'ready');

  // Fan out one /documents/{id}/progress per ready doc — cheap reads, no AI
  // cost. Each query caches for 30 s, so revisiting the screen is instant.
  const progressQueries = useQueries({
    queries: readyDocs.map((d) => ({
      queryKey: ['progress', d.id],
      queryFn: () => api.documentProgress(d.id),
    })),
  });
  const progByDoc = new Map<string, DocumentProgress>();
  readyDocs.forEach((d, i) => {
    const p = progressQueries[i]?.data;
    if (p) progByDoc.set(d.id, p);
  });

  return (
    <View style={{ flex: 1 }}>
      <AppBar title="Library" />
      <Screen refreshing={dash.isRefetching} onRefresh={() => dash.refetch()}>
        <Field value={q} onChangeText={setQ} placeholder="Search your documents" />

        {dash.isPending ? (
          <>
            <DocRowSkeleton />
            <DocRowSkeleton />
            <DocRowSkeleton />
          </>
        ) : null}

        {filtered.map((d) => {
          const ready = d.status === 'ready';
          const failed = d.status === 'failed';
          const tap = ready ? `/(app)/library/${d.id}` : !failed ? `/ingest/${d.id}` : null;
          const p = progByDoc.get(d.id);
          const taughtPct = p && p.topics_total ? Math.round((p.topics_taught / p.topics_total) * 100) : 0;

          // Compose the meta line. "{N} topics · {M} taught · {X}% avg" when
          // we have progress data; falls back to status string otherwise.
          let meta = 'tap to open';
          if (ready && p) {
            const parts: string[] = [];
            if (p.topics_total) parts.push(`${p.topics_total} topic${p.topics_total === 1 ? '' : 's'}`);
            if (p.topics_taught) parts.push(`${p.topics_taught} taught`);
            if (p.average_score_percent != null) parts.push(`${p.average_score_percent}% avg`);
            meta = parts.length ? parts.join(' · ') : 'tap to open';
          } else if (failed) {
            meta = 'could not read — tap to re-upload';
          } else if (!ready) {
            meta = d.progress ?? 'tap to view progress';
          }

          return (
            <Pressable
              key={d.id}
              onPressIn={() => ready && prefetchDoc(d.id)}
              onPress={() => tap && router.push(tap)}
            >
              <Card kind="soft">
                <Row top>
                  <DocThumb />
                  <Col gap={6} style={{ flex: 1 }}>
                    <Row between>
                      <T v="bodyB" numberOfLines={1} style={{ flex: 1 }}>{d.title}</T>
                      <Badge
                        label={ready ? 'ready' : failed ? 'failed' : 'processing'}
                        kind={ready ? 'ok' : failed ? 'err' : 'warn'}
                      />
                    </Row>
                    {ready && p && p.topics_total ? <Bar pct={taughtPct} /> : null}
                    <T v="mut">{meta}</T>
                  </Col>
                </Row>
              </Card>
            </Pressable>
          );
        })}

        {!dash.isPending && !filtered.length ? (
          <T v="small" style={{ textAlign: 'center', marginTop: 20 }}>
            {q ? `No documents match "${q}".` : 'No documents yet.'}
          </T>
        ) : null}

        <Button label="+  Upload a chapter" kind="pri" block onPress={() => router.push('/upload')} />
      </Screen>
    </View>
  );
}
