export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
}

export function parseProgressText(s?: string | null): { cur: number; total: number; pct: number } {
  if (!s) return { cur: 0, total: 0, pct: 0 };
  const m = s.match(/(\d+)\s*of\s*(\d+)/);
  if (!m) return { cur: 0, total: 0, pct: 0 };
  const cur = +m[1];
  const total = +m[2];
  return { cur, total, pct: total ? Math.round((cur / total) * 100) : 0 };
}
