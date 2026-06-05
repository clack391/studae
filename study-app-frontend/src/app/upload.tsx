import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { T } from '@/components/ui/T';
import { api, ApiError } from '@/lib/api';
import { on402 } from '@/lib/upgrade';
import { useTheme } from '@/lib/theme';
function PickRow({ icon, title, sub, onPress, busy }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void; busy?: boolean }) {
  const C = useTheme();
  return (
    <Pressable onPress={busy ? undefined : onPress}>
      <Card kind="soft" style={{ opacity: busy ? 0.5 : 1 }}>
        <Row>
          <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={22} color={C.accent} />
          </View>
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

export default function Upload() {
  const C = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  // After a new doc is created, invalidate the dashboard and library list caches
  // so the next visit to Home / Library shows the new row without waiting for
  // the 30 s staleTime to expire.
  function bustDocListCaches() {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  function handleErr(e: any) {
    if (on402(e, router, 'document')) return;
    if (e instanceof ApiError && e.status === 413) Alert.alert('Too large', 'File exceeds the 100 MB limit.');
    else Alert.alert('Upload failed', e?.message ?? 'Unknown error');
  }

  async function sendPdf() {
    setBusy('pdf');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (res.canceled) return;
      const file = res.assets[0];
      const form = new FormData();
      form.append('file', {
        uri: file.uri,
        name: file.name ?? 'document.pdf',
        type: 'application/pdf',
      } as any);
      await api.uploadDocument(form);
      bustDocListCaches();
      // Return the user to where they came from (Home or Library). The new
      // doc shows up in the list with its ingest progress live.
      if (router.canGoBack()) router.back();
      else router.replace('/(app)/home');
    } catch (e: any) {
      handleErr(e);
    } finally {
      setBusy(null);
    }
  }

  async function sendImage(fromCamera: boolean) {
    const key = fromCamera ? 'camera' : 'lib';
    setBusy(key);
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert(fromCamera ? 'Camera' : 'Photos', 'Permission required');
      const r = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: false, quality: 0.8 });
      if (r.canceled) return;
      const a = r.assets[0];
      const form = new FormData();
      form.append('file', {
        uri: a.uri,
        name: a.fileName ?? `page.${(a.mimeType ?? 'image/jpeg').split('/')[1] ?? 'jpg'}`,
        type: a.mimeType ?? 'image/jpeg',
      } as any);
      await api.uploadDocument(form);
      bustDocListCaches();
      // Return the user to where they came from (Home or Library). The new
      // doc shows up in the list with its ingest progress live.
      if (router.canGoBack()) router.back();
      else router.replace('/(app)/home');
    } catch (e: any) {
      handleErr(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Add a chapter" />
      <Screen>
        <T style={{ textAlign: 'center' }}>Pick a source. Studae reads it once and teaches from it forever.</T>
        <PickRow icon="document-text-outline" title="Choose a PDF" sub="A textbook or chapter file" onPress={sendPdf} busy={busy === 'pdf'} />
        <PickRow icon="camera-outline" title="Take a photo" sub="Snap a page of your notebook" onPress={() => sendImage(true)} busy={busy === 'camera'} />
        <PickRow icon="images-outline" title="Pick from library" sub="An image already on your phone" onPress={() => sendImage(false)} busy={busy === 'lib'} />
      </Screen>
    </View>
  );
}
