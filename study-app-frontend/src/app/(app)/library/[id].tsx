import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { T } from '@/components/ui/T';
import { Badge } from '@/components/ui/Badge';
import { Bar } from '@/components/ui/Bar';
import { Button } from '@/components/ui/Button';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { DocThumb } from '@/components/domain/DocThumb';
import { api, ApiError } from '@/lib/api';
import { useTheme } from '@/lib/theme';
/* ---------- 2x2 action tile ---------- */
function ActionTile({ icon, label, onPress, onPressIn }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  onPressIn?: () => void;
}) {
  const C = useTheme();
  return (
    <Pressable onPressIn={onPressIn} onPress={onPress} style={{ flex: 1 }}>
      <Card kind="soft" style={{ alignItems: 'center', gap: 6, paddingVertical: 18 }}>
        <Ionicons name={icon} size={26} color={C.accent} />
        <T v="handH3" style={{ textAlign: 'center' }}>{label}</T>
      </Card>
    </Pressable>
  );
}

/* ---------- secondary "row" link (Lesson history / Your progress) ---------- */
function LinkRow({ icon, title, sub, onPress, onPressIn }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  onPress: () => void;
  onPressIn?: () => void;
}) {
  const C = useTheme();
  return (
    <Pressable onPressIn={onPressIn} onPress={onPress}>
      <Card kind="soft" flat>
        <Row gap={10}>
          <Ionicons name={icon} size={18} color={C.ink2} />
          <Col gap={2} style={{ flex: 1 }}>
            <T v="bodyB">{title}</T>
            <T v="small">{sub}</T>
          </Col>
          <Ionicons name="chevron-forward" size={16} color={C.ink2} />
        </Row>
      </Card>
    </Pressable>
  );
}

export default function DocDetail() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const doc = useQuery({ queryKey: ['doc', id], queryFn: () => api.getDocument(id!) });
  // Same cache key + limit as /history/[docId] so the two screens share the
  // result. Cached for 30 s by the global QueryClient.
  const sessions = useQuery({
    queryKey: ['sessions', id, 'history'],
    queryFn: () => api.listSessions({ document_id: id!, limit: 50 }),
  });
  const prog = useQuery({
    queryKey: ['progress', id],
    queryFn: () => api.documentProgress(id!),
  });
  useFocusEffect(useCallback(() => { doc.refetch(); sessions.refetch(); prog.refetch(); }, [id]));

  // Document doesn't exist for this user (deleted, or never persisted). The
  // detail screen has nothing to render, so send the user back to the library
  // rather than leaving them on a broken page that re-404s on every refocus.
  useEffect(() => {
    if (doc.error instanceof ApiError && doc.error.status === 404) {
      router.navigate('/(app)/library');
    }
  }, [doc.error, router]);

  const del = useMutation({
    mutationFn: () => api.deleteDocument(id!),
    onSuccess: () => {
      // Bust every list that surfaces this document.
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['focus-areas-all'] });
      qc.removeQueries({ queryKey: ['doc', id] });
      qc.removeQueries({ queryKey: ['cards', id] });
      qc.removeQueries({ queryKey: ['due', id] });
      qc.removeQueries({ queryKey: ['progress', id] });
      qc.removeQueries({ queryKey: ['sessions', id, 'history'] });
      router.back();
    },
    onError: (e: any) => Alert.alert('Could not delete', e?.message ?? ''),
  });

  function confirmDelete() {
    setDeleteOpen(true);
  }

  // Prefetch the progress screen's data on touch-start so it's warm by the
  // time the slide animation lands. Lesson history shares its cache with us
  // already, so no prefetch needed there.
  const prefetchProgress = () => qc.prefetchQuery({
    queryKey: ['progress', id],
    queryFn: () => api.documentProgress(id!),
  });

  const d = doc.data;
  const outline = d?.outline_points ?? [];
  const total = d?.topics_total ?? 0;
  const taught = d?.topics_taught ?? 0;
  const resumable = sessions.data?.sessions.find((s) => s.mode === 'teach' && (s.current_outline_point ?? 0) > 0);

  // The session's `current_outline_point` is the 0-indexed position of the
  // NEXT topic to teach. So topic at that index is the "currently on" topic.
  const resumeTopicName = resumable && outline[resumable.current_outline_point ?? 0];
  const resumeTopicNumber = resumable ? (resumable.current_outline_point ?? 0) + 1 : 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar
        back
        // Always land on the library list. Users can reach this screen from
        // Home (tap a doc card) or from the Library tab list, and they expect
        // back to take them to "all my documents" either way.
        onBack={() => router.navigate('/(app)/library')}
        title={d?.title ?? '…'}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete document"
            onPress={confirmDelete}
            hitSlop={10}
            disabled={del.isPending}
          >
            <Ionicons name="trash-outline" size={20} color={C.ink} />
          </Pressable>
        }
      />
      <Screen refreshing={doc.isRefetching} onRefresh={() => { doc.refetch(); sessions.refetch(); prog.refetch(); }}>
        {/* ---- header row: thumb + meta + badges ---- */}
        <Row top>
          <DocThumb />
          <Col gap={6} style={{ flex: 1 }}>
            <T v="bodyB" numberOfLines={2}>{d?.title ?? 'Document'}</T>
            <T v="mut">
              {total ? `${total} topic${total === 1 ? '' : 's'}` : 'no outline yet'}
              {d?.page_count ? ` · ${d.page_count} pages` : ''}
            </T>
            <Row wrap gap={6}>
              {d?.status ? <Badge label={d.status} kind={d.status === 'ready' ? 'ok' : d.status === 'failed' ? 'err' : 'warn'} /> : null}
              {total ? <Badge label={`${taught} / ${total} taught`} kind="out" /> : null}
            </Row>
          </Col>
        </Row>

        {/* ---- Continue card ---- */}
        {resumable && total ? (
          <Card kind="accent">
            <Row between>
              <T v="mut">CONTINUE WHERE YOU LEFT OFF</T>
              <Badge label="resumes free" kind="out" />
            </Row>
            <T v="handH3" numberOfLines={2}>{resumeTopicName ?? `Topic ${resumeTopicNumber}`}</T>
            <T v="small">Teach mode · topic {resumeTopicNumber} of {total}</T>
            <Bar pct={Math.round(((resumable.current_outline_point ?? 0) / total) * 100)} />
            <Button
              label="Resume lesson →"
              kind="pri"
              block
              onPress={() => router.push({ pathname: '/learn/teach', params: { sessionId: resumable.id, documentId: id } })}
            />
          </Card>
        ) : null}

        {/* ---- New lesson | Ask ---- */}
        <Row gap={10}>
          <View style={{ flex: 1 }}>
            <Button
              label="New lesson"
              kind="soft"
              block
              onPress={() => router.push({ pathname: '/learn/level', params: { documentId: id } })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Ask"
              kind="soft"
              block
              onPress={() => router.push({ pathname: '/learn/ask', params: { documentId: id } })}
            />
          </View>
        </Row>

        {/* ---- 2x2 action grid ---- */}
        <Row gap={10}>
          <ActionTile
            icon="trophy-outline"
            label="Test me"
            onPress={() => router.push({ pathname: '/test/create', params: { documentId: id } })}
          />
          <ActionTile
            icon="albums-outline"
            label="Flashcards"
            onPress={() => router.push({ pathname: '/(app)/cards', params: { documentId: id } })}
          />
        </Row>
        <Row gap={10}>
          <ActionTile
            icon="document-text-outline"
            label="Summarize"
            onPress={() => router.push({ pathname: '/summary/[docId]', params: { docId: id! } })}
          />
          <ActionTile
            icon="flag-outline"
            label="Exam prep"
            onPress={() => router.push({ pathname: '/(app)/exams/focus-new', params: { documentId: id } })}
          />
        </Row>

        {/* ---- secondary rows: Lesson history + Your progress ---- */}
        <LinkRow
          icon="time-outline"
          title="Lesson history"
          sub={`${(sessions.data?.sessions ?? []).length} past lesson${(sessions.data?.sessions ?? []).length === 1 ? '' : 's'} · review any`}
          onPress={() => router.push({ pathname: '/history/[docId]', params: { docId: id! } })}
        />
        <LinkRow
          icon="stats-chart-outline"
          title="Your progress"
          sub={total
            ? `${taught} / ${total} taught${prog.data?.average_score_percent != null ? ` · ${prog.data.average_score_percent}% avg` : ''}`
            : 'topics, score, cards'}
          onPressIn={prefetchProgress}
          onPress={() => router.push({ pathname: '/progress/[docId]', params: { docId: id! } })}
        />

        {/* ---- Outline ---- */}
        <Row between>
          <T v="handH3">Outline</T>
          <T v="small">Claude-built</T>
        </Row>
        <Card kind="soft">
          {outline.slice(0, 8).map((topic, i) => {
            const isTaught = i < taught;
            return (
              <View key={i}>
                {i ? <Divider /> : null}
                <Row>
                  <T style={{ width: 22, fontWeight: '800', fontSize: 11, color: isTaught ? C.accent : C.ink3 }}>
                    {String(i + 1).padStart(2, '0')}
                  </T>
                  <T v={isTaught ? 'bodyB' : 'body'} style={{ flex: 1 }}>{topic}</T>
                  {isTaught ? <Ionicons name="checkmark" size={15} color={C.accent} /> : null}
                </Row>
              </View>
            );
          })}
          {outline.length > 8 ? (
            <View style={{ alignItems: 'center', marginTop: 4 }}>
              <T v="bodyB">+ {outline.length - 8} more topics</T>
            </View>
          ) : null}
          {!outline.length ? (
            <T v="small" style={{ textAlign: 'center' }}>No outline yet. Has this document finished ingesting?</T>
          ) : null}
        </Card>
      </Screen>

      <ConfirmSheet
        visible={deleteOpen}
        tone="danger"
        title="Delete this document?"
        message="Everything tied to it (lessons, flashcards, tests, focus areas, results) will be removed. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => del.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </View>
  );
}
