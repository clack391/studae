import { useCallback } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar, IconButton } from '@/components/ui/AppBar';
import { T } from '@/components/ui/T';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Ring } from '@/components/ui/Ring';
import { Bar, Stat } from '@/components/ui/Bar';
import { Chip } from '@/components/ui/Segmented';
import { DocThumb } from '@/components/domain/DocThumb';
import { DocRowSkeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { F, useTheme } from '@/lib/theme';
import { daysUntil, parseProgressText } from '@/lib/format';
import type { ChatSession, FocusArea } from '@/lib/types';

type AreaWithDoc = FocusArea & { document_title: string };

/* ---------- today's-plan row ---------- */
function PlanRow({ done, title, sub, onGo }: { done: boolean; title: string; sub: string; onGo?: () => void }) {
  const C = useTheme();
  return (
    <Row top gap={10}>
      <View
        style={{
          width: 22, height: 22, borderRadius: 6, borderWidth: 2,
          borderColor: done ? C.accent : C.line,
          backgroundColor: done ? C.accent : 'transparent',
          alignItems: 'center', justifyContent: 'center',
          marginTop: 2,
        }}
      >
        {done ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      </View>
      <Col gap={2} style={{ flex: 1 }}>
        <T v="bodyB" style={{ textDecorationLine: done ? 'line-through' : 'none', color: done ? C.ink2 : C.ink }}>{title}</T>
        <T v="small">{sub}</T>
      </Col>
      {done
        ? <T v="small" style={{ color: C.ok, fontWeight: '700' }}>done</T>
        : onGo ? <Button label="Go" kind="soft" size="sm" onPress={onGo} /> : null}
    </Row>
  );
}

export default function Home() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    // While any document is ingesting, poll every 2 s so the in-flight row
    // updates with the latest progress string ("embedding chunk 40 of 80",
    // "building outline", etc.). Stops polling once everything is ready.
    refetchInterval: (q) => {
      const docs = q.state.data?.documents ?? [];
      return docs.some((d) => d.status !== 'ready' && d.status !== 'failed') ? 2000 : false;
    },
  });

  // Across-doc focus areas. One backend call returns every owned focus
  // area annotated with the parent document title (replaces the previous
  // N+1 fan-out where each ready doc fired its own /focus-areas request).
  const focusAll = useQuery<AreaWithDoc[]>({
    queryKey: ['focus-areas-all'],
    queryFn: async () => {
      const r = await api.focusListAll();
      return (r.focus_areas as AreaWithDoc[]).sort((a, b) => {
        const aDate = a.exam_date ? new Date(a.exam_date).getTime() : Infinity;
        const bDate = b.exam_date ? new Date(b.exam_date).getTime() : Infinity;
        return aDate - bDate;
      });
    },
  });

  // Cross-doc due flashcards count.
  const due = useQuery({
    queryKey: ['due', 'all'],
    queryFn: () => api.flashcardsDue({ limit: 100 }),
  });

  // Recent sessions to find any mid-lesson teach resume.
  const sessions = useQuery({
    queryKey: ['sessions', 'all-recent'],
    queryFn: () => api.listSessions({ limit: 20 }),
  });

  useFocusEffect(useCallback(() => {
    dash.refetch();
    focusAll.refetch();
    due.refetch();
    sessions.refetch();
  }, []));

  const prefetchDoc = (id: string) =>
    qc.prefetchQuery({ queryKey: ['doc', id], queryFn: () => api.getDocument(id) });
  const prefetchFocus = (id: string) =>
    qc.prefetchQuery({ queryKey: ['focus', id], queryFn: () => api.focusGet(id) });

  // Time-aware greeting — Morning / Afternoon / Evening based on local hour.
  // Falls back to "Hi" outside the normal study-day window.
  const greeting = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Morning';
    if (h >= 12 && h < 17) return 'Afternoon';
    if (h >= 17 && h < 22) return 'Evening';
    return 'Hi';
  })();

  const userName =
    (dash.data?.name?.split(' ')?.[0]) ||
    (session?.user?.user_metadata as any)?.full_name?.split(' ')?.[0] ||
    session?.user?.email?.split('@')?.[0] ||
    'there';

  const docs = dash.data?.documents ?? [];
  const ready = docs.filter((d) => d.status === 'ready');
  const inFlight = docs.filter((d) => d.status !== 'ready');

  const nextExam = (focusAll.data ?? []).find((f) => f.exam_date && (daysUntil(f.exam_date) ?? 999) >= 0);
  const dueCount = due.data?.cards.length ?? 0;
  const resume = (sessions.data?.sessions ?? [])
    .find((s: ChatSession) => s.mode === 'teach' && (s.current_outline_point ?? 0) > 0);
  const resumeDoc = resume ? ready.find((d) => d.id === resume.document_id) : undefined;

  // Empty / first-run state — single empty-shelf card + a primary upload CTA.
  if (!dash.isPending && docs.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar brand right={<IconButton
              name="notifications-outline"
              onPress={() => Alert.alert('Notifications', "You're all caught up. Reminders and new-content alerts land in the next update.")}
            />} />
        <Screen>
          <View style={{ alignItems: 'center', gap: 18, paddingTop: 28 }}>
            <View
              style={{
                width: 160, height: 160, borderRadius: 18,
                borderWidth: 2, borderColor: C.line, backgroundColor: C.card2,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="library-outline" size={64} color={C.ink3} />
            </View>
            <T v="handH2">Your shelf is empty</T>
            <T style={{ textAlign: 'center', paddingHorizontal: 24 }}>
              Upload your first chapter (a PDF, a scan, or a few photos of your notes) and Studae will teach you from it.
            </T>
            <View style={{ height: 4 }} />
            <Button
              label="+  Upload your first chapter"
              kind="pri"
              size="lg"
              onPress={() => router.push('/upload')}
            />
          </View>
        </Screen>
      </View>
    );
  }

  const examDays = nextExam ? daysUntil(nextExam.exam_date) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar
        brand
        right={
          <Row>
            <IconButton
              name="notifications-outline"
              onPress={() => Alert.alert('Notifications', "You're all caught up. Reminders and new-content alerts land in the next update.")}
            />
            <View
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: C.accentSoft, borderWidth: 2, borderColor: C.accent,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <T style={{ fontFamily: F.hand, fontSize: 15, color: C.accentInk }}>{userName[0]?.toUpperCase() ?? 'M'}</T>
            </View>
          </Row>
        }
      />
      <Screen refreshing={dash.isRefetching} onRefresh={() => { dash.refetch(); focusAll.refetch(); due.refetch(); sessions.refetch(); }}>
        <T v="handH2">{greeting}, {userName}</T>

        {/* ---- C-style: Next exam countdown (only when a focus area with exam_date exists) ---- */}
        {nextExam ? (
          <Pressable
            onPressIn={() => prefetchFocus(nextExam.id)}
            onPress={() => router.push({ pathname: '/(app)/exams/focus/[id]', params: { id: nextExam.id } })}
          >
            <Card kind="accent">
              <Row top gap={14}>
                <Col gap={4} style={{ flex: 1 }}>
                  <T v="mut">NEXT EXAM</T>
                  <T v="handH3">{nextExam.name}</T>
                  <Row wrap gap={6}>
                    {nextExam.topics.slice(0, 3).map((t) => <Chip key={t} label={t} on />)}
                    {nextExam.topics.length > 3 ? <Chip label={`+${nextExam.topics.length - 3}`} on /> : null}
                  </Row>
                </Col>
                {examDays != null ? (
                  <Ring
                    pct={Math.max(8, 100 - examDays * 4)}
                    label={String(examDays)}
                    sub={examDays === 1 ? 'day' : 'days'}
                  />
                ) : null}
              </Row>
            </Card>
          </Pressable>
        ) : null}

        {/* ---- C-style: Today's plan (only when a focus area exists) ---- */}
        {nextExam ? (
          <>
            <Row between>
              <T v="handH3">Today's plan</T>
            </Row>
            <Card kind="soft">
              <PlanRow
                done={dueCount === 0 && (due.data != null)}
                title={dueCount > 0 ? `Review ${dueCount} flashcard${dueCount === 1 ? '' : 's'}` : 'Flashcards caught up'}
                sub="Spaced repetition"
                onGo={dueCount > 0 ? () => router.push('/(app)/cards') : undefined}
              />
              {resume && resumeDoc ? (
                <>
                  <Divider />
                  <PlanRow
                    done={false}
                    title={`Continue: ${resume.title ?? resumeDoc.title}`}
                    sub={`Topic ${resume.current_outline_point}`}
                    onGo={() => router.push({ pathname: '/learn/teach', params: { sessionId: resume.id, documentId: resume.document_id } })}
                  />
                </>
              ) : null}
              <Divider />
              <PlanRow
                done={false}
                title={`Practice: ${nextExam.name}`}
                sub="Test scoped to your focus area"
                onGo={() => router.push({ pathname: '/test/create', params: { documentId: nextExam.document_id, focusAreaId: nextExam.id } })}
              />
            </Card>
          </>
        ) : null}

        {/* ---- Stats row ---- */}
        {dash.data && (dash.data.documents_count > 0 || (dash.data.assessments_taken ?? 0) > 0) ? (
          <Row between gap={20}>
            <Stat big={String(dash.data.documents_count)} small={dash.data.documents_count === 1 ? 'document' : 'documents'} />
            <Stat big={dash.data.average_score_percent != null ? `${dash.data.average_score_percent}%` : '—'} small="avg score" />
            <Stat big={String(dash.data.assessments_taken ?? 0)} small={dash.data.assessments_taken === 1 ? 'test' : 'tests'} />
          </Row>
        ) : null}

        {/* ---- A-style: documents (the spine) ---- */}
        <Row between>
          <T v="handH3">Your documents</T>
          <Pressable onPress={() => router.push('/(app)/library')}>
            <T v="small" style={{ fontWeight: '700' }}>See all</T>
          </Pressable>
        </Row>

        {dash.isPending ? (
          <>
            <DocRowSkeleton />
            <DocRowSkeleton />
          </>
        ) : null}

        {ready.slice(0, 3).map((d) => (
          <Pressable
            key={d.id}
            onPressIn={() => prefetchDoc(d.id)}
            onPress={() => router.push(`/(app)/library/${d.id}`)}
          >
            <Card kind="soft">
              <Row top>
                <DocThumb />
                <Col gap={6} style={{ flex: 1 }}>
                  <T v="bodyB" numberOfLines={1}>{d.title}</T>
                  <T v="small">tap to open</T>
                </Col>
                <Badge label="ready" kind="ok" />
              </Row>
            </Card>
          </Pressable>
        ))}
        {inFlight.map((d) => {
          const { pct } = parseProgressText(d.progress);
          return (
            <Pressable key={d.id} onPress={() => router.push(`/ingest/${d.id}`)}>
              <Card kind="soft">
                <Row top>
                  <DocThumb />
                  <Col gap={6} style={{ flex: 1 }}>
                    <T v="bodyB" numberOfLines={1}>{d.title}</T>
                    <T v="small">{d.progress ?? 'preparing…'}</T>
                    {d.status !== 'failed' ? <Bar pct={pct || 5} /> : null}
                  </Col>
                  <Badge label={d.status === 'failed' ? 'failed' : 'processing'} kind={d.status === 'failed' ? 'err' : 'warn'} />
                </Row>
              </Card>
            </Pressable>
          );
        })}

        {/* Cross-doc cards-due summary. Hidden when Today's plan above
            already surfaces the count (i.e. user has a focus area). */}
        {!nextExam && dueCount > 0 ? (
          <Pressable onPress={() => router.push('/(app)/cards')}>
            <Card kind="fill">
              <Row>
                <Col gap={2} style={{ flex: 1 }}>
                  <T v="handH3">{dueCount} card{dueCount === 1 ? '' : 's'} due</T>
                  <T v="small">Spaced repetition · all books</T>
                </Col>
                <Button label="Review" kind="soft" size="sm" onPress={() => router.push('/(app)/cards')} />
              </Row>
            </Card>
          </Pressable>
        ) : null}

        <Button label="+  Upload a chapter" kind="ghost" block onPress={() => router.push('/upload')} />
      </Screen>
    </View>
  );
}
