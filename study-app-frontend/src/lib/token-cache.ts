/**
 * Module-level JWT cache. AuthProvider subscribes to supabase.auth.onAuthStateChange
 * and pumps every token into setCachedToken — including refreshes. api.ts then
 * reads via getCachedToken() instead of paying the supabase.auth.getSession()
 * tax (AsyncStorage read + internal mutex) on every single request.
 *
 * Falls back to supabase.auth.getSession() once on cold start while the
 * AuthProvider's initial fetch is in flight.
 */
import { supabase } from './supabase';

let cached: string | null = null;
let initialised = false;

export function setCachedToken(token: string | null) {
  cached = token;
  initialised = true;
}

export async function getCachedToken(): Promise<string | null> {
  if (initialised) return cached;
  // Cold start: prime the cache from supabase before the AuthProvider's
  // onAuthStateChange has had a chance to fire.
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token ?? null;
  setCachedToken(t);
  return t;
}
