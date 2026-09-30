import { test } from "node:test";
import assert from "node:assert/strict";
import { createCalendarEvent, validEventDate } from "./calendar.ts";

const memory = { id: 2, type: "appointment", title: "Coffee", summary: null, event_date: "2026-10-12" };
test("calendar keeps date-only appointments as all-day events", () => {
  const ics = createCalendarEvent(memory);
  assert.match(ics, /DTSTART;VALUE=DATE:20261012\r\n/);
  assert.ok(!ics.includes("DTEND")); // Do not invent a duration.
});
test("calendar honors explicit offsets and floating local time", () => {
  assert.match(createCalendarEvent({ ...memory, event_date: "2026-10-12T14:30:00+03:00" }), /DTSTART:20261012T113000Z/);
  assert.match(createCalendarEvent({ ...memory, event_date: "2026-10-12T14:30" }), /DTSTART:20261012T143000\r\n/);
});
test("calendar escapes injection characters and folds Arabic by bytes", () => {
  const title = "موعد مهم، ".repeat(30) + "\r\nBEGIN:VEVENT;test,value\\";
  const ics = createCalendarEvent({ ...memory, title });
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /\\nBEGIN:VEVENT\\;test\\,value\\\\/);
  assert.equal((ics.match(/\r\nBEGIN:VEVENT\r\n/g) || []).length, 1);
});
test("date validation rejects impossible dates rather than normalizing", () => {
  for (const date of ["tomorrow", "2026-02-29", "2026-04-31", "2026-01-01T25:00", "2026-01-01T12:00+25:00"]) {
    assert.equal(validEventDate(date), false, date);
  }
  assert.ok(validEventDate("2028-02-29"));
  assert.throws(() => createCalendarEvent({ ...memory, type: "note" }));
});