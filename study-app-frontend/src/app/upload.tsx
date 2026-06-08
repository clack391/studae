import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { T } from '@/components/ui/T';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
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

// Bottom sheet shown after a PDF is picked: choose to process the whole
// book or a single chapter. Modeled on ConfirmSheet (dimmed scrim, ink-
// bordered card sliding from the bottom) but with a chapter text input.
// "A chapter" stays disabled until the input is non-empty.
function ChapterSheet({
  visible,
  fileName,
  chapter,
  onChangeChapter,
  onWholeBook,
  onChapter,
  onCancel,
}: {
  visible: boolean;
  fileName: string;
  chapter: string;
  onChangeChapter: (s: string) => void;
  onWholeBook: () => void;
  onChapter: () => void;
  onCancel: () => void;
}) {
  const C = useTheme();
  const canChapter = chapter.trim().length > 0;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {/* swallow taps inside sheet */}}
          style={{
            backgroundColor: C.card,
            borderTopWidth: 2,
            borderLeftWidth: 2,
            borderRightWidth: 2,
            borderColor: C.ink,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: 16,
            paddingTop: 18,
            paddingBottom: 28,
            gap: 14,
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 12 }} />
          </View>
          <T v="handH2">How much of this PDF?</T>
          <T v="small">
            {fileName
              ? `"${fileName}" looks like a textbook. Process the whole book, or just one chapter to save time and cost.`
              : 'Process the whole book, or just one chapter to save time and cost.'}
          </T>
          <Field
            label="Chapter (optional)"
            placeholder="e.g. 5 or V"
            value={chapter}
            onChangeText={onChangeChapter}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={canChapter ? onChapter : undefined}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
            <Button label="Whole book" kind="plain" block onPress={onWholeBook} style={{ flex: 1 }} />
            <Button label="A chapter" kind="pri" block disabled={!canChapter} onPress={onChapter} style={{ flex: 1 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Document types we accept beyond images. The picker filters by MIME type,
// but some platforms report Markdown as text/plain or octet-stream, so we
// keep the wildcard-free list broad and let the backend make the final call.
const DOC_MIME_TYPES = [
  'application/pdf',
  // .docx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // .pptx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // .txt
  'text/plain',
  // .md (some platforms report it as text/plain or text/x-markdown)
  'text/markdown',
  'text/x-markdown',
];

// The single fields we need off a picked document to build FormData and
// the overlay name. Kept narrow so the chapter sheet can hold a picked
// PDF between selection and upload.
type PickedFile = { uri: string; name: string; mimeType: string };

// A picked file is a PDF when the OS reports the pdf MIME type or the
// filename ends in .pdf — some platforms hand back a generic
// octet-stream, so we check both. Only PDFs get the chapter sheet.
function isPdf(file: PickedFile): boolean {
  return file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// Make a filename presentable in the loading overlay. Strips the
// extension, swaps separators for spaces, collapses whitespace. Keeps
// the original casing so acronyms and proper nouns stay intact.
function cleanFilename(name: string | null | undefined): string {
  if (!name) return '';
  let s = name.replace(/\.[^.]+$/, '');
  s = s.replace(/[_\-+]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
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
  // After the upload POST returns, we hold the user on this screen and
  // poll the document status until it goes ready. That way the loading
  // animation transitions seamlessly into a "processing" view instead
  // of bouncing back to Home where the ingest indicator takes a few
  // seconds to appear in the doc list.
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  // Friendly name to show in the overlay so the user sees which file
  // is being uploaded / processed. Filled from the picker's filename
  // during upload; replaced by the backend's stored title once it's
  // available from the poll (the backend usually has a cleaner title).
  const [materialName, setMaterialName] = useState<string | null>(null);
  // When the user picks a single PDF, we don't upload immediately —
  // first we surface a small sheet so they can choose "Whole book" or a
  // specific chapter (cheaper to process). `pendingPdf` holds the picked
  // file while that sheet is open; `chapterText` is the chapter input.
  // Only PDFs trigger this; other file types upload whole right away.
  const [pendingPdf, setPendingPdf] = useState<PickedFile | null>(null);
  const [chapterText, setChapterText] = useState('');

  const docPoll = useQuery({
    queryKey: ['ingest-poll', processingDocId],
    queryFn: () => api.getDocument(processingDocId!),
    enabled: !!processingDocId,
    // Poll every 1.5 s. Stop polling once the doc is terminal (ready or
    // failed) — refetchInterval returns false to disable further runs.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === 'ready' || s === 'failed') return false;
      return 1500;
    },
    refetchOnWindowFocus: false,
  });

  // React to terminal states from the poll. ready → bounce the user
  // home with the doc list freshly invalidated. failed → surface the
  // error and clear the overlay so the user can retry.
  useEffect(() => {
    const s = docPoll.data?.status;
    if (!processingDocId || !s) return;
    if (s === 'ready') {
      bustDocListCaches();
      qc.invalidateQueries({ queryKey: ['library'] });
      setProcessingDocId(null);
      setMaterialName(null);
      if (router.canGoBack()) router.back();
      else router.replace('/(app)/home');
    } else if (s === 'failed') {
      setProcessingDocId(null);
      setMaterialName(null);
      Alert.alert(
        'Processing failed',
        'We could not read this file. Try a different PDF, or a clearer photo.',
      );
    }
  }, [docPoll.data?.status, processingDocId]);

  // After a new doc is created, invalidate the dashboard and library list caches
  // so the next visit to Home / Library shows the new row without waiting for
  // the 30 s staleTime to expire.
  function bustDocListCaches() {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  function handleErr(e: any) {
    if (on402(e, router, 'document')) return;
    if (e instanceof ApiError && e.status === 413) Alert.alert('Too large', 'A file exceeds the size limit (PDF 100 MB, each image 10 MB).');
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

  // Pick a single document file. Accepts PDF plus office/text formats
  // (.docx, .pptx, .txt, .md). The backend routes by extension: a single
  // PDF runs the PDF pipeline, a single office/text file becomes one
  // document. Always sent under the shared "files" multipart field.
  //
  // For a single PDF we don't upload straight away — we open the chapter
  // sheet so the user can process the whole book or just one chapter
  // (cheaper). Every other format uploads whole immediately, as before.
  async function sendDocument() {
    setBusy('doc');
    // When we hand off to the chapter sheet we keep `busy` set (the
    // sheet owns it and clears it on confirm/cancel). This local flag
    // lets the `finally` know not to clear it — reading the state here
    // would be stale within the same render.
    let handedToSheet = false;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: DOC_MIME_TYPES, copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      // Normalize once so the sheet + upload share the same shape.
      const picked: PickedFile = {
        uri: asset.uri,
        name: asset.name ?? 'document',
        mimeType: asset.mimeType ?? 'application/octet-stream',
      };
      if (isPdf(picked)) {
        // Defer to the chapter sheet so the user can choose whole book
        // vs. a single chapter before we upload. The card stays faded
        // until they make a choice or dismiss the sheet.
        handedToSheet = true;
        setChapterText('');
        setPendingPdf(picked);
        return;
      }
      // uploadDocumentFile sets its own busy/finally; we re-clear here.
      await uploadDocumentFile(picked);
    } catch (e: any) {
      handleErr(e);
      setUploading(false);
      setMaterialName(null);
    } finally {
      if (!handedToSheet) setBusy(null);
    }
  }

  // Build the FormData for a single picked document and run the upload +
  // processing handoff. `chapter` is appended only when present and
  // non-empty (whole-book uploads omit the field entirely, preserving
  // the original behaviour). Shared by the immediate (non-PDF) path and
  // the chapter-sheet path.
  async function uploadDocumentFile(file: PickedFile, chapter?: string) {
    setBusy('doc');
    try {
      const form = new FormData();
      form.append('files', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as any);
      const trimmed = chapter?.trim();
      if (trimmed) form.append('chapter', trimmed);
      setMaterialName(cleanFilename(file.name) || 'document');
      setUploading(true);
      const up = await uploadWithRetry(form);
      bustDocListCaches();
      // Hand off to the polling overlay. The user stays on this screen
      // with the "Processing" view until ingest finishes, then the poll
      // navigates them home with the doc ready in the list.
      setUploading(false);
      setProcessingDocId(up.document_id);
    } catch (e: any) {
      handleErr(e);
      setUploading(false);
      setMaterialName(null);
    } finally {
      setBusy(null);
    }
  }

  // Chapter sheet actions. "Whole book" uploads with no chapter field;
  // "A chapter" requires non-empty input and passes it through. Both
  // close the sheet first, then kick off the upload.
  function onChooseWholeBook() {
    const file = pendingPdf;
    if (!file) return;
    setPendingPdf(null);
    void uploadDocumentFile(file);
  }

  function onChooseChapter() {
    const file = pendingPdf;
    const trimmed = chapterText.trim();
    if (!file || !trimmed) return;
    setPendingPdf(null);
    void uploadDocumentFile(file, trimmed);
  }

  function onDismissChapterSheet() {
    setPendingPdf(null);
    setBusy(null);
  }

  // Pick image(s). Camera takes one shot; the library lets the user
  // multi-select several photos at once. Multiple images become ONE
  // document whose pages are the images IN THE ORDER selected, so we
  // append each asset under the shared "files" field in that order.
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
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8 });
      if (r.canceled) return;
      // Assets arrive in selection order — preserve it so the resulting
      // document's pages line up with how the user picked them.
      const assets = r.assets;
      if (!assets.length) return;
      const form = new FormData();
      assets.forEach((a, i) => {
        form.append('files', {
          uri: a.uri,
          name: a.fileName ?? `page-${i + 1}.${(a.mimeType ?? 'image/jpeg').split('/')[1] ?? 'jpg'}`,
          type: a.mimeType ?? 'image/jpeg',
        } as any);
      });
      const first = assets[0];
      setMaterialName(
        assets.length > 1
          ? `${assets.length} photos`
          : cleanFilename(first.fileName) || (fromCamera ? 'camera photo' : 'photo'),
      );
      setUploading(true);
      const up = await uploadWithRetry(form);
      bustDocListCaches();
      // Hand off to the polling overlay so the user stays on this screen
      // through ingest instead of bouncing to Home and back.
      setUploading(false);
      setProcessingDocId(up.document_id);
    } catch (e: any) {
      handleErr(e);
      setUploading(false);
      setMaterialName(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Add a chapter" />
      <Screen>
        <T style={{ textAlign: 'center' }}>Pick a source. Studae reads it once and teaches from it forever.</T>
        <PickRow icon="document-text-outline" title="Choose a file" sub="PDF, Word, PowerPoint, or text" onPress={sendDocument} busy={busy === 'doc'} />
        <PickRow icon="camera-outline" title="Take a photo" sub="Snap a page of your notebook" onPress={() => sendImage(true)} busy={busy === 'camera'} />
        <PickRow icon="images-outline" title="Pick from library" sub="One or more photos of your notes" onPress={() => sendImage(false)} busy={busy === 'lib'} />
      </Screen>

      <ChapterSheet
        visible={!!pendingPdf}
        fileName={pendingPdf ? cleanFilename(pendingPdf.name) || pendingPdf.name : ''}
        chapter={chapterText}
        onChangeChapter={setChapterText}
        onWholeBook={onChooseWholeBook}
        onChapter={onChooseChapter}
        onCancel={onDismissChapterSheet}
      />

      {uploading || processingDocId ? (
        // Absolute overlay covers the screen for the whole upload →
        // processing window. `uploading` covers the network POST;
        // `processingDocId` keeps the same surface up while we poll the
        // backend for ingest completion. The user only leaves this
        // screen when the doc is fully ready, so the transition feels
        // seamless instead of bouncing through Home with a stale
        // "no documents" state.
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
          {(() => {
            // Prefer the backend's stored title once the poll has it
            // (cleaner than the raw filename). Fall back to the picker
            // filename we cleaned at selection time.
            const displayName = docPoll.data?.title || materialName;
            return displayName ? (
              <View style={{ alignItems: 'center', gap: 2, marginTop: 4 }}>
                <T v="mut" style={{ textAlign: 'center' }}>
                  {uploading ? 'UPLOADING' : 'PROCESSING'}
                </T>
                <T v="handH3" style={{ textAlign: 'center' }} numberOfLines={2}>
                  {displayName}
                </T>
              </View>
            ) : null;
          })()}
          {uploading ? (
            <AIThinking
              title="Uploading your material"
              tips={[
                'Larger PDFs take longer to send. Stay on this screen.',
                'Once the upload finishes, Studae will read and index every page right here.',
                'After processing, lessons, tests, and Ask all run against this material.',
              ]}
            />
          ) : (
            <AIThinking
              title={
                docPoll.data?.progress
                  ? `Processing: ${docPoll.data.progress}`
                  : 'Processing your material'
              }
              tips={[
                'Studae is reading every page and building the outline.',
                'Scanned PDFs take longer because each page goes through OCR.',
                'When this finishes, your new chapter will be ready on Home.',
                'Hold tight, this only happens once per upload.',
              ]}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}
