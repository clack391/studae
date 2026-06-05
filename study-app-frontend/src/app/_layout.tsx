import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Caveat_600SemiBold, Caveat_700Bold } from '@expo-google-fonts/caveat';
import { Kalam_400Regular, Kalam_700Bold } from '@expo-google-fonts/kalam';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, Loading, useAuth } from '@/components/AuthProvider';
import { ThemeProvider, useTheme, useThemeMode } from '@/lib/theme';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Read queries stay fresh for 30 s. Revisiting Home / Library / Cards
      // within that window renders cached data instantly while quietly
      // refetching in the background.
      staleTime: 30_000,
      // Keep cached pages around for 10 min so back-nav is instant.
      gcTime: 10 * 60_000,
    },
  },
});

function RouteGate() {
  const C = useTheme();
  const { resolved } = useThemeMode();
  const { session, loading, recovering } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    const onReset = inAuth && (segments as string[])[1] === 'reset';
    // Password recovery wins over the normal logged-in route. The user has
    // a (transient) recovery session, but they haven't set a new password,
    // so don't dump them on /home.
    if (recovering && !onReset) {
      router.replace('/(auth)/reset');
      return;
    }
    if (!session && !inAuth) router.replace('/(auth)/sign-in');
    if (session && inAuth && !recovering) router.replace('/(app)/home');
  }, [session, loading, segments, recovering]);

  if (loading) return <Loading />;
  return (
    // Theme-coloured wrapper so the stack transition has a coloured surface
    // underneath instead of the OS window's default white.
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: C.paper },
          animation: 'slide_from_right',
          animationDuration: 220,
        }}
      />
    </View>
  );
}

// SafeAreaProvider lives inside ThemeProvider so it can paint the area outside
// the safe-area insets with the active theme background. Without this, the
// system bar gutter shows white on back-nav while the new screen draws.
function ThemedSafeArea({ children }: { children: React.ReactNode }) {
  const C = useTheme();
  return (
    <SafeAreaProvider style={{ backgroundColor: C.paper }}>
      {children}
    </SafeAreaProvider>
  );
}

export default function Root() {
  const [fontsLoaded] = useFonts({
    Caveat_600SemiBold,
    Caveat_700Bold,
    Kalam_400Regular,
    Kalam_700Bold,
  });
  if (!fontsLoaded) return <Loading />;
  return (
    <ThemeProvider>
      <ThemedSafeArea>
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <RouteGate />
          </AuthProvider>
        </QueryClientProvider>
      </ThemedSafeArea>
    </ThemeProvider>
  );
}
