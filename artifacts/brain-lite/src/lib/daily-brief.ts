// Pure, rule-based daily brief. No AI, no network. All day math is in the
// viewer's LOCAL time. Date-only strings ("2025-03-14") are treated as local
// calendar days and never routed through UTC parsing.
import type { Memory } from '@workspace/api-client-react';

export const COMING_UP_DAYS = 7;
export const EXPIRING_DAYS = 30;

const DAY_MS = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
const ZONED = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i;

export type ParsedDate = { date: Date; dateOnly: boolean };

function validYmd(y: number, m: number, d: number) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function validHms(h: number, mi: number, se: number) { return h <= 23 && mi <= 59 && se <= 59; }

/** Parse ISO-like strings. Returns null for anything ambiguous (e.g. "2 years"). */
export function parseLocalDate(value: unknown): ParsedDate | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  let m = DATE_ONLY.exec(s);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return validYmd(y, mo, d) ? { date: new Date(y, mo - 1, d), dateOnly: true } : null;
  }
  m = LOCAL_DT.exec(s);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!validYmd(y, mo, d) || !validHms(+m[4], +m[5], +(m[6] ?? 0))) return null;
    return { date: new Date(y, mo - 1, d, +m[4], +m[5], +(m[6] ?? 0)), dateOnly: false };
  }
  m = ZONED.exec(s);
  if (m) {
    // Validate components first: JS Date silently normalizes e.g. Feb 30 or 24:00.
    if (!validYmd(+m[1], +m[2], +m[3]) || !validHms(+m[4], +m[5], +(m[6] ?? 0))) return null;
    if (m[7] && m[7].toUpperCase() !== 'Z') {
      const off = /^[+-](\d{2}):?(\d{2})$/.exec(m[7]);
      if (!off || +off[1] > 14 || +off[2] > 59) return null;
    }
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : { date: dt, dateOnly: false };
  }
  return null;
}

export function startOfLocalDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
/** Whole local calendar days from today to target (DST safe). */
export function daysUntil(target: Date, now: Date) {
  const a = startOfLocalDay(now), b = startOfLocalDay(target);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

// Keys that name an end/expiry date themselves (EN + AR).
const EXPLICIT_END = /(expir|expires|end[_ ]?date|ends?[_ ]?(on|at)?$|renew|valid[_ ]?(until|to|thru)|انتهاء|ينتهي|تنتهي|تجديد|صالح[_ ]?حتى|حتى)/i;
// Parents whose generic date children mean "expires on" (EN + AR).
const EXPIRY_PARENT = /(warrant|subscri|expir|guarantee|ضمان|كفالة|اشتراك|انتهاء)/i;
// Never an expiry, even under a warranty/subscription parent.
const NOT_EXPIRY = /(purchase|bought|start|begin|issued?|created|order|paid|شراء|بداية|بدء|إصدار|اصدار|دفع)/i;
const GENERIC_DATE = /^(date|day|until|on|at|value|تاريخ|يوم|\[\d+\])$/i;

export type ExpiryKind = 'warranty' | 'subscription' | 'expiry';
export type ExpiryHit = { key: string; date: Date; kind: ExpiryKind };

function kindOf(path: string): ExpiryKind {
  if (/warrant|guarantee|ضمان|كفالة/i.test(path)) return 'warranty';
  if (/subscri|renew|اشتراك|تجديد/i.test(path)) return 'subscription';
  return 'expiry';
}

function isExpiryLeaf(key: string, parentIsExpiry: boolean) {
  if (NOT_EXPIRY.test(key)) return false;
  if (EXPLICIT_END.test(key)) return true;
  if (EXPIRY_PARENT.test(key)) return true; // e.g. { warranty: "2026-01-01" }
  return parentIsExpiry && GENERIC_DATE.test(key);
}

/** Find explicit expiry dates in `extra` (nested up to 3 levels). Never invents dates. */
export function extractExpiryDates(extra: unknown): ExpiryHit[] {
  const hits: ExpiryHit[] = [];
  const walk = (node: unknown, key: string, path: string, depth: number, parentIsExpiry: boolean) => {
    if (depth > 4 || node == null) return;
    if (typeof node === 'string') {
      if (!key || !isExpiryLeaf(key, parentIsExpiry)) return;
      const p = parseLocalDate(node);
      if (p) hits.push({ key: path, date: p.date, kind: kindOf(path) });
      return;
    }
    const ctx = parentIsExpiry || (!!key && EXPIRY_PARENT.test(key) && !NOT_EXPIRY.test(key));
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `[${i}]`, `${path}[${i}]`, depth + 1, ctx)); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k, path ? `${path}.${k}` : k, depth + 1, ctx);
    }
  };
  walk(extra, '', '', 0, false);
  const seen = new Set<string>();
  return hits.filter((h) => { const k = `${h.kind}:${h.date.getTime()}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export type BriefItem = { memory: Memory; date: Date; dateOnly: boolean; days: number };
export type ExpiringItem = { memory: Memory; date: Date; days: number; kind: ExpiryKind };
export type Insight =
  | { kind: 'empty' }
  | { kind: 'expiring'; count: number; days: number }
  | { kind: 'busy_today'; count: number }
  | { kind: 'review'; count: number }
  | { kind: 'clear_week' }
  | { kind: 'week'; count: number };

export type DailyBrief = {
  greeting: 'morning' | 'afternoon' | 'evening';
  today: BriefItem[];
  comingUp: BriefItem[];
  expiring: ExpiringItem[];
  recent: Memory[];
  summary: { total: number; tasks: number; upcoming: number };
  insight: Insight;
};

// Only events/deadlines show in Today / Coming up; receipt purchase dates etc. do not.
export const EVENT_TYPES = ['appointment', 'task'] as const;
function isEventType(t: string) { return (EVENT_TYPES as readonly string[]).includes(t); }

export function greetingFor(now: Date): DailyBrief['greeting'] {
  const h = now.getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export function buildDailyBrief(memories: Memory[], now: Date = new Date()): DailyBrief {
  const todayStart = startOfLocalDay(now);
  const tomorrow = addDays(todayStart, 1);
  const weekEnd = addDays(todayStart, COMING_UP_DAYS + 1); // exclusive: through day +7
  const expEnd = addDays(todayStart, EXPIRING_DAYS + 1); // exclusive: through day +30

  const today: BriefItem[] = [];
  const comingUp: BriefItem[] = [];
  const expiring: ExpiringItem[] = [];

  for (const m of memories) {
    const p = isEventType(m.type) ? parseLocalDate(m.event_date) : null;
    if (p) {
      const item = { memory: m, date: p.date, dateOnly: p.dateOnly, days: daysUntil(p.date, now) };
      if (p.date >= todayStart && p.date < tomorrow) today.push(item);
      else if (p.date >= tomorrow && p.date < weekEnd) comingUp.push(item);
    }
    for (const hit of extractExpiryDates(m.extra)) {
      if (hit.date >= todayStart && hit.date < expEnd) {
        expiring.push({ memory: m, date: hit.date, days: daysUntil(hit.date, now), kind: hit.kind });
      }
    }
  }

  const byDate = <T extends { date: Date }>(a: T, b: T) => a.date.getTime() - b.date.getTime();
  // Date-only items sort before timed ones on the same day ("all day" first).
  today.sort((a, b) => (a.dateOnly === b.dateOnly ? byDate(a, b) : a.dateOnly ? -1 : 1));
  comingUp.sort(byDate);
  expiring.sort(byDate);

  const recent = [...memories]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  const review = memories.filter((m) => m.status === 'needs_review').length;
  let insight: Insight;
  if (memories.length === 0) insight = { kind: 'empty' };
  else if (expiring.some((e) => e.days <= 7)) insight = { kind: 'expiring', count: expiring.filter((e) => e.days <= 7).length, days: 7 };
  else if (today.length >= 3) insight = { kind: 'busy_today', count: today.length };
  else if (review > 0) insight = { kind: 'review', count: review };
  else if (today.length + comingUp.length === 0) insight = { kind: 'clear_week' };
  else insight = { kind: 'week', count: today.length + comingUp.length };

  return {
    greeting: greetingFor(now),
    today, comingUp, expiring, recent,
    summary: { total: memories.length, tasks: memories.filter((m) => m.type === 'task').length, upcoming: today.length + comingUp.length },
    insight,
  };
}
