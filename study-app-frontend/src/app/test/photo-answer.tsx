import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Row } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { PhotoPreview, ReadBackCard } from '@/components/domain/PhotoBox';
import { api, ApiError } from '@/lib/api';
import { useTheme } from '@/lib/theme';
export default function PhotoAnswer() {
  const C = useTheme();
  const router = useRouter();
  const { id, qid } = useLocalSearchParams<{ id: string; qid: string }>();
  const [uri, setUri] = useState<string | null>(null);
  const [readBack, setReadBack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function snap(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert(fromCamera ? 'Camera' : 'Photos', 'Permission required');
    const r = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!r.canceled) {
      setUri(r.assets[0].uri);
      setReadBack(null);
    }
  }

  async function send() {
    if (!uri || !id || !qid) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('assessment_id', id);
      form.append('question_id', qid);
      form.append('file', { uri, name: 'answer.jpg', type: 'image/jpeg' } as any);
      const r = await api.answerSavePhoto(form);
      setReadBack(r.read_back ?? null);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 410) {
        Alert.alert('Time up', 'Your test has been auto-submitted.');
        router.replace({ pathname: '/test/result/[id]', params: { id } });
      } else {
        Alert.alert('Could not save', e?.message ?? '');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Photo answer" />
      <Screen>
        <T v="bodyB">Show your working</T>
        <PhotoPreview imageUri={uri} placeholder="Snap or pick a photo of your working" />
        <Row gap={10}>
          <View style={{ flex: 1 }}><Button label="Take photo" kind="soft" block onPress={() => snap(true)} /></View>
          <View style={{ flex: 1 }}><Button label={busy ? '…' : 'Use this answer'} kind="pri" block onPress={send} disabled={!uri || busy} /></View>
        </Row>
        {readBack ? (
          <ReadBackCard text={readBack} hint="Read wrong? Retake before the timer ends.">
            <Button label="Back to question" kind="soft" block onPress={() => router.back()} />
          </ReadBackCard>
        ) : null}
      </Screen>
    </View>
  );
}
