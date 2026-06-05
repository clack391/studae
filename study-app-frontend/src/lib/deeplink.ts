/**
 * Parse a Supabase auth callback URL like:
 *   studae://reset#access_token=...&refresh_token=...&type=recovery&expires_in=3600
 *
 * Supabase puts the tokens in the URL fragment (after `#`). The whole flow
 * is opt-in: `supabase.ts` sets `detectSessionInUrl: false` so the client
 * doesn't auto-pick this up, and we wire deep links ourselves in
 * `AuthProvider` (need to know when a recovery session begins, so we can
 * route the user to the new-password screen instead of `/home`).
 */
export type RecoveryParams = {
  access_token: string;
  refresh_token: string;
  type: 'recovery' | 'signup' | 'magiclink' | string;
};

export function parseAuthCallback(url: string): RecoveryParams | null {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const fragment = hashIndex >= 0
    ? url.substring(hashIndex + 1)
    : queryIndex >= 0 ? url.substring(queryIndex + 1) : '';
  if (!fragment) return null;

  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const type = params.get('type');
  if (!access_token || !refresh_token || !type) return null;
  return { access_token, refresh_token, type };
}
