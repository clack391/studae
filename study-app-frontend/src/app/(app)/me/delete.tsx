import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { Card, Row } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { T } from '@/components/ui/T';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
export default function DeleteAccount() {
  const C = useTheme();
  const router = useRouter();
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    if (val !== 'DELETE') return;
    setBusy(true);
    try {
      await api.deleteAccount();
      // The JWT is invalidated immediately after the backend drops the
      // auth user, so signOut is mostly cosmetic — clears AsyncStorage.
      await supabase.auth.signOut();
      router.replace('/(auth)/sign-in');
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not delete', e?.message ?? '');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <AppBar back title="Delete account" />
      <Screen>
        <Card style={{ borderColor: C.err }}>
          <Row top gap={10}>
            <Ionicons name="trash-outline" size={18} color={C.err} />
            <T v="small" style={{ flex: 1 }}>
              This permanently erases your account, documents, history, flashcards, focus areas, and uploaded files. It cannot be undone.
            </T>
          </Row>
        </Card>
        <Field
          label="Type DELETE to confirm"
          value={val}
          onChangeText={setVal}
          autoCapitalize="characters"
          placeholder="DELETE"
        />
        <Button
          label={busy ? 'Deleting…' : 'Delete my account'}
          kind="dark"
          block
          style={{ backgroundColor: C.err, borderColor: C.err }}
          onPress={go}
          disabled={busy || val !== 'DELETE'}
        />
        <Button label="Cancel" kind="ghost" block onPress={() => router.back()} />
      </Screen>
    </View>
  );
}
