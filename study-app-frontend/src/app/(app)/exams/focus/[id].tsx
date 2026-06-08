import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Segmented';
import { Ring } from '@/components/ui/Ring';
import { Loading } from '@/components/ui/Loading';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { daysUntil } from '@/lib/format';
import { useTheme } from '@/lib/theme';
function CTA({ icon, title, sub, onPress }: { icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap; title: string; sub: string; onPress: () => void }) {
  const C = useTheme();
  return (
    <Pressable onPress={onPress}>
      <Card>
        <Row top>
          <View
            style={{
              width: 44, height: 44, borderRadius: 12,
              backgroundColor: C.accentSoft,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={24} color={C.accent} />
          </View>
          <Col gap={4} style={{ flex: 1 }}>
            <T v="handH3">{title}</T>
            <T v="small">{sub}</T>
          </Col>
          <Ionicons name="chevron-forward" size={16} color={C.ink2} />
        </Row>
      </Card>
    </Pressable>
  );
}

export default function FocusHub() {

  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const fa = useQuery({ queryKey: ['focus', id], queryFn: () => api.focusGet(id!) });
  useFocusEffect(useCallback(() => { fa.refetch(); }, [id]));

  const del = useMutation({
    mutationFn: () => api.focusDelete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['focus-areas-all'] });
      router.back();
    },
  });

  // Drives the on-brand ConfirmSheet for the destructive delete in place
  // of the OS Alert dialog.
  const [deleteOpen, setDeleteOpen] = useState(false);

  const f = fa.data;
  if (!f) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="Focus area" />
        <Screen><Loading /></Screen>
      </View>
    );
  }

  const days = daysUntil(f.exam_date);
  const examDateLabel = f.exam_date
    ? new Date(f.exam_date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'No date set';

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar
        back
        title={f.name}
        right={
          <Pressable
            onPress={() => setDeleteOpen(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Delete focus area"
          >
            <Ionicons name="trash-outline" size={20} color={C.ink} />
          </Pressable>
        }
      />
      <Screen>
        <Card kind="accent">
          <Row top>
            {days != null ? (
              <Ring pct={Math.max(8, 100 - days * 4)} label={String(days)} sub={days === 1 ? 'day' : 'days'} />
            ) : null}
            <Col gap={6} style={{ flex: 1 }}>
              <T v="mut">EXAM ON</T>
              <T v="handH3">{examDateLabel}</T>
              <Row wrap gap={6}>
                {f.topics.map((t) => <Chip key={t} label={t} on />)}
              </Row>
            </Col>
          </Row>
        </Card>

        <T v="handH3">Study these topics</T>
        <CTA
          icon="sparkles-outline"
          title="Walk me through these"
          sub="A guided lesson, in order"
          onPress={() => router.push({ pathname: '/learn/level', params: { documentId: f.document_id, focusAreaId: f.id } })}
        />
        <CTA
          icon="albums-outline"
          title="Make flashcards"
          sub="Spaced repetition on these topics"
          onPress={() => router.push({ pathname: '/(app)/cards', params: { documentId: f.document_id, focusAreaId: f.id } })}
        />
        <CTA
          icon="trophy-outline"
          title="Test me"
          sub="A test scoped to this focus area"
          onPress={() => router.push({ pathname: '/test/create', params: { documentId: f.document_id, focusAreaId: f.id } })}
        />
      </Screen>

      <ConfirmSheet
        visible={deleteOpen}
        tone="danger"
        title="Delete focus area?"
        message="You can rebuild it any time."
        confirmLabel="Delete"
        onConfirm={() => del.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </View>
  );
}
