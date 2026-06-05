import { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setCachedToken } from '@/lib/token-cache';
import { parseAuthCallback } from '@/lib/deeplink';
import { useTheme } from '@/lib/theme';

type Auth = {
  session: Session | null;
  loading: boolean;
  // True while the user is in the password-recovery flow (clicked a reset
  // email link). The RouteGate uses this to keep them on /(auth)/reset
  // instead of routing straight to /home.
  recovering: boolean;
  endRecovery: () => void;
};

const Ctx = createContext<Auth>({
  session: null,
  loading: true,
  recovering: false,
  endRecovery: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCachedToken(data.session?.access_token ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Fires on TOKEN_REFRESHED too. Keeps the cache fresh.
      setCachedToken(s?.access_token ?? null);
      // Supabase fires this event when it processes a recovery URL itself.
      // We don't rely on it (we set `recovering` from the deep-link parser
      // below since detectSessionInUrl is off), but if the SDK ever fires
      // it for some reason, we still want to route to /reset.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Handle deep links. Both the cold-start URL (app launched from a link)
  // and warm-start (link tapped while running). For recovery links we set
  // the session ourselves and flip the recovering flag.
  useEffect(() => {
    async function handle(url: string | null) {
      if (!url) return;
      const params = parseAuthCallback(url);
      if (!params) return;
      const { error } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (error) return;
      if (params.type === 'recovery') setRecovering(true);
    }
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  function endRecovery() {
    setRecovering(false);
  }

  return (
    <Ctx.Provider value={{ session, loading, recovering, endRecovery }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}

export function Loading() {
  const C = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.accent} />
    </View>
  );
}
