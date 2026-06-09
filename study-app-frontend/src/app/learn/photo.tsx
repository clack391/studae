import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Row } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
import { PhotoPreview, ReadBackCard } from '@/components/domain/PhotoBox';
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
      const res = await api.askPhoto(form);
      // Pass the final sid back through the mutation result so
      // onSuccess can navigate to the chat thread for this session,
      // even when ensureSession created it mid-mutation (the React
      // state setSessionId from ensureSession's onSuccess may not
      // have flushed by the time onSuccess here fires).
      return { res, sid: sid! };
    },
    onSuccess: ({ res, sid }) => {
      setResult(res);
      // Drop the user straight into the chat thread for this session,
      // with the photo + question + answer already in the message
      // history. Without this, hitting the back arrow returns to
      // /learn/ask with its original (often undefined) sessionId,
      // and the chat thread looks empty even though the conversation
      // exists in the DB. Users had to go via lesson history to see
      // their own photo Ask, which was confusing and blocked
      // follow-ups in place. Using replace so the back stack doesn't
      // bounce them back here.
      router.replace({
        pathname: '/learn/ask',
        params: { documentId, sessionId: sid, level },
      });
    },
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
        <PhotoPreview imageUri={uri} placeholder="Snap or pick a photo of a problem" />
        <Row gap={10}>
          <View style={{ flex: 1 }}><Button label="Take photo" kind="soft" block onPress={() => pick(true)} /></View>
          <View style={{ flex: 1 }}><Button label="From library" kind="soft" block onPress={() => pick(false)} /></View>
        </Row>

        {result?.read_back ? (
          <ReadBackCard text={result.read_back} hint="Misread? Retake the photo before asking." />
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

        {/* Answer card no longer renders here — the mutation's
            onSuccess auto-navigates to /learn/ask so the photo + question
            + answer show up in the chat thread itself. Anything rendered
            here would only flash for a frame before route replace. */}
      </Screen>
    </View>
  );
}
