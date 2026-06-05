import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
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
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  // Tracks the supabase user id of the previously-installed session. We
  // compare against incoming auth events to detect identity changes
  // (signout, signin-as-different-user) and purge the react-query cache
  // before the new user's screens render. Without this purge, queries
  // like ['dashboard'] / ['documents'] return the PREVIOUS user's cached
  // data for a moment while the refetch runs, leaking content across
  // accounts.
  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCachedToken(data.session?.access_token ?? null);
      prevUserId.current = data.session?.user.id ?? null;
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      const nextUserId = s?.user.id ?? null;
      // Identity changed (signout, or signin as a different account).
      // Clear all react-query caches synchronously so the next render
      // can't show the previous user's documents/dashboard/etc. Also
      // covers the edge case where Supabase fires SIGNED_IN with the
      // same identity (TOKEN_REFRESHED-ish) but the user object is null
      // first then populated — only purge on real identity flips.
      if (nextUserId !== prevUserId.current) {
        qc.clear();
        prevUserId.current = nextUserId;
      }
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
    // qc identity is stable for the lifetime of the QueryClientProvider,
    // but list it anyway to satisfy exhaustive-deps.
  }, [qc]);

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
