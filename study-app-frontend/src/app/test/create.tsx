import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Segmented, Chip } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { DocThumb } from '@/components/domain/DocThumb';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { useTheme } from '@/lib/theme';
import { clockTime } from '@/lib/format';
import type { AssessmentFormat, AssessmentKind, Level } from '@/lib/types';

type Scope = 'whole' | 'topic';

function ScopeOpt({ on, title, sub, onPress, disabled }: { on: boolean; title: string; sub: string; onPress: () => void; disabled?: boolean }) {
  const C = useTheme();
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={{ opacity: disabled ? 0.4 : 1 }}>
      <Card kind={on ? 'accent' : 'soft'} style={{ padding: 11 }}>
        <Row>
          <View
            style={{
              width: 18, height: 18, borderRadius: 9, borderWidth: 2,
              borderColor: on ? C.accent : C.line,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} /> : null}
          </View>
          <Col gap={4} style={{ flex: 1 }}>
            <T v="bodyB">{title}</T>
            <T v="small">{sub}</T>
          </Col>
        </Row>
      </Card>
    </Pressable>
  );
}

export default function CreateTest() {

  const C = useTheme();
  const router = useRouter();
  const { documentId, focusAreaId } = useLocalSearchParams<{ documentId: string; focusAreaId?: string }>();
  const doc = useQuery({ queryKey: ['doc', documentId], queryFn: () => api.getDocument(documentId!) });
  const focus = useQuery({
    queryKey: ['focus', focusAreaId],
    queryFn: () => api.focusGet(focusAreaId!),
    enabled: !!focusAreaId,
  });

  const [kind, setKind] = useState<AssessmentKind>('test');
  const [fmt, setFmt] = useState<AssessmentFormat>('mixed');
  const [scope, setScope] = useState<Scope>('whole');
  // Multi-select. Empty array means no topic chosen yet (Generate disabled).
  const [topics, setTopics] = useState<string[]>([]);
  function toggleTopic(t: string) {
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  const [level, setLevel] = useState<Level>('novice');
  const [num, setNum] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const est = useQuery({
    queryKey: ['estimate', kind, fmt, num],
    queryFn: () => api.assessmentEstimate({ kind, format: fmt, num_questions: num }),
  });

  // Initialise count from the default the backend reports.
  useEffect(() => {
    if (est.data && num === undefined) setNum(est.data.num_questions);
  }, [est.data]);

  async function generate() {
    if (!documentId) return;
    setBusy(true);
    try {
      const body: any = {
        document_id: documentId, kind, format: fmt, level,
        num_questions: num,
      };
      if (focusAreaId) body.focus_area_id = focusAreaId;
      else if (scope === 'topic' && topics.length && kind === 'test') {
        // Send a list so the backend can RAG across multiple topics. Single
        // selection still works (the backend collapses 1-element lists).
        body.topics = topics;
      }
      const r = await api.assessmentCreate(body);
      router.replace({ pathname: '/test/take/[id]', params: { id: r.assessment_id } });
    } catch (e: any) {
      if (on402(e, router, 'assessment')) return;
      Alert.alert('Could not generate', e?.message ?? '');
    } finally {
      setBusy(false);
    }
  }

  const topicScopeDisabled = kind === 'exam';

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Create a test" />
      <Screen>
        <Row top>
          <DocThumb />
          <Col gap={6} style={{ flex: 1 }}>
            <T v="bodyB" numberOfLines={1}>{doc.data?.title ?? '…'}</T>
            <T v="mut">{doc.data?.topics_total ?? 0} topics · ready</T>
          </Col>
        </Row>

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

        <T v="label">Kind</T>
        <Segmented
          value={kind}
          onChange={(v) => { setKind(v); if (v === 'exam' && scope === 'topic') setScope('whole'); setNum(undefined); }}
          options={[{ value: 'test', label: 'Test' }, { value: 'exam', label: 'Exam' }]}
        />

        <T v="label">Format</T>
        <Segmented
          value={fmt}
          onChange={(v) => { setFmt(v); setNum(undefined); }}
          options={[
            { value: 'objective', label: 'Objective' },
            { value: 'theory', label: 'Theory' },
            { value: 'mixed', label: 'Mixed' },
          ]}
        />

        {!focusAreaId ? (
          <>
            <T v="label">Scope</T>
            <ScopeOpt on={scope === 'whole'} title="Whole document" sub="Stratified across every chapter" onPress={() => setScope('whole')} />
            <ScopeOpt
              on={scope === 'topic'}
              title="Just a topic"
              sub={topicScopeDisabled ? 'Exams always cover the whole document' : 'RAG-focused on one topic (tests only)'}
              onPress={() => setScope('topic')}
              disabled={topicScopeDisabled}
            />
            {scope === 'topic' && (doc.data?.outline_points ?? []).length ? (
              <>
                <Row wrap gap={6}>
                  {(doc.data?.outline_points ?? []).slice(0, 12).map((t) => (
                    <Chip key={t} label={t} on={topics.includes(t)} onPress={() => toggleTopic(t)} />
                  ))}
                </Row>
                <T v="mut">
                  {topics.length === 0
                    ? 'Pick one or more topics.'
                    : `${topics.length} topic${topics.length === 1 ? '' : 's'} selected.`}
                </T>
              </>
            ) : null}
          </>
        ) : null}

        <T v="label">Level</T>
        <Segmented
          value={level}
          onChange={setLevel}
          options={[
            { value: 'novice', label: 'Novice' },
            { value: 'amateur', label: 'Amateur' },
            { value: 'professional', label: 'Pro' },
          ]}
        />

        <Row between>
          <T v="bodyB">Questions</T>
          <Row gap={6}>
            <Button label="–" size="sm" onPress={() => setNum((n) => Math.max(1, (n ?? est.data?.num_questions ?? 1) - 1))} />
            <T style={{ fontSize: 18, minWidth: 30, textAlign: 'center', fontWeight: '700' }}>{num ?? est.data?.num_questions ?? '…'}</T>
            <Button label="+" size="sm" onPress={() => setNum((n) => (n ?? est.data?.num_questions ?? 1) + 1)} />
          </Row>
        </Row>

        {est.data ? (
          <Card kind="accent" flat>
            <Row>
              <Ionicons name="time-outline" size={18} color={C.accent} />
              <Col gap={2} style={{ flex: 1 }}>
                <T v="bodyB">~{clockTime(est.data.estimated_time_seconds)} on the clock</T>
                <T v="mut">{est.data.rule.seconds_per_objective}s / MCQ · ~{est.data.rule.seconds_per_theory_avg}s / theory</T>
              </Col>
            </Row>
          </Card>
        ) : null}

        {busy ? (
          <>
            <IndeterminateBar />
            <AIThinking
              title="Writing your test"
              tips={[
                'Studae writes each question with its reference answer and rubric — that\'s what makes grading fair later.',
                'For tests, expect ~60 s per MCQ and 90 s × points per theory question.',
                'Exams are comprehensive and synthesis-heavy; tests focus on recall.',
              ]}
            />
          </>
        ) : null}
        <Button
          label={busy ? 'Generating…' : 'Generate test'}
          kind="pri"
          size="lg"
          block
          onPress={generate}
          disabled={busy || (scope === 'topic' && topics.length === 0)}
        />
      </Screen>
    </View>
  );
}
