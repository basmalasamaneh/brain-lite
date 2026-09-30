import { localTimeToUtc } from './notifications';

type Appointment = { type: string; title: string; event_date: string | null; summary?: string | null; extra?: Record<string, unknown> | null };
const compact = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** Build a reviewable draft only; never creates an event or sends raw memory text. */
export function googleCalendarUrl(memory: Appointment, timezone: string): string | null {
  if (memory.type !== 'appointment' || !memory.event_date) return null;
  const value = memory.event_date;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00', offset] = match;
  const calendarDate = new Date(Date.UTC(+year, +month - 1, +day));
  if (calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: memory.title });
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    if (hour === undefined) {
      const end = new Date(calendarDate.getTime() + 86400000);
      params.set('dates', `${compact(calendarDate).slice(0, 8)}/${compact(end).slice(0, 8)}`);
    } else {
      if (+hour > 23 || +minute > 59 || +second > 59) return null;
      const start = offset
        ? new Date(`${value.slice(0, 10)}T${hour}:${minute}:${second}${offset}`)
        : new Date(new Date(localTimeToUtc(`${value.slice(0, 10)}T${hour}:${minute}`, timezone)).getTime() + +second * 1000);
      if (!Number.isFinite(start.getTime())) return null;
      // A reviewable one-hour draft, not an inferred appointment duration.
      params.set('dates', `${compact(start)}/${compact(new Date(start.getTime() + 3600000))}`);
    }
    params.set('ctz', timezone);
  } catch { return null; }
  if (memory.summary) params.set('details', memory.summary.slice(0, 2000));
  const location = memory.extra?.location;
  if (typeof location === 'string' && location.trim()) params.set('location', location.trim().slice(0, 500));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}