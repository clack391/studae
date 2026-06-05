import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { AppBar } from '@/components/ui/AppBar';
import { T } from '@/components/ui/T';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || password.length < 8) return;
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        // Email confirmation link will deep-link back into the app on tap.
        // AuthProvider's URL listener parses the tokens, calls setSession,
        // and the user lands on /home logged in. Supabase must have
        // `studae://**` allow-listed in URL Configuration for this to work.
        emailRedirectTo: 'studae://signin',
      },
    });
    setBusy(false);
    if (error) return Alert.alert('Sign up failed', error.message);
    router.replace({ pathname: '/(auth)/check-inbox', params: { email } });
  }

  return (
    <>
      <AppBar back title="Create account" />
      <Screen>
        <Field label="Full name" value={name} onChangeText={setName} placeholder="Ada Obi" />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="ada@email.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="at least 8 characters" />
        <Button label={busy ? 'Creating…' : 'Sign up'} kind="pri" size="lg" block onPress={submit} disabled={busy} />
        <View style={{ alignItems: 'center' }}>
          <T v="mut">protected by Turnstile (no bots)</T>
        </View>
      </Screen>
    </>
  );
}
