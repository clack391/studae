import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { MCQ } from '@/components/ui/MCQ';
import { Timer } from '@/components/ui/Timer';
import { Badge } from '@/components/ui/Badge';
import { Row } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { Figure } from '@/components/ui/Figure';
import { T } from '@/components/ui/T';
import { api, ApiError } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { SafeQuestion } from '@/lib/types';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function Take() {
  const C = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // /assessment/start is idempotent — starts the timer on first call, returns
  // the same questions + seconds_left on subsequent calls. queryFn is a POST.
  const start = useQuery({
    queryKey: ['start', id],
    queryFn: () => api.assessmentStart(id!),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [idx, setIdx] = useState(0);

  const questions: SafeQuestion[] = start.data?.questions ?? [];
  const q = questions[idx];

  const save = useMutation({
    mutationFn: (payload: { question_id: string; student_answer: string }) =>
      api.answerSave({ assessment_id: id!, ...payload }),
    onSuccess: (_, vars) => setSavedAt((s) => ({ ...s, [vars.question_id]: Date.now() })),
    onError: (e: any) => {
      if (e instanceof ApiError && e.status === 410) {
        // Timer expired → backend auto-submitted. Detail has the graded results.
        Alert.alert('Time up', 'Your test has been auto-submitted.');
        router.replace({ pathname: '/test/result/[id]', params: { id: id! } });
      }
    },
  });

  // Debounced autosave per question.
  useEffect(() => {
    if (!q) return;
    const v = answers[q.id];
    if (v == null) return;
    const t = setTimeout(() => save.mutate({ question_id: q.id, student_answer: v }), 500);
    return () => clearTimeout(t);
  }, [answers[q?.id ?? ''], q?.id]);

  const submit = useMutation({
    mutationFn: () => api.assessmentSubmit(id!),
    onSuccess: () => router.replace({ pathname: '/test/result/[id]', params: { id: id! } }),
    onError: (e: any) => Alert.alert('Submit failed', e?.message ?? ''),
  });

  if (start.isPending || !q) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="Test" />
        <Screen>
          <Loading label="Loading questions…" />
        </Screen>
      </View>
    );
  }

  const total = questions.length;
  const isObjective = q.question_type === 'objective';

  function setAnswer(text: string) {
    if (!q) return;
    setAnswers((a) => ({ ...a, [q.id]: text }));
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Test" />
      <Row style={{ paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: 1.6, borderColor: C.line }} gap={10}>
        {/* Hide the running clock once the student has hit Submit. Without
            this guard the Timer kept ticking visibly while the submit
            request was in flight, which looked like the test was still
            live. A pending submit is a definitive end-of-test, so swap
            the chip for a quiet "Submitting…" pill. */}
        {submit.isPending || submit.isSuccess ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: C.ink,
              paddingVertical: 4,
              paddingHorizontal: 11,
              borderRadius: 20,
            }}
          >
            <Ionicons name="checkmark-circle-outline" size={13} color={C.card} />
            <T style={{ color: C.card, fontSize: 13, fontWeight: '700' }}>Submitting…</T>
          </View>
        ) : (
          <Timer secondsLeft={start.data?.seconds_left ?? 0} onZero={() => submit.mutate()} />
        )}
        <View style={{ flex: 1 }} />
        <T v="bodyB">Question {idx + 1} of {total}</T>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, padding: 12 }}>
        {questions.map((qq, i) => {
          const answered = !!answers[qq.id];
          const here = i === idx;
          return (
            <Pressable
              key={qq.id}
              onPress={() => setIdx(i)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={'Question ' + (i + 1) + (answered ? ', answered' : '')}
            >
              <View
                style={{
                  width: 24, height: 24, borderRadius: 6, borderWidth: 1.6,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: here ? C.accentD : answered ? C.accentSoft : 'transparent',
                  borderColor: here ? C.accent : answered ? C.accent : C.line,
                }}
              >
                <T style={{ fontSize: 10, fontWeight: '800', color: here ? '#fff' : answered ? C.accentInk : C.ink3 }}>{i + 1}</T>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Screen>
        <Row top>
          <T v="bodyB" style={{ flex: 1 }}>{q.question_text}</T>
          {!isObjective ? <Badge label={`${q.points} pts`} kind="out" /> : null}
        </Row>
        {(q.figure_sources ?? [])
          .filter((s) => !!s.figure_path)
          .map((s) => (
            <Figure
              key={s.chunk_id}
              path={s.figure_path as string}
              caption={s.page_number != null ? `page ${s.page_number}` : undefined}
            />
          ))}
        {isObjective && q.options ? (
          q.options.map((opt, i) => {
            const letter = LETTERS[i] ?? String(i + 1);
            // Strip any leading "A.", "B)", "C -" that Claude sometimes
            // prefixes onto option text. The MCQ component renders its
            // own circled letter, so a prefixed letter shows up twice.
            const clean = opt.replace(/^\s*[A-Da-d]\s*[.)\-:]\s+/, '');
            return (
              <MCQ
                key={i}
                letter={letter}
                text={clean}
                selected={answers[q.id] === letter}
                onPress={() => setAnswer(letter)}
              />
            );
          })
        ) : (
          <>
            <Field
              multiline
              value={answers[q.id] ?? ''}
              onChangeText={setAnswer}
              placeholder="Type your answer here…"
            />
            <Row between>
              <Button
                label="Answer with photo"
                kind="soft"
                size="sm"
                onPress={() => router.push({ pathname: '/test/photo-answer', params: { id: id!, qid: q.id } })}
              />
              {savedAt[q.id] ? <T v="mut">saved</T> : null}
            </Row>
          </>
        )}
      </Screen>
      <Row style={{ padding: 12, borderTopWidth: 2, borderColor: C.ink, backgroundColor: C.card }} gap={10}>
        <Button label="← Prev" kind="soft" onPress={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} />
        {idx < total - 1 ? (
          <View style={{ flex: 1 }}>
            <Button label="Next →" kind="pri" block onPress={() => setIdx((i) => Math.min(total - 1, i + 1))} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <Button
              label={submit.isPending ? 'Submitting…' : 'Submit test'}
              kind="dark"
              block
              onPress={() => submit.mutate()}
              disabled={submit.isPending}
            />
          </View>
        )}
      </Row>
    </View>
  );
}
