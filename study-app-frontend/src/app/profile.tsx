import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Col, Row } from '@/components/ui/Card';
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
        Alert.alert(fromCamera ? 'Camera' : 'Photos', 'Permission required');
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
        Alert.alert('Too large', 'Profile photos must be under 10 MB.');
      } else {
        Alert.alert('Upload failed', e?.message ?? 'Unknown error');
      }
    } finally {
      setUploading(false);
    }
  }

  function changePhoto() {
    Alert.alert('Change photo', 'Choose a new profile photo', [
      { text: 'Take a photo', onPress: () => pickAvatar(true) },
      { text: 'Choose from library', onPress: () => pickAvatar(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Unknown error');
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
    </View>
  );
}
