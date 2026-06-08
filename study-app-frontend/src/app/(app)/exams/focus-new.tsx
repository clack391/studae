import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row, Divider } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Segmented';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
export default function NewFocus() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { documentId: incoming } = useLocalSearchParams<{ documentId?: string }>();

  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  const readyDocs = (dash.data?.documents ?? []).filter((d) => d.status === 'ready');

  const [docId, setDocId] = useState<string | undefined>(incoming);
  useEffect(() => {
    if (!docId && readyDocs.length) setDocId(readyDocs[0].id);
  }, [readyDocs.length, docId]);

  const doc = useQuery({
    queryKey: ['doc', docId],
    queryFn: () => api.getDocument(docId!),
    enabled: !!docId,
  });

  const [name, setName] = useState('');
  const [examDate, setExamDate] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: () => api.focusCreate({
      document_id: docId!,
      name: name.trim(),
      topics: picked,
      exam_date: examDate.trim() || null,
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['focus-areas-all'] });
      router.replace({ pathname: '/(app)/exams/focus/[id]', params: { id: r.id } });
    },
    onError: (e: any) => Alert.alert('Could not save', e?.message ?? ''),
  });

  if (!readyDocs.length) {
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <AppBar back title="New focus area" />
        <Screen>
          <T v="small" style={{ textAlign: 'center', marginTop: 24 }}>
            Upload a document first. Focus areas group topics from your material.
          </T>
        </Screen>
      </View>
    );
  }

  const outline = doc.data?.outline_points ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="New focus area" />
      <Screen>
        {readyDocs.length > 1 ? (
          <>
            <T v="label">Document</T>
            <Row wrap gap={6}>
              {readyDocs.map((d) => (
                <Chip
                  key={d.id}
                  label={d.title.length > 20 ? d.title.slice(0, 20) + '…' : d.title}
                  on={d.id === docId}
                  onPress={() => { setDocId(d.id); setPicked([]); }}
                />
              ))}
            </Row>
          </>
        ) : null}

        <Field label="Name" value={name} onChangeText={setName} placeholder="Mid-term: cells & genetics" />
        <Field
          label="Exam date (YYYY-MM-DD)"
          value={examDate}
          onChangeText={setExamDate}
          placeholder="2027-01-30"
          autoCapitalize="none"
        />

        <Row between>
          <T v="label">Topics from your outline</T>
          <T v="mut">{picked.length} picked</T>
        </Row>
        {!outline.length ? (
          <T v="small" style={{ textAlign: 'center' }}>This document doesn't have an outline yet.</T>
        ) : (
          <Card kind="soft">
            {outline.map((t, i, arr) => {
              const on = picked.includes(t);
              return (
                <View key={t}>
                  <Pressable onPress={() => setPicked((p) => on ? p.filter((x) => x !== t) : [...p, t])}>
                    <Row>
                      <View
                        style={{
                          width: 20, height: 20, borderRadius: 6, borderWidth: 2,
                          borderColor: on ? C.accentD : C.line,
                          backgroundColor: on ? C.accentD : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {on ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                      </View>
                      <T v={on ? 'bodyB' : 'body'} style={{ flex: 1 }}>{t}</T>
                    </Row>
                  </Pressable>
                  {i < arr.length - 1 ? <Divider /> : null}
                </View>
              );
            })}
          </Card>
        )}

        <Button
          label={save.isPending ? 'Saving…' : 'Save focus area'}
          kind="pri"
          size="lg"
          block
          onPress={() => save.mutate()}
          disabled={save.isPending || !name.trim() || !picked.length}
        />
      </Screen>
    </View>
  );
}
