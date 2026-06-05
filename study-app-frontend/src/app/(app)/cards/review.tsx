import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Bar } from '@/components/ui/Bar';
import { MD } from '@/components/ui/MD';
import { Sources } from '@/components/ui/Sources';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { F, useTheme } from '@/lib/theme';
const RATINGS: { rating: 0 | 3 | 4 | 5; label: string; sub: string; emphasis: boolean }[] = [
  { rating: 0, label: 'Again', sub: '<1m', emphasis: false },
  { rating: 3, label: 'Hard',  sub: '1d',  emphasis: false },
  { rating: 4, label: 'Good',  sub: '3d',  emphasis: true  },
  { rating: 5, label: 'Easy',  sub: '6d',  emphasis: false },
];

export default function ReviewCards() {

  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { documentId } = useLocalSearchParams<{ documentId: string }>();

  const due = useQuery({
    queryKey: ['due', documentId],
    queryFn: () => api.flashcardsDue({ document_id: documentId, limit: 50 }),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const cards = due.data?.cards ?? [];
  const c = cards[idx];

  const rate = useMutation({
    mutationFn: ({ cardId, rating }: { cardId: string; rating: number }) =>
      api.flashcardReview(cardId, rating),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cards', documentId] }),
  });

  // Advance the UI *before* the API responds — SM-2 math is server-side but
  // the user already knows the next card is coming.
  function onRate(rating: number) {
    rate.mutate({ cardId: c.id, rating });
    setRevealed(false);
    setIdx((i) => i + 1);
  }

  if (due.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="Review" />
        <Screen><Loading /></Screen>
      </View>
    );
  }

  if (!cards.length) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="Review" />
        <Screen>
          <View style={{ alignItems: 'center', marginTop: 30, gap: 8 }}>
            <Ionicons name="checkmark-circle" size={48} color={C.ok} />
            <T v="handH2">No cards due</T>
            <T v="small" style={{ textAlign: 'center' }}>Come back when more cards are scheduled for review.</T>
            <Button label="Back to cards" kind="soft" block onPress={() => router.back()} />
          </View>
        </Screen>
      </View>
    );
  }

  if (idx >= cards.length) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="Review" />
        <Screen>
          <View style={{ alignItems: 'center', marginTop: 30, gap: 8 }}>
            <Ionicons name="trophy-outline" size={48} color={C.accent} />
            <T v="handH2">All caught up!</T>
            <T v="small" style={{ textAlign: 'center' }}>
              You reviewed every due card. Studae will schedule the next batch.
            </T>
            <Button label="Done" kind="pri" block onPress={() => router.replace('/(app)/cards')} />
          </View>
        </Screen>
      </View>
    );
  }

  const pct = Math.round(((idx + 1) / cards.length) * 100);

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Review" />
      <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Bar pct={pct} /></View>
      <Screen>
        <T v="mut">Card {idx + 1} of {cards.length}</T>

        <Pressable onPress={() => setRevealed(true)}>
          <Card style={{ minHeight: 240, justifyContent: 'center', padding: 20 }}>
            <Col gap={14} style={{ alignItems: 'center' }}>
              <T v="mut">QUESTION</T>
              <T v="handH2" style={{ textAlign: 'center' }}>{c.front}</T>
              {revealed ? (
                <>
                  <Divider />
                  <T v="mut">ANSWER</T>
                  <View style={{ width: '100%' }}>
                    <MD>{c.back}</MD>
                  </View>
                  {c.sources?.length ? <Sources items={c.sources} /> : null}
                </>
              ) : (
                <T v="small">tap to reveal</T>
              )}
            </Col>
          </Card>
        </Pressable>

        {revealed ? (
          <>
            <T v="mut">How well did you recall it?</T>
            <Row gap={8}>
              {RATINGS.map((r) => (
                <Pressable
                  key={r.rating}
                  onPress={() => onRate(r.rating)}
                  style={{ flex: 1 }}
                >
                  <Card
                    kind={r.emphasis ? 'accent' : 'soft'}
                    style={{ padding: 9, alignItems: 'center' }}
                  >
                    <T style={{ fontFamily: F.hand, fontSize: 17, color: C.ink }}>{r.label}</T>
                    <T v="mut">{r.sub}</T>
                  </Card>
                </Pressable>
              ))}
            </Row>
          </>
        ) : null}
      </Screen>
    </View>
  );
}
