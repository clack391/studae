import { Alert, Linking, Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { T } from '@/components/ui/T';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
export default function CheckInbox() {
  const C = useTheme();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();

  async function openMail() {
    // On web this opens the default mail handler. On native it opens the
    // installed mail client (Gmail, Apple Mail, etc.).
    const url = Platform.OS === 'ios' ? 'message://' : 'mailto:';
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) await Linking.openURL(url);
      else Alert.alert('No mail app found', 'Open your inbox manually to find the confirmation link.');
    } catch {
      Alert.alert('Could not open mail', 'Open your inbox manually.');
    }
  }

  async function resend() {
    if (!email) return;
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    Alert.alert(error ? 'Could not resend' : 'Resent', error?.message ?? 'Check your inbox again.');
  }

  return (
    <Screen safeTop>
      <View style={{ height: 56 }} />
      <View style={{ alignItems: 'center', gap: 14 }}>
        <Ionicons name="notifications-outline" size={56} color={C.accent} />
        <T v="handH2">Check your inbox</T>
        <T style={{ textAlign: 'center', paddingHorizontal: 18 }}>
          We sent a confirmation link to <T v="bodyB">{email ?? 'your inbox'}</T>. Tap it to activate your account, then come back to sign in.
        </T>
      </View>
      <View style={{ height: 12 }} />
      <Button label="Open mail app" kind="soft" block onPress={openMail} />
      <Pressable onPress={resend} style={{ alignSelf: 'center', padding: 8 }}>
        <T v="bodyB">Resend email</T>
      </Pressable>
      <Pressable onPress={() => router.replace('/(auth)/sign-in')} style={{ alignSelf: 'center', padding: 8 }}>
        <T v="small">Back to sign in</T>
      </Pressable>
    </Screen>
  );
}
