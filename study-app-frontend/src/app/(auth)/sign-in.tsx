import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { T } from '@/components/ui/T';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { F, useTheme } from '@/lib/theme';
export default function SignIn() {
  const C = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) Alert.alert('Sign in failed', error.message);
  }

  return (
    <Screen safeTop>
      <View style={{ height: 26 }} />
      <View style={{ alignItems: 'center', overflow: 'visible' }}>
        <T v="handBig" style={{ textAlign: 'center' }}>
          Studae<T style={{ fontFamily: F.hand, color: C.accent }}>.</T>
        </T>
        <T>Learn anything from your own material.</T>
      </View>
      <View style={{ height: 10 }} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@email.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" />
      <Button label={busy ? 'Signing in…' : 'Sign in'} kind="pri" size="lg" block onPress={submit} disabled={busy} />
      <Pressable onPress={() => router.push('/(auth)/reset-password')}>
        <T v="bodyB" style={{ textAlign: 'center' }}>Forgot password?</T>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 }}>
        <View style={{ flex: 1, height: 0, borderTopWidth: 1.6, borderColor: C.line, borderStyle: 'dashed' }} />
        <T v="mut">new here</T>
        <View style={{ flex: 1, height: 0, borderTopWidth: 1.6, borderColor: C.line, borderStyle: 'dashed' }} />
      </View>
      <Button label="Create an account" kind="ghost" block onPress={() => router.push('/(auth)/sign-up')} />
    </Screen>
  );
}
