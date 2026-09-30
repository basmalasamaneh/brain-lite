const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = fs.readFileSync(`${__dirname}/notifications.ts`, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('specific reminder uses selected timezone rather than browser timezone', async () => {
  const { localTimeToUtc } = await modulePromise;
  assert.equal(localTimeToUtc('2030-04-15T08:00', 'Asia/Riyadh'), '2030-04-15T05:00:00.000Z');
  assert.equal(localTimeToUtc('2030-04-15T08:00', 'America/New_York'), '2030-04-15T12:00:00.000Z');
  assert.equal(localTimeToUtc('2030-01-15T08:00', 'America/New_York'), '2030-01-15T13:00:00.000Z');
});
test('rejects DST gaps, repeats and invalid dates without silently moving the reminder', async () => {
  const { localTimeToUtc } = await modulePromise;
  assert.throws(() => localTimeToUtc('2030-03-10T02:30', 'America/New_York'), /does not exist/);
  assert.throws(() => localTimeToUtc('2030-11-03T01:30', 'America/New_York'), /occurs twice/);
  assert.throws(() => localTimeToUtc('2030-02-30T08:00', 'UTC'));
});
test('today/tomorrow dates are based on the settings timezone', async () => {
  const { dateInTimezone } = await modulePromise;
  assert.equal(dateInTimezone('2030-04-15T23:30:00Z', 'Asia/Riyadh'), '2030-04-16');
  assert.equal(dateInTimezone('2030-04-15T00:30:00Z', 'America/New_York'), '2030-04-14');
});
test('specific-date regression remains visible in Home before and after delivery in the user timezone', async () => {
  const { isHomeReminderDue } = await modulePromise;
  const now = new Date('2026-09-30T22:53:00Z');
  for (const timezone of ['UTC', 'Asia/Riyadh', 'Asia/Tokyo', 'America/Los_Angeles']) {
    for (const status of ['pending', 'snoozed', 'sent']) {
      assert.equal(isHomeReminderDue({ status, fire_at: '2026-09-30T22:55:00Z' }, timezone, now), true);
    }
    assert.equal(isHomeReminderDue({ status: 'done', fire_at: '2026-09-30T22:55:00Z' }, timezone, now), false);
  }
  assert.equal(isHomeReminderDue({ status: 'pending', fire_at: '2026-10-01T08:00:00Z' }, 'UTC', now), true);
  assert.equal(isHomeReminderDue({ status: 'pending', fire_at: '2026-10-02T08:00:00Z' }, 'UTC', now), false);
});
test('notification navigation rejects external, protocol and non-app URLs', async () => {
  const { safeNotificationPath } = await modulePromise;
  global.window = { location: { origin: 'https://brain.example' } };
  assert.equal(safeNotificationPath('/memories/15'), '/memories/15');
  assert.equal(safeNotificationPath('https://brain.example/spaces/5ae5c1de-5b78-47c8-bec5-350e5c7c54de'), '/spaces/5ae5c1de-5b78-47c8-bec5-350e5c7c54de');
  assert.equal(safeNotificationPath('/spaces/4'), null);
  assert.equal(safeNotificationPath('/spaces/not-a-uuid'), null);
  assert.equal(safeNotificationPath('//evil.example/memories/15'), null);
  assert.equal(safeNotificationPath('javascript:alert(1)'), null);
  assert.equal(safeNotificationPath('/api/brain/export'), null);
  assert.equal(safeNotificationPath('https://other.example/memories/15'), null);
  assert.equal(safeNotificationPath('/memories/15?edit=1'), '/memories/15');
});