import { useQueryClient } from '@tanstack/react-query';
import { getGetMemoryQueryKey, getGetMemoryStatsQueryKey, getListMemoriesQueryKey, MemoryType } from '@workspace/api-client-react';
import { Bell, CalendarClock, CheckSquare, FileText, Lightbulb, Receipt, StickyNote, type LucideIcon } from 'lucide-react';

export const MEMORY_TYPES = Object.values(MemoryType) as MemoryType[];

export const typeMeta: Record<MemoryType, { icon: LucideIcon; tone: string }> = {
  appointment: { icon: CalendarClock, tone: 'bg-lavender text-primary' },
  receipt: { icon: Receipt, tone: 'bg-amber/15 text-amber' },
  task: { icon: CheckSquare, tone: 'bg-green/15 text-green' },
  idea: { icon: Lightbulb, tone: 'bg-amber/15 text-amber' },
  document: { icon: FileText, tone: 'bg-lavender text-primary' },
  note: { icon: StickyNote, tone: 'bg-muted text-foreground/70' },
  other: { icon: Bell, tone: 'bg-muted text-muted-foreground' },
};

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const MAX_BYTES = 10 * 1024 * 1024;

export function fileUrl(path: string) {
  return `/api/storage${path}`;
}

export function formatDate(iso: string | null | undefined, lang: string, withYear = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

export function formatAmount(amount: number | null, currency: string | null, lang: string) {
  if (amount == null) return '';
  try {
    if (currency && /^[A-Za-z]{3}$/.test(currency)) return new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
  } catch { /* fall through */ }
  return `${amount.toLocaleString(lang === 'ar' ? 'ar' : 'en')}${currency ? ' ' + currency : ''}`;
}

export function useInvalidateMemories() {
  const qc = useQueryClient();
  return (id?: number) => {
    qc.invalidateQueries({ queryKey: getListMemoriesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetMemoryStatsQueryKey() });
    if (id != null) qc.invalidateQueries({ queryKey: getGetMemoryQueryKey(id) });
  };
}
