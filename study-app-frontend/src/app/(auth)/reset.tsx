import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { T } from '@/components/ui/T';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';

export default function ResetHandler() {
  const router = useRouter();
  const { endRecovery } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pw.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.');
      return;
    }
    if (pw !== confirm) {
      Alert.alert('Mismatch', 'The two passwords do not match.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      Alert.alert('Could not update password', error.message);
      return;
    }
    // Sign out so the user reauthenticates with the new password. This also
    // tears down the transient recovery session.
    await supabase.auth.signOut();
    endRecovery();
    setBusy(false);
    Alert.alert(
      'Password updated',
      'Sign in with your new password.',
      [{ text: 'OK', onPress: () => router.replace('/(auth)/sign-in') }],
    );
  }

  return (
    <>
      <AppBar title="Set a new password" />
      <Screen safeTop>
        <View style={{ height: 8 }} />
        <T style={{ textAlign: 'center' }}>
          Choose a new password. Use at least 8 characters.
        </T>
        <Field
          label="New password"
          value={pw}
          onChangeText={setPw}
          secureTextEntry
          placeholder="••••••••"
        />
        <Field
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          placeholder="••••••••"
        />
        <Button
          label={busy ? 'Updating…' : 'Update password'}
          kind="pri"
          size="lg"
          block
          onPress={submit}
          disabled={busy}
        />
      </Screen>
    </>
  );
}
