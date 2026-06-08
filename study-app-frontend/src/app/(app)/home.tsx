import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar, IconButton } from '@/components/ui/AppBar';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { T } from '@/components/ui/T';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Ring } from '@/components/ui/Ring';
import { Bar, Stat } from '@/components/ui/Bar';
import { Chip } from '@/components/ui/Segmented';
import { DocThumb } from '@/components/domain/DocThumb';
import { Avatar } from '@/components/domain/Avatar';
import { DocRowSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { useTheme, useThemeMode } from '@/lib/theme';
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
          borderColor: done ? C.accentD : C.line,
          backgroundColor: done ? C.accentD : 'transparent',
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

/* ---------- one banner tile (Teach or Ask) ---------- */
function BannerTile({
  kind, icon, label, sub, accessibilityLabel, full, onPress, onPressIn,
}: {
  kind: 'accent' | 'soft';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  accessibilityLabel: string;
  full: boolean;
  onPress: () => void;
  onPressIn?: () => void;
}) {
  const C = useTheme();
  // Accent tile fills with the accent so its content sits on white; soft
  // tile is the cream/soft surface with ink content. Hierarchy by color
  // weight, not size — both tiles are equal size (flex:1 side-by-side, or
  // full-width when stacked for larger text).
  const onAccent = kind === 'accent';
  const titleColor = onAccent ? '#fff' : C.ink;
  const subColor = onAccent ? 'rgba(255,255,255,0.92)' : C.ink2;
  const iconColor = onAccent ? '#fff' : C.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPressIn={onPressIn}
      onPress={onPress}
      style={{ flex: full ? undefined : 1, alignSelf: full ? 'stretch' : undefined }}
    >
      <Card
        kind={kind}
        style={{
          minHeight: 56,
          ...(onAccent ? { backgroundColor: C.accentD, borderColor: C.ink } : null),
        }}
      >
        <Row gap={10}>
          <View
            style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: onAccent ? 'rgba(255,255,255,0.18)' : C.accentSoft,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>
          <Col gap={2} style={{ flex: 1 }}>
            <T v="bodyB" style={{ color: titleColor }} numberOfLines={1}>{label}</T>
            <T v="small" style={{ color: subColor }} numberOfLines={1}>{sub}</T>
          </Col>
        </Row>
      </Card>
    </Pressable>
  );
}

/* ---------- Teach | Ask hero banner ---------- */
function TeachAskBanner({
  doc, resume, taughtComplete, stacked, onTeach, onAsk, onPrefetch,
}: {
  doc: { id: string; title: string };
  resume?: ChatSession;
  taughtComplete: boolean;
  stacked: boolean;
  onTeach: () => void;
  onAsk: () => void;
  onPrefetch: () => void;
}) {
  // Adaptive Teach label from the lesson state of the target document:
  //   - mid-lesson (a teach session past topic 0) → "Continue · Topic N"
  //   - all topics taught                         → "Review"
  //   - otherwise (never started)                 → "Teach me"
  const midLesson = !!resume && (resume.current_outline_point ?? 0) > 0;
  const teachLabel = midLesson
    ? `Continue · Topic ${resume!.current_outline_point}`
    : taughtComplete
      ? 'Review'
      : 'Teach me';
  // Subtitle always names the real chapter — the trust moment that proves
  // Studae read the user's own material.
  const chapter = resume?.title ?? doc.title;
  const teachA11y = `${teachLabel}, ${chapter}`;
  const askA11y = `Ask anything about ${chapter}`;

  const teach = (
    <BannerTile
      kind="accent"
      icon="school-outline"
      label={teachLabel}
      sub={chapter}
      accessibilityLabel={teachA11y}
      full={stacked}
      onPressIn={onPrefetch}
      onPress={onTeach}
    />
  );
  const ask = (
    <BannerTile
      kind="soft"
      icon="chatbubble-ellipses-outline"
      label="Ask anything"
      sub={chapter}
      accessibilityLabel={askA11y}
      full={stacked}
      onPress={onAsk}
    />
  );

  // Larger-text mode stacks the pair full-width so neither tile cramps.
  return stacked
    ? <Col gap={12}>{teach}{ask}</Col>
    : <Row gap={12}>{teach}{ask}</Row>;
}

/* ---------- Teach | Ask banner skeleton (while dashboard pending) ---------- */
function TeachAskBannerSkeleton({ stacked }: { stacked: boolean }) {
  const C = useTheme();
  const tile = (
    <View
      style={{
        flex: stacked ? undefined : 1,
        alignSelf: stacked ? 'stretch' : undefined,
        backgroundColor: C.card,
        borderColor: C.line,
        borderWidth: 2,
        borderRadius: 18,
        padding: 13,
        minHeight: 56,
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <Skeleton width={36} height={36} radius={10} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="85%" height={11} />
      </View>
    </View>
  );
  return stacked
    ? <Col gap={12}>{tile}{tile}</Col>
    : <Row gap={12}>{tile}{tile}</Row>;
}

export default function Home() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const { largerText } = useThemeMode();
  const [notifOpen, setNotifOpen] = useState(false);
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

  // The Teach | Ask hero banner targets the most-recently created ready
  // document. Dashboard docs are slim (no topic counts), so we fetch that
  // one document's detail to know whether every topic has been taught —
  // which flips the Teach label to "Review". Shares the ['doc', id] cache
  // with the library/detail screens, so it's usually already warm.
  const bannerDocId = (() => {
    const readyDocs = (dash.data?.documents ?? []).filter((d) => d.status === 'ready');
    if (!readyDocs.length) return undefined;
    return [...readyDocs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0].id;
  })();
  const bannerDocDetail = useQuery({
    queryKey: ['doc', bannerDocId],
    queryFn: () => api.getDocument(bannerDocId!),
    enabled: !!bannerDocId,
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

  // ---- Teach | Ask hero banner target ----
  // Most-recent ready doc (id computed above for the detail query).
  const bannerDoc = bannerDocId ? ready.find((d) => d.id === bannerDocId) : undefined;
  // The teach session to resume FOR THAT DOC specifically (not the global
  // resume above, which may point at a different document).
  const bannerResume = bannerDoc
    ? (sessions.data?.sessions ?? [])
        .find((s: ChatSession) => s.mode === 'teach' && s.document_id === bannerDoc.id && (s.current_outline_point ?? 0) > 0)
    : undefined;
  // All topics taught → "Review". Needs the detail's topic counts.
  const bannerComplete = !!bannerDocDetail.data
    && bannerDocDetail.data.topics_total > 0
    && bannerDocDetail.data.topics_taught >= bannerDocDetail.data.topics_total;

  // Empty / first-run state — single empty-shelf card + a primary upload CTA.
  if (!dash.isPending && docs.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar brand right={<IconButton
              name="notifications-outline"
              onPress={() => setNotifOpen(true)}
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
        <ConfirmSheet
          visible={notifOpen}
          tone="neutral"
          singleAction
          title="Notifications"
          message="You're all caught up. Reminders and new-content alerts land in the next update."
          confirmLabel="Got it"
          onConfirm={() => {}}
          onCancel={() => setNotifOpen(false)}
        />
      </View>
    );
  }

  const examDays = nextExam ? daysUntil(nextExam.exam_date) : null;

  // Teach routes into the lesson for the target doc, reusing the exact
  // flows the rest of the app uses: a resumable session jumps straight
  // into /learn/teach; otherwise we hand off to /learn/level to pick a
  // depth and start (same as library/[id]'s "New lesson"). Ask routes to
  // the existing /learn/ask screen for that document.
  function teachTarget() {
    if (!bannerDoc) return;
    if (bannerResume) {
      router.push({ pathname: '/learn/teach', params: { sessionId: bannerResume.id, documentId: bannerDoc.id } });
    } else {
      router.push({ pathname: '/learn/level', params: { documentId: bannerDoc.id } });
    }
  }
  function askTarget() {
    if (!bannerDoc) return;
    router.push({ pathname: '/learn/ask', params: { documentId: bannerDoc.id } });
  }

  // The hero banner row. While the dashboard query is still loading we
  // show a skeleton in the same slot; once loaded we render the real
  // banner only when there is a ready document to target (otherwise null,
  // which hides the whole row). Stacks full-width under larger-text mode.
  const bannerNode = dash.isPending
    ? <TeachAskBannerSkeleton stacked={largerText} />
    : bannerDoc
      ? (
        <TeachAskBanner
          doc={bannerDoc}
          resume={bannerResume}
          taughtComplete={bannerComplete}
          stacked={largerText}
          onTeach={teachTarget}
          onAsk={askTarget}
          onPrefetch={() => prefetchDoc(bannerDoc.id)}
        />
      )
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar
        brand
        right={
          <Row>
            <IconButton
              name="notifications-outline"
              onPress={() => setNotifOpen(true)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profile and settings"
              hitSlop={6}
              onPress={() => router.push('/profile')}
            >
              <Avatar avatarUrl={dash.data?.avatar_url} name={userName} size={32} />
            </Pressable>
          </Row>
        }
      />
      <Screen refreshing={dash.isRefetching} onRefresh={() => { dash.refetch(); focusAll.refetch(); due.refetch(); sessions.refetch(); }}>
        <T v="handH2">{greeting}, {userName}</T>

        {/* ---- Teach | Ask hero banner (no exam): directly under the greeting,
            above 'Your documents'. With an exam set, it moves below the
            NEXT EXAM + Today's plan block instead (see below). ---- */}
        {!nextExam ? bannerNode : null}

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

        {/* ---- Teach | Ask hero banner (exam set): sits below the NEXT EXAM
            + Today's plan block so the countdown stays the hero. ---- */}
        {nextExam ? bannerNode : null}

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
      <ConfirmSheet
        visible={notifOpen}
        tone="neutral"
        singleAction
        title="Notifications"
        message="You're all caught up. Reminders and new-content alerts land in the next update."
        confirmLabel="Got it"
        onConfirm={() => {}}
        onCancel={() => setNotifOpen(false)}
      />
    </View>
  );
}
