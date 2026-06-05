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
import { AIThinking } from '@/components/ui/Pulse';
import { IndeterminateBar } from '@/components/ui/IndeterminateBar';
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
  // Separate flag for "request actually in flight". `busy` flips on
  // before the OS picker opens so the chosen card can fade, but we don't
  // want the spinner overlay during the picker (which itself is modal).
  // `uploading` only turns on after the file is picked and the network
  // call starts, so the overlay covers exactly the dead-air window
  // between "PDF selected" and "first server response."
  const [uploading, setUploading] = useState(false);

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

  // React Native's fetch + FormData on Android is flaky on slow LTE —
  // the upload can drop mid-transfer with a bare "Network request failed"
  // even though the connection is otherwise fine (other API calls work).
  // Wrap the upload in a small retry: real client/server errors (4xx, 5xx
  // from the backend) come through as ApiError and bypass retry; only
  // bare fetch failures get a second and third try, with brief backoff.
  async function uploadWithRetry(form: FormData) {
    const MAX_TRIES = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        return await api.uploadDocument(form);
      } catch (e) {
        lastErr = e;
        // The backend answered — don't retry. Real errors deserve real
        // handling (limit hit, file too large, validation failure).
        if (e instanceof ApiError) throw e;
        if (attempt < MAX_TRIES) {
          // 400ms, then 1200ms. Total worst-case extra wait ~1.6 s.
          await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
        }
      }
    }
    throw lastErr;
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
      setUploading(true);
      await uploadWithRetry(form);
      bustDocListCaches();
      // Return the user to where they came from (Home or Library). The new
      // doc shows up in the list with its ingest progress live.
      if (router.canGoBack()) router.back();
      else router.replace('/(app)/home');
    } catch (e: any) {
      handleErr(e);
    } finally {
      setBusy(null);
      setUploading(false);
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
      setUploading(true);
      await uploadWithRetry(form);
      bustDocListCaches();
      // Return the user to where they came from (Home or Library). The new
      // doc shows up in the list with its ingest progress live.
      if (router.canGoBack()) router.back();
      else router.replace('/(app)/home');
    } catch (e: any) {
      handleErr(e);
    } finally {
      setBusy(null);
      setUploading(false);
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

      {uploading ? (
        // Absolute overlay covers the screen while the upload request is
        // in flight. Without it the screen looks frozen between picker
        // dismissal and the redirect back to Home/Library. Blocks taps
        // through pointerEvents so the user can't double-fire an upload.
        <View
          pointerEvents="auto"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: C.paper,
            paddingHorizontal: 20,
            paddingTop: 80,
            gap: 16,
          }}
        >
          <IndeterminateBar />
          <AIThinking
            title="Uploading your material"
            tips={[
              'Larger PDFs take longer to send. Stay on this screen.',
              'After upload, Studae reads and indexes every page. We will keep you posted on the home screen.',
              'Once ingested, lessons, tests, and Ask all run against this material.',
              'You can keep using the app while Studae finishes indexing in the background.',
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}
