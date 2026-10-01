/** Pure date-range helpers for the graph filters (no app imports, so node:test can load it). */
export function isCompleteDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1000 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type RangeError = 'partial' | 'reversed' | null;

/** Empty is allowed; a value must be a full real date; from must not be after to. */
export function validateRange(from: string, to: string): RangeError {
  if ((from && !isCompleteDate(from)) || (to && !isCompleteDate(to))) return 'partial';
  if (from && to && from > to) return 'reversed';
  return null;
}
