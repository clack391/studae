import { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Row } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { MD } from '@/components/ui/MD';
import { Sources } from '@/components/ui/Sources';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { useTheme } from '@/lib/theme';
import type { AskPhotoResponse, Level } from '@/lib/types';

export default function PhotoProblem() {

  const C = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ documentId: string; sessionId?: string; level?: Level }>();
  const documentId = params.documentId;
  const [sessionId, setSessionId] = useState<string | undefined>(params.sessionId);
  const [uri, setUri] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AskPhotoResponse | null>(null);
  const level: Level = params.level ?? 'novice';

  const ensureSession = useMutation({
    mutationFn: () => api.createSession({ document_id: documentId, level, mode: 'ask' }),
    onSuccess: (r) => setSessionId(r.session_id),
  });

  async function pick(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert(fromCamera ? 'Camera' : 'Photos', 'Permission required');
    const r = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!r.canceled) { setUri(r.assets[0].uri); setResult(null); }
  }

  // Convert send to a useMutation so we get a real isPending flag, can show
  // the AI-thinking animation, and the button auto-disables to prevent the
  // double-tap / overwrite bug.
  const ask = useMutation({
    mutationFn: async () => {
      if (!uri) throw new Error('No photo to analyse');
      let sid = sessionId;
      if (!sid) {
        const created = await ensureSession.mutateAsync();
        sid = created.session_id;
      }
      const form = new FormData();
      form.append('document_id', documentId);
      form.append('session_id', sid!);
      form.append('level', level);
      // Send the student's typed question. The backend honours it if
      // present, falls back to a generic "solve and explain" if blank.
      form.append('question', question);
      form.append('file', { uri, name: 'problem.jpg', type: 'image/jpeg' } as any);
      return api.askPhoto(form);
    },
    onSuccess: (r) => setResult(r),
    onError: (e: any) => {
      if (on402(e, router, 'question')) return;
      Alert.alert('Could not analyse', e?.message ?? '');
    },
  });

  const busy = ensureSession.isPending || ask.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Photo problem" />
      <Screen>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: '100%', height: 220, borderRadius: 12, borderWidth: 2, borderColor: C.line }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              height: 180, borderRadius: 12, borderWidth: 2, borderColor: C.line,
              alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2, gap: 8,
            }}
          >
            <Ionicons name="image-outline" size={40} color={C.ink3} />
            <T v="small">Snap or pick a photo of a problem</T>
          </View>
        )}
        <Row gap={10}>
          <View style={{ flex: 1 }}><Button label="Take photo" kind="soft" block onPress={() => pick(true)} /></View>
          <View style={{ flex: 1 }}><Button label="From library" kind="soft" block onPress={() => pick(false)} /></View>
        </Row>

        {result?.read_back ? (
          <Card kind="accent" flat>
            <Row>
              <Ionicons name="eye-outline" size={15} color={C.accent} />
              <T v="bodyB">What we read from your photo</T>
            </Row>
            <View style={{ backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line, borderRadius: 8, padding: 8 }}>
              <T>{result.read_back}</T>
            </View>
            <T v="mut">Misread? Retake the photo before asking.</T>
          </Card>
        ) : null}

        <Field label="Question" value={question} onChangeText={setQuestion} placeholder="What do you want explained?" />
        <Button
          label={busy ? '…' : 'Get explanation'}
          kind="pri"
          block
          onPress={() => ask.mutate()}
          disabled={!uri || busy}
        />

        {ask.isPending ? (
          <>
            <IndeterminateBar />
            <AIThinking
              title="Studae is reading your photo"
              tips={[
                'We OCR the image first, then ask Claude to explain.',
                'Counts as 1 question against your monthly plan cap.',
                'Misread? Cancel, retake the photo, and try again.',
              ]}
            />
          </>
        ) : null}

        {result && !ask.isPending ? (
          <Card>
            <T v="handH3">Answer</T>
            <MD>{result.answer}</MD>
            {result.sources?.length ? <Sources items={result.sources} /> : null}
            <Button
              label="Continue in chat"
              kind="soft"
              block
              onPress={() => router.replace({ pathname: '/learn/ask', params: { documentId, sessionId, level } })}
            />
          </Card>
        ) : null}
      </Screen>
    </View>
  );
}
