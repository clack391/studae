import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { T } from '@/components/ui/T';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

export default function ResetPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'studae://reset' });
    setBusy(false);
    if (error) Alert.alert('Reset failed', error.message);
    else Alert.alert('Link sent', 'Check your inbox for a password reset link.', [{ text: 'OK', onPress: () => router.back() }]);
  }

  return (
    <>
      <AppBar back title="Reset password" />
      <Screen>
        <View style={{ height: 8 }} />
        <T style={{ textAlign: 'center' }}>Enter your email and we'll send a secure link to set a new password.</T>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@email.com" />
        <Button label={busy ? 'Sending…' : 'Send reset link'} kind="pri" size="lg" block onPress={submit} disabled={busy} />
      </Screen>
    </>
  );
}
