import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { Sources } from '@/components/ui/Sources';
import { Figure } from '@/components/ui/Figure';
import { MD, hasMath, needsRichRender } from '@/components/ui/MD';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { AssessmentResult } from '@/lib/types';

function statusOf(r: AssessmentResult): 'correct' | 'wrong' | 'partial' | 'unknown' {
  if (r.correct === true) return 'correct';
  if (r.correct === false && (r.score ?? 0) > 0) return 'partial';
  if (r.correct === false) return 'wrong';
  return 'unknown';
}

export default function ReviewAnswers() {
  const C = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['history', id, 'review'], queryFn: () => api.historyDetail(id!) });
  const [open, setOpen] = useState<string | null>(null);

  const dispute = useMutation({
    mutationFn: (vars: { answerId: string; reason: string }) => api.answerDispute(vars.answerId, vars.reason),
    onSuccess: () => { setOpen(null); q.refetch(); Alert.alert('Flagged', 'A human will review this grade.'); },
    onError: (e: any) => Alert.alert('Could not dispute', e?.message ?? ''),
  });

  const results = q.data?.results ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Review" />
      <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
        {results.map((r, i) => {
          const status = statusOf(r);
          const border = status === 'correct' ? C.ok : status === 'wrong' ? C.err : status === 'partial' ? C.warn : C.line;
          const badgeKind = status === 'correct' ? 'ok' : status === 'wrong' ? 'err' : status === 'partial' ? 'warn' : 'out';
          const label = status === 'correct' ? `Correct · ${r.score}/${r.out_of}`
            : status === 'partial' ? `Partial · ${r.score}/${r.out_of}`
            : status === 'wrong' ? `Incorrect · ${r.score ?? 0}/${r.out_of}`
            : `${r.score ?? 0}/${r.out_of}`;
          return (
            <Card key={i} style={{ borderColor: border }}>
              <Row between>
                <Badge label={label} kind={badgeKind as any} />
                {r.disputed ? <Badge label="Flagged" kind="out" /> : null}
              </Row>
              {needsRichRender(r.question) ? <MD>{r.question}</MD> : <T v="bodyB">{r.question}</T>}
              {(r.sources ?? [])
                .filter((s) => !!s.figure_path)
                .map((s) => (
                  <Figure
                    key={s.chunk_id}
                    path={s.figure_path as string}
                    caption={s.page_number != null ? `page ${s.page_number}` : undefined}
                  />
                ))}
              {r.your_answer ? (
                <Row top gap={6}>
                  <T v="mut">Your answer:</T>
                  <T style={{ flex: 1 }}>{r.your_answer}</T>
                </Row>
              ) : <T v="mut">(left blank)</T>}
              {/* Reference line is only useful for theory questions where
                  the reference answer is full prose. For objective MCQs
                  the reference is just a letter (A-D), and the reasoning
                  below already says "Correct answer: B. <option text>" —
                  showing a bare "Reference: B" beside it is duplicate
                  noise. Detect objective by the single-letter reference. */}
              {r.reference_answer
                && status !== 'correct'
                && !/^[A-Da-d]$/.test(r.reference_answer.trim()) ? (
                <Row top gap={6}>
                  <T v="mut">Reference:</T>
                  {hasMath(r.reference_answer) ? (
                    <View style={{ flex: 1 }}><MD>{r.reference_answer}</MD></View>
                  ) : (
                    <T style={{ flex: 1 }}>{r.reference_answer}</T>
                  )}
                </Row>
              ) : null}
              {r.reasoning ? (
                <Col gap={2}>
                  <T v="mut">REASONING</T>
                  <MD>{r.reasoning}</MD>
                </Col>
              ) : null}
              {r.sources?.length ? <Sources items={r.sources} /> : null}
              {status !== 'correct' && !r.disputed && r.answer_id ? (
                <>
                  {open === r.answer_id ? (
                    <DisputeBox
                      onSubmit={(reason) => dispute.mutate({ answerId: r.answer_id!, reason })}
                      onCancel={() => setOpen(null)}
                      busy={dispute.isPending}
                    />
                  ) : (
                    <Button label="This seems wrong" kind="ghost" size="sm" onPress={() => setOpen(r.answer_id!)} />
                  )}
                </>
              ) : null}
            </Card>
          );
        })}
        {/* Loading state while grading runs server-side. The grader pass
            on a 30-question test can take a few seconds; without a
            visible loader the empty "No graded answers yet." copy made
            it look like submit had silently produced nothing. Only fall
            back to the empty copy when the query has finished and
            genuinely returned no results. */}
        {!results.length && (q.isPending || q.isFetching) ? (
          <>
            <IndeterminateBar />
            <AIThinking
              title="Marking your answers"
              tips={[
                'Objective questions are checked against the saved correct option.',
                'Theory answers are graded against the rubric, scored by meaning rather than exact wording.',
                'Photo answers run OCR first, then are graded on the work shown.',
              ]}
            />
          </>
        ) : null}
        {!results.length && !q.isPending && !q.isFetching ? (
          <T v="small" style={{ textAlign: 'center', marginTop: 24 }}>No graded answers yet.</T>
        ) : null}
      </Screen>
    </View>
  );
}

function DisputeBox({ onSubmit, onCancel, busy }: { onSubmit: (reason: string) => void; onCancel: () => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <Card kind="soft">
      <T v="bodyB">Flag this grade</T>
      <T v="small">The score won't change. This goes to a human reviewer and helps us tune grading.</T>
      <Field multiline value={reason} onChangeText={setReason} placeholder="Tell us why this grade seems unfair…" />
      <Row gap={10}>
        <Button label="Cancel" kind="ghost" onPress={onCancel} />
        <View style={{ flex: 1 }}>
          <Button
            label={busy ? '…' : 'Submit flag'}
            kind="pri"
            block
            onPress={() => reason.trim() && onSubmit(reason.trim())}
            disabled={busy || !reason.trim()}
          />
        </View>
      </Row>
    </Card>
  );
}
