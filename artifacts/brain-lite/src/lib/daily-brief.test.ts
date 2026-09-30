// Run: TZ=Asia/Riyadh node --test artifacts/brain-lite/src/lib/daily-brief.test.ts
// (Node 22.6+ strips TS types natively.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyBrief, daysUntil, extractExpiryDates, parseLocalDate } from './daily-brief.ts';

const mem = (id: number, over: Record<string, unknown> = {}) => ({
  id, type: 'note', title: `m${id}`, summary: null, raw_text: '', event_date: null, amount: null, currency: null,
  people: [], tags: [], confidence: 1, status: 'confirmed', file_path: null, created_at: `2025-01-0${id % 9 + 1}T10:00:00Z`, ...over,
}) as never;

test('date-only parses as local midnight, not UTC', () => {
  const p = parseLocalDate('2025-03-14')!;
  assert.equal(p.dateOnly, true);
  assert.equal(p.date.getFullYear(), 2025);
  assert.equal(p.date.getMonth(), 2);
  assert.equal(p.date.getDate(), 14);
  assert.equal(p.date.getHours(), 0);
});

test('rejects invalid and vague dates', () => {
  assert.equal(parseLocalDate('2025-02-30'), null);
  assert.equal(parseLocalDate('2 years'), null);
  assert.equal(parseLocalDate(12345), null);
});

test('today boundaries: 23:59 today in, 00:00 tomorrow out', () => {
  const now = new Date(2025, 2, 14, 23, 30);
  const b = buildDailyBrief([
    mem(1, { event_date: '2025-03-14T23:59', type: 'appointment' }),
    mem(2, { event_date: '2025-03-15T00:00', type: 'task' }),
    mem(3, { event_date: '2025-03-14', type: 'task' }),
  ], now);
  assert.deepEqual(b.today.map((i) => i.memory.id).sort(), [1, 3]);
  assert.deepEqual(b.comingUp.map((i) => i.memory.id), [2]);
  assert.equal(b.greeting, 'evening');
});

test('coming up covers next 7 days inclusive, only events', () => {
  const now = new Date(2025, 2, 14, 9);
  const b = buildDailyBrief([
    mem(1, { event_date: '2025-03-21', type: 'task' }),
    mem(2, { event_date: '2025-03-22', type: 'task' }),
    mem(3, { event_date: '2025-03-16', type: 'receipt' }),
    mem(4, { event_date: '2025-03-16', type: 'note' }),
  ], now);
  assert.deepEqual(b.comingUp.map((i) => i.memory.id), [1]);
});

test('expiring: nested keys within 30 days only, no invented dates', () => {
  const now = new Date(2025, 2, 14, 9);
  const b = buildDailyBrief([
    mem(1, { extra: { warranty: { expires_on: '2025-04-13' } } }),
    mem(2, { extra: { warranty: '2 years' } }),
    mem(3, { extra: { subscription_renewal: '2025-04-14' } }),
    mem(4, { extra: { store: '2025-03-20' } }),
    mem(5, { extra: { expiry_date: '2025-03-13' } }),
  ], now);
  assert.deepEqual(b.expiring.map((e) => [e.memory.id, e.kind, e.days]), [[1, 'warranty', 30]]);
});

test('extractExpiryDates detects kinds', () => {
  const hits = extractExpiryDates({ plan: { renews_at: '2025-05-01' }, valid_until: '2025-06-01' });
  assert.deepEqual(hits.map((h) => h.kind), ['subscription', 'expiry']);
});

test('daysUntil counts calendar days', () => {
  assert.equal(daysUntil(new Date(2025, 2, 15, 0, 1), new Date(2025, 2, 14, 23, 59)), 1);
});

test('recent is last 3 by created_at; summary counts', () => {
  const now = new Date(2025, 2, 14, 9);
  const b = buildDailyBrief([
    mem(1, { created_at: '2025-03-01T00:00:00Z', type: 'task' }),
    mem(2, { created_at: '2025-03-05T00:00:00Z' }),
    mem(3, { created_at: '2025-03-03T00:00:00Z' }),
    mem(4, { created_at: '2025-03-04T00:00:00Z', type: 'task' }),
  ], now);
  assert.deepEqual(b.recent.map((m) => m.id), [2, 4, 3]);
  assert.deepEqual(b.summary, { total: 4, tasks: 2, upcoming: 0 });
});

test('rejects invalid local times and zoned invalid calendar days', () => {
  for (const v of ['2025-03-14T24:00', '2025-03-14T12:60', '2025-03-14T12:00:60', '2025-02-30T10:00:00Z',
    '2025-02-29T10:00:00+03:00', '2025-03-14T24:00:00Z', '2025-03-14T10:00:00+25:00']) assert.equal(parseLocalDate(v), null, v);
  assert.ok(parseLocalDate('2024-02-29T10:00:00Z'));
  assert.ok(parseLocalDate('2025-03-14T23:59:59+03:00'));
});

test('receipt purchase date is not Today', () => {
  const b = buildDailyBrief([mem(1, { type: 'receipt', event_date: '2025-03-14' })], new Date(2025, 2, 14, 9));
  assert.equal(b.today.length, 0);
});

test('warranty parent: purchase/start dates ignored, generic/end dates kept', () => {
  const hits = extractExpiryDates({ warranty: { purchase_date: '2025-03-20', start_date: '2025-03-21', issued: '2025-03-22', date: '2025-04-01' } });
  assert.deepEqual(hits.map((h) => [h.key, h.kind]), [['warranty.date', 'warranty']]);
  const h2 = extractExpiryDates({ warranty: { purchased_on: '2025-01-01', ends_on: '2026-01-01' }, purchase_date: '2025-01-01' });
  assert.deepEqual(h2.map((h) => h.key), ['warranty.ends_on']);
});

test('Arabic keys', () => {
  const hits = extractExpiryDates({ 'الضمان': { 'تاريخ_الشراء': '2025-01-01', 'تاريخ_الانتهاء': '2026-01-01' }, 'اشتراك': { 'تاريخ': '2025-05-01' }, 'ينتهي': '2025-06-01' });
  assert.deepEqual(hits.map((h) => h.kind), ['warranty', 'subscription', 'expiry']);
});
