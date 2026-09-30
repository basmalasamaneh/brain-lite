const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText).toString('base64');
const dates = compile(fs.readFileSync(`${__dirname}/notifications.ts`, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'"));
const modulePromise = import(compile(fs.readFileSync(`${__dirname}/google-calendar.ts`, 'utf8').replace("'./notifications'", JSON.stringify(dates))));
const memory = { type: 'appointment', title: 'موعد & review + team', summary: 'Bring notes', event_date: '2030-04-15T08:00:00' };

test('floating appointment uses saved timezone, preserving safely encoded Arabic text', async () => {
  const { googleCalendarUrl } = await modulePromise;
  const url = new URL(googleCalendarUrl({ ...memory, extra: { location: 'Room A & B' } }, 'Asia/Riyadh'));
  assert.equal(url.origin, 'https://calendar.google.com');
  assert.equal(url.searchParams.get('dates'), '20300415T050000Z/20300415T060000Z');
  assert.equal(url.searchParams.get('ctz'), 'Asia/Riyadh');
  assert.equal(url.searchParams.get('text'), memory.title);
  assert.equal(url.searchParams.get('location'), 'Room A & B');
});
test('date-only appointments are all-day with exclusive next-day end', async () => {
  const { googleCalendarUrl } = await modulePromise;
  const url = new URL(googleCalendarUrl({ ...memory, event_date: '2030-12-31' }, 'Asia/Hebron'));
  assert.equal(url.searchParams.get('dates'), '20301231/20310101');
});
test('explicit offsets preserve instants independently of saved timezone', async () => {
  const { googleCalendarUrl } = await modulePromise;
  const url = new URL(googleCalendarUrl({ ...memory, event_date: '2030-04-15T08:30:00+03:00' }, 'America/New_York'));
  assert.equal(url.searchParams.get('dates'), '20300415T053000Z/20300415T063000Z');
});
test('reject missing/invalid dates, nonappointments, DST gaps and ambiguous times', async () => {
  const { googleCalendarUrl } = await modulePromise;
  for (const event_date of [null, 'not a date', '2030-02-30', '2030-04-15T25:00', '2030-03-10T02:30', '2030-11-03T01:30']) {
    assert.equal(googleCalendarUrl({ ...memory, event_date }, 'America/New_York'), null);
  }
  assert.equal(googleCalendarUrl({ ...memory, type: 'note' }, 'UTC'), null);
});