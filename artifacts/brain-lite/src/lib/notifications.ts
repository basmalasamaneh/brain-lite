import type { QueryClient } from '@tanstack/react-query';

export type {
  NotificationSettings, Reminder, Notification as Notice,
  ListNotifications200 as Notices, MemoryReminderSettings as ReminderSettings,
} from '@workspace/api-client-react';

export function clearNotificationCaches(qc: QueryClient) {
  qc.removeQueries({ predicate: q => ['/api/notifications', '/api/reminders', '/api/memories/'].some(prefix =>
    String(q.queryKey[0]).startsWith(prefix)) });
}

// This runs BEFORE session logout so the backend can remove the current endpoint.
// Browser unsubscribe is still attempted if the server is temporarily unavailable.
export async function disconnectCurrentPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  registration?.active?.postMessage({ type: 'BRAIN_LITE_CLEAR_NOTIFICATIONS' });
  localStorage.removeItem('brain-lite-push-device');
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  try {
    const { unsubscribePush } = await import('@workspace/api-client-react');
    await unsubscribePush({ endpoint: subscription.endpoint }, { credentials: 'include' });
  } catch (error) {
    console.warn('Server push cleanup will also run during session/data deletion:', error);
  } finally {
    await subscription.unsubscribe();
  }
}

export function safeNotificationPath(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    if (url.origin !== window.location.origin || url.username || url.password) return null;
    let path = url.pathname;
    if (base && path.startsWith(`${base}/`)) path = path.slice(base.length);
    if (!/^\/(?:memories\/[1-9]\d*|spaces(?:\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?|settings|notifications)?\/?$/i.test(path)) return null;
    return path;
  } catch { return null; }
}

export function dateInTimezone(value: string | Date, timezone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function isHomeReminderDue(reminder: { status: string; fire_at: string }, timezone: string, now = new Date()) {
  if (!['pending', 'snoozed', 'sent'].includes(reminder.status)) return false;
  const today = dateInTimezone(now, timezone);
  const fireDay = dateInTimezone(reminder.fire_at, timezone);
  if (fireDay === today) return true;
  const [year, month, day] = today.split('-').map(Number);
  // Advance the calendar date, not the zoned instant (DST days are not 24h).
  const tomorrow = dateInTimezone(new Date(Date.UTC(year, month - 1, day + 1, 12)), 'UTC');
  return fireDay === tomorrow;
}

/** Wall-clock to UTC in the explicitly selected IANA zone, not the browser zone.
 * Reject nonexistent/ambiguous DST times instead of silently scheduling incorrectly.
 */
export function localTimeToUtc(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Select a date and time.');
  const [, y, m, d, h, min] = match;
  const wall = Date.UTC(+y, +m - 1, +d, +h, +min);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const candidates = new Set<number>();
  // Sample both sides of a transition to discover all candidate offsets.
  for (let shift = -36; shift <= 36; shift += 6) {
    const sample = wall + shift * 3600000;
    const p = Object.fromEntries(formatter.formatToParts(sample).map(part => [part.type, part.value]));
    const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - sample;
    const candidate = wall - offset;
    const c = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
    if (`${c.year}-${c.month}-${c.day}T${c.hour}:${c.minute}` === value) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error(candidates.size ? 'This time occurs twice during a daylight-saving change. Choose another time.' : 'This time does not exist during a daylight-saving change. Choose another time.');
  return new Date([...candidates][0]).toISOString();
}