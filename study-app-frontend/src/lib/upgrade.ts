import type { useRouter } from 'expo-router';
import { ApiError } from './api';

type LimitKind = 'question' | 'document' | 'assessment';
type RouterApi = ReturnType<typeof useRouter>;

/**
 * If the thrown error is HTTP 402 (trial expired / monthly cap hit),
 * navigate to the upgrade gate and return true. Caller should early-return.
 * Returns false otherwise so the caller can show its own error.
 */
export function on402(e: unknown, router: RouterApi, kind?: LimitKind): boolean {
  if (!(e instanceof ApiError) || e.status !== 402) return false;
  const reason = typeof e.detail === 'string'
    ? e.detail
    : (e.detail as any)?.message ?? e.message;
  router.push({ pathname: '/(app)/me/upgrade', params: { reason, kind } });
  return true;
}
