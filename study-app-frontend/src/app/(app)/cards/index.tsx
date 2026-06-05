import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Segmented';
import { Stat } from '@/components/ui/Bar';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { useTheme } from '@/lib/theme';
import type { Flashcard } from '@/lib/types';

function isMastered(c: Flashcard): boolean {
  return (c.repetitions ?? 0) >= 3 && (c.interval_days ?? 0) >= 21;
}

export default function CardsHome() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { documentId: incoming, focusAreaId } = useLocalSearchParams<{ documentId?: string; focusAreaId?: string }>();

  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  const readyDocs = (dash.data?.documents ?? []).filter((d) => d.status === 'ready');

  const [docId, setDocId] = useState<string | undefined>(incoming);
  useEffect(() => {
    if (!docId && readyDocs.length) setDocId(readyDocs[0].id);
  }, [readyDocs.length, docId]);

  const focus = useQuery({
    queryKey: ['focus', focusAreaId],
    queryFn: () => api.focusGet(focusAreaId!),
    enabled: !!focusAreaId,
  });

  const cards = useQuery({
    queryKey: ['cards', docId],
    queryFn: () => api.flashcardsForDocument(docId!),
    enabled: !!docId,
  });
  const due = useQuery({
    queryKey: ['due', docId],
    queryFn: () => api.flashcardsDue({ document_id: docId, limit: 50 }),
    enabled: !!docId,
  });
  useFocusEffect(useCallback(() => { dash.refetch(); cards.refetch(); due.refetch(); }, [docId]));

  const generate = useMutation({
    mutationFn: () => api.flashcardsGenerate({
      document_id: docId!, num: 10,
      level: dash.data?.preferred_level ?? 'novice',
      focus_area_id: focusAreaId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cards', docId] });
      qc.invalidateQueries({ queryKey: ['due', docId] });
    },
    onError: (e: any) => {
      if (on402(e, router, 'assessment')) return;
      Alert.alert('Could not generate', e?.message ?? '');
    },
  });

  const del = useMutation({
    mutationFn: (cardId: string) => api.flashcardDelete(cardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cards', docId] });
      qc.invalidateQueries({ queryKey: ['due', docId] });
    },
  });

  if (!readyDocs.length) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar title="Cards" />
        <Screen>
          <View style={{ alignItems: 'center', marginTop: 24, gap: 8 }}>
            <Ionicons name="albums-outline" size={40} color={C.ink3} />
            <T v="handH3">No cards yet</T>
            <T v="small" style={{ textAlign: 'center' }}>
              Upload a document first — flashcards are generated from your material.
            </T>
          </View>
        </Screen>
      </View>
    );
  }

  const list = cards.data?.cards ?? [];
  const dueCount = due.data?.cards.length ?? 0;
  const mastered = list.filter(isMastered).length;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar title="Cards" />
      <Screen refreshing={cards.isRefetching} onRefresh={() => { cards.refetch(); due.refetch(); }}>
        {readyDocs.length > 1 && !focusAreaId ? (
          <Row wrap gap={6}>
            {readyDocs.map((d) => (
              <Chip key={d.id} label={d.title.length > 20 ? d.title.slice(0, 20) + '…' : d.title} on={d.id === docId} onPress={() => setDocId(d.id)} />
            ))}
          </Row>
        ) : null}

        {focus.data ? (
          <Card kind="accent" flat>
            <Row>
              <Ionicons name="flag-outline" size={16} color={C.accent} />
              <Col gap={2} style={{ flex: 1 }}>
                <T v="bodyB">Scoped to: {focus.data.name}</T>
                <T v="mut" numberOfLines={1}>{focus.data.topics.join(' · ')}</T>
              </Col>
            </Row>
          </Card>
        ) : null}

        <Row between gap={20}>
          <Stat big={String(list.length)} small="cards" />
          <Stat big={String(dueCount)} small="due now" />
          <Stat big={String(mastered)} small="mastered" />
        </Row>

        {dueCount > 0 ? (
          <Button
            label={`Review ${dueCount} due card${dueCount === 1 ? '' : 's'}`}
            kind="pri"
            block
            onPress={() => router.push({ pathname: '/(app)/cards/review', params: { documentId: docId! } })}
          />
        ) : (
          <Card kind="accent" flat>
            <Row>
              <Ionicons name="checkmark-circle" size={18} color={C.accent} />
              <T v="small" style={{ flex: 1 }}>All caught up — no cards are due right now.</T>
            </Row>
          </Card>
        )}

        <Button
          label={generate.isPending ? 'Generating…' : list.length ? 'Generate more cards' : 'Generate your first cards'}
          kind="soft"
          block
          onPress={() => generate.mutate()}
          disabled={generate.isPending}
        />

        {generate.isPending ? (
          <>
            <IndeterminateBar />
            <AIThinking
              title="Writing your cards"
              tips={[
                'Reviewing cards is free — only generation counts against the cap.',
                'A card is "mastered" when you\'ve rated it well 3 times and it\'s scheduled 21+ days out.',
                'Studae picks card fronts that prompt recall, not recognition.',
              ]}
            />
          </>
        ) : null}

        {list.map((c) => {
          const m = isMastered(c);
          return (
            <Card key={c.id} kind="soft">
              <Row top>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m ? C.ok : C.line, marginTop: 6 }} />
                <Col gap={4} style={{ flex: 1 }}>
                  <T v="bodyB">{c.front}</T>
                  <T v="mut">
                    {m ? `mastered · next in ${c.interval_days}d`
                       : c.next_review_at ? `due ${new Date(c.next_review_at).toLocaleDateString()}`
                       : 'new'}
                  </T>
                </Col>
                <Pressable
                  onPress={() => Alert.alert('Delete card?', 'This can\'t be undone.', [
                    { text: 'Cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => del.mutate(c.id) },
                  ])}
                  hitSlop={10}
                >
                  <Ionicons name="trash-outline" size={18} color={C.ink2} />
                </Pressable>
              </Row>
            </Card>
          );
        })}
      </Screen>
    </View>
  );
}
