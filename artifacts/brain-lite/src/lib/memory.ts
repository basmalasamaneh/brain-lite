import { useQueryClient } from '@tanstack/react-query';
import { getGetMemoryQueryKey, getGetMemoryStatsQueryKey, getListMemoriesQueryKey, MemoryType } from '@workspace/api-client-react';
import { Bell, CalendarClock, CheckSquare, FileText, Lightbulb, Receipt, StickyNote, type LucideIcon } from 'lucide-react';

export const MEMORY_TYPES = Object.values(MemoryType) as MemoryType[];

export const typeMeta: Record<MemoryType, { icon: LucideIcon; tone: string }> = {
  appointment: { icon: CalendarClock, tone: 'bg-gold-soft text-gold ring-1 ring-inset ring-gold-400/30' },
  receipt: { icon: Receipt, tone: 'bg-success/10 text-success-ink ring-1 ring-inset ring-success/25' },
  task: { icon: CheckSquare, tone: 'bg-warning/12 text-warning-ink ring-1 ring-inset ring-warning/25' },
  idea: { icon: Lightbulb, tone: 'bg-gold-300/25 text-gold ring-1 ring-inset ring-gold-300/50' },
  document: { icon: FileText, tone: 'bg-surface-alt text-foreground/80 ring-1 ring-inset ring-border' },
  note: { icon: StickyNote, tone: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border' },
  other: { icon: Bell, tone: 'bg-danger/8 text-danger-ink ring-1 ring-inset ring-danger/20' },
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
    const listKey = String(getListMemoriesQueryKey()[0]);
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? '').startsWith(listKey) });
    qc.invalidateQueries({ queryKey: getGetMemoryStatsQueryKey() });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? '').startsWith('/api/search') || String(q.queryKey[0] ?? '').startsWith('/api/indexing') });
    if (id != null) qc.invalidateQueries({ queryKey: getGetMemoryQueryKey(id) });
  };
}

export function hasTime(iso: string | null | undefined) { return !!iso && /T\d\d:\d\d/.test(iso); }

export function formatDateTime(iso: string | null | undefined, lang: string) {
  if (!iso) return '';
  if (!hasTime(iso)) return formatDate(iso.slice(0, 10) + 'T12:00:00', lang);
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === 'ar' ? 'ar' : 'en', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const calendarUrl = (id: number) => `/api/memories/${id}/calendar`;
