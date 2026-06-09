import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { Avatar } from '@/components/domain/Avatar';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/theme';

export default function Profile() {
  const C = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });

  // Local edit buffers, seeded from the dashboard once it loads. We only
  // re-seed when the underlying server values change so an in-progress edit
  // isn't clobbered by a background refetch.
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => {
    if (dash.data?.name != null) setName(dash.data.name);
  }, [dash.data?.name]);
  useEffect(() => {
    if (dash.data?.phone != null) setPhone(dash.data.phone);
  }, [dash.data?.phone]);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Drives the premium "Change photo" bottom sheet that replaces the
  // OS Material alert. Two actions (Take photo / Choose from library)
  // plus a Cancel — same surface treatment as ConfirmSheet so the
  // photo picker stays on-brand instead of falling back to system UI.
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  // Single notice sheet for every save / upload result on this screen.
  // Replaces Alert.alert("Saved", ...) and friends, which rendered as
  // stark white Material dialogs that clashed with the rest of the
  // app. `tone: 'danger'` triggers the red header chip + red confirm
  // button on errors; `'neutral'` is the plain on-brand info sheet.
  const [notice, setNotice] = useState<
    { title: string; message: string; tone?: 'danger' | 'neutral' } | null
  >(null);

  const email = session?.user?.email ?? '';
  const displayName =
    dash.data?.name ?? (session?.user?.user_metadata as any)?.full_name ?? 'You';

  // Upload a new profile photo. Single image under the multipart field name
  // "file" (mirrors upload.tsx's FormData pattern). After it lands we
  // invalidate ["dashboard"] so the new avatar_url flows back and the signed
  // url re-resolves across Home / Me / here.
  async function pickAvatar(fromCamera: boolean) {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setNotice({
          title: fromCamera ? 'Camera access needed' : 'Photo access needed',
          message: fromCamera
            ? 'Allow camera access in your phone settings to take a profile photo.'
            : 'Allow photo library access in your phone settings to pick a profile photo.',
          tone: 'neutral',
        });
        return;
      }
      const r = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (r.canceled) return;
      const asset = r.assets[0];
      if (!asset) return;
      const form = new FormData();
      form.append('file', {
        uri: asset.uri,
        name: asset.fileName ?? 'avatar.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as any);
      setUploading(true);
      await api.uploadAvatar(form);
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 413) {
        setNotice({
          title: 'Photo too large',
          message: 'Profile photos must be under 10 MB. Try a smaller image.',
          tone: 'danger',
        });
      } else {
        setNotice({
          title: 'Could not upload photo',
          message: e?.message ?? 'Something went wrong on our end. Please try again in a moment.',
          tone: 'danger',
        });
      }
    } finally {
      setUploading(false);
    }
  }

  function changePhoto() {
    setPhotoSheetOpen(true);
  }

  // Save username + phone through the existing POST /settings (which patches
  // any non-null field). Best-effort: also push the name into the Supabase
  // auth metadata so full_name stays in sync with the display name.
  async function save() {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    // A blank username must not wipe the existing name; only send it when set.
    const patch: { name?: string; phone?: string } = { phone: trimmedPhone };
    if (trimmedName) patch.name = trimmedName;
    setSaving(true);
    try {
      await api.updateSettings(patch);
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (trimmedName) supabase.auth.updateUser({ data: { full_name: trimmedName } }).catch(() => {});
      setNotice({
        title: 'Profile saved',
        message: 'Your profile has been updated.',
        tone: 'neutral',
      });
    } catch (e: any) {
      setNotice({
        title: 'Could not save profile',
        message: e?.message ?? 'Something went wrong on our end. Please try again in a moment.',
        tone: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Profile" />
      <Screen>
        {/* Avatar hero + change-photo affordance. */}
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            hitSlop={6}
            onPress={uploading ? undefined : changePhoto}
            style={{ opacity: uploading ? 0.6 : 1 }}
          >
            <Avatar avatarUrl={dash.data?.avatar_url} name={displayName} size={96} />
            <View
              style={{
                position: 'absolute', right: -2, bottom: -2,
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: C.accentD, borderWidth: 2, borderColor: C.paper,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="camera" size={16} color="#fff" />
            </View>
          </Pressable>
          <Button
            label={uploading ? 'Uploading…' : 'Change photo'}
            kind="soft"
            size="sm"
            disabled={uploading}
            onPress={changePhoto}
          />
        </View>

        <Card kind="soft">
          <Col gap={14}>
            <Field
              label="Username"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              autoCapitalize="words"
            />
            <Field
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              keyboardType="phone-pad"
            />
            <Col gap={4}>
              <T v="label">Email</T>
              <Row style={{ paddingVertical: 2 }}>
                <T v="body" style={{ color: C.ink2 }}>{email || '—'}</T>
              </Row>
            </Col>
          </Col>
        </Card>

        <Button
          label={saving ? 'Saving…' : 'Save changes'}
          kind="pri"
          block
          disabled={saving}
          onPress={save}
        />
      </Screen>

      {/* Premium-styled photo picker. Slides up from the bottom over a
          dimmed scrim, ink-bordered, hand-styled title — mirrors the
          ConfirmSheet visual treatment used for sign-out / clear-data
          confirmations elsewhere in the app. Replaces the OS Material
          alert that previously rendered as a stark white card with
          system fonts and felt off-brand. */}
      <Modal
        transparent
        visible={photoSheetOpen}
        animationType="fade"
        onRequestClose={() => setPhotoSheetOpen(false)}
      >
        <Pressable
          onPress={() => setPhotoSheetOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'flex-end',
          }}
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
              gap: 12,
            }}
          >
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 12 }} />
            </View>
            <T v="handH2">Change photo</T>
            <T v="small" style={{ marginBottom: 6 }}>
              Choose a new profile photo.
            </T>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
              onPress={() => {
                setPhotoSheetOpen(false);
                pickAvatar(true);
              }}
              style={{
                borderWidth: 1.6,
                borderColor: C.line,
                borderRadius: 14,
                paddingVertical: 13,
                paddingHorizontal: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: C.accentSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Ionicons name="camera-outline" size={20} color={C.accent} />
              </View>
              <Col gap={2} style={{ flex: 1 }}>
                <T v="bodyB">Take a photo</T>
                <T v="small">Use the camera now</T>
              </Col>
              <Ionicons name="chevron-forward" size={16} color={C.ink2} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
              onPress={() => {
                setPhotoSheetOpen(false);
                pickAvatar(false);
              }}
              style={{
                borderWidth: 1.6,
                borderColor: C.line,
                borderRadius: 14,
                paddingVertical: 13,
                paddingHorizontal: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: C.accentSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Ionicons name="images-outline" size={20} color={C.accent} />
              </View>
              <Col gap={2} style={{ flex: 1 }}>
                <T v="bodyB">Choose from library</T>
                <T v="small">Pick an existing photo</T>
              </Col>
              <Ionicons name="chevron-forward" size={16} color={C.ink2} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => setPhotoSheetOpen(false)}
              style={{
                marginTop: 4,
                paddingVertical: 13,
                alignItems: 'center',
                borderRadius: 14,
                borderWidth: 1.6,
                borderColor: C.line,
              }}
            >
              <T style={{ color: C.ink, fontWeight: '700' }}>Cancel</T>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Single notice sheet for every save / upload outcome on this
          screen — Saved, Profile too large, Upload failed, Could not
          save, permission-needed. Same on-brand bottom sheet as the
          confirmations elsewhere in the app, with `singleAction` so
          only an OK shows (no Cancel for an info / error notice). */}
      <ConfirmSheet
        visible={notice !== null}
        tone={notice?.tone ?? 'neutral'}
        singleAction
        title={notice?.title ?? ''}
        message={notice?.message ?? ''}
        confirmLabel="OK"
        onConfirm={() => setNotice(null)}
        onCancel={() => setNotice(null)}
      />
    </View>
  );
}
