const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Verify the actual build-generated worker's pure presentation function.
// No push event, notification, browser permission or network send is performed.
function presentation(payload) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../dist/public/sw.js'), 'utf8');
  const context = vm.createContext({
    URL, Set,
    self: { location: { origin: 'https://brain.example' }, addEventListener() {} },
  });
  vm.runInContext(source, context);
  return JSON.parse(JSON.stringify(context.pushPresentation(payload)));
}
test('hidden notification text stays generic but retains actions and safe memory link', () => {
  const result = presentation({
    hide_details: true, title: 'Private memory title', body: 'Private memory details',
    reminder_id: '54e7a123-25e7-4a14-9cf3-9a5b91327cef', notification_id: 'notification-opaque-id',
    url: '/memories/528',
    actions: [{ action: 'done', title: 'Private label' }, { action: 'snooze', title: 'Private label' }],
  });
  assert.equal(result.title, 'Brain Lite');
  assert.equal(result.options.body, 'You have a reminder');
  assert.equal(result.options.data.url, 'https://brain.example/memories/528');
  assert.equal(result.options.data.reminder_id, '54e7a123-25e7-4a14-9cf3-9a5b91327cef');
  assert.deepEqual(result.options.actions, [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'Snooze 1h' }]);
  assert.ok(!JSON.stringify(result).includes('Private'));
  assert.ok(!JSON.stringify(result).includes('token'));
});
test('hidden Arabic payload preserves formal generic text and localized actions', () => {
  const result = presentation({
    hide_details: true, language: 'ar', title: 'تفاصيل خاصة', body: 'تفاصيل خاصة',
    reminder_id: 'opaque-id', url: '/memories/528',
    actions: [{ action: 'done' }, { action: 'snooze' }],
  });
  assert.equal(result.title, 'Brain Lite');
  assert.equal(result.options.body, 'لديك تذكير');
  assert.equal(result.options.dir, 'rtl');
  assert.deepEqual(result.options.actions, [{ action: 'done', title: 'تم' }, { action: 'snooze', title: 'تأجيل ساعة' }]);
});
test('server-redacted payload without privacy flag still retains operational metadata', () => {
  const result = presentation({
    title: 'Brain Lite', body: 'You have a reminder', url: '/memories/528', reminder_id: 'opaque-id',
    actions: [{ action: 'done' }, { action: 'snooze' }],
  });
  assert.equal(result.options.body, 'You have a reminder');
  assert.equal(result.options.actions.length, 2);
  assert.equal(result.options.data.url, 'https://brain.example/memories/528');
});
test('invalid destinations and identifiers cannot become actionable notifications', () => {
  const result = presentation({
    hide_details: true, reminder_id: '../other', url: 'https://evil.example/memories/528',
    actions: [{ action: 'done' }, { action: 'delete' }],
  });
  assert.equal(result.options.data.url, 'https://brain.example/');
  assert.equal(result.options.data.reminder_id, null);
  assert.deepEqual(result.options.actions, []);
});