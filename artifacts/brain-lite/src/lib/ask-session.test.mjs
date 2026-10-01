// Run: node --test artifacts/brain-lite/src/lib/ask-session.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../api-server/package.json', import.meta.url));
const { build } = require('esbuild');
const result = await build({
  entryPoints: [new URL('./ask-session.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'react-store-test', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test-react' }));
    build.onLoad({ filter: /.*/, namespace: 'test-react' }, () => ({ contents: 'export const useSyncExternalStore=(subscribe,get)=>get();' }));
  } }],
});
const { askSession, parseAskScope, useAskTurns } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const turn = { id: 'response', role: 'assistant', text: 'answer', sources: [] };
test('URL scope is canonical, bounded and never falls back when malformed', () => {
  assert.deepEqual(parseAskScope('memory_ids=2,1,2&scope_label=Coffee'), {
    key: 'memories:1,2', memoryIds: [1, 2], label: 'Coffee', invalid: false,
  });
  assert.equal(parseAskScope('').key, '');
  assert.equal(parseAskScope(`memory_ids=${Array.from({ length: 300 }, (_, i) => i + 1).join(',')}`).invalid, false);
  for (const value of ['', '0', '-1', '1.5', 'NaN', '1,', '1, 2', '2147483648', Array(301).fill(1).join(',')]) {
    const scope = parseAskScope(`memory_ids=${encodeURIComponent(value)}`);
    assert.equal(scope.invalid, true, value);
    assert.notEqual(scope.key, '');
    assert.equal(scope.memoryIds, undefined);
  }
  assert.equal(parseAskScope('memory_ids=1&memory_ids=2').invalid, true);
});
test('scope/identity changes and clear fence late responses, including A→B→A navigation', () => {
  askSession.setOwner('owner');
  askSession.setScope('A');
  const token = askSession.token();
  askSession.pushForSession('owner', 'A', token, turn);
  assert.equal(askSession.get().length, 1);
  assert.deepEqual(useAskTurns('B'), []);
  askSession.setScope('B');
  assert.deepEqual(askSession.get(), []);
  askSession.pushForSession('owner', 'A', token, turn);
  askSession.setScope('A');
  askSession.pushForSession('owner', 'A', token, turn);
  assert.deepEqual(askSession.get(), []);
  const current = askSession.token();
  askSession.clear();
  askSession.pushForSession('owner', 'A', current, turn);
  assert.deepEqual(askSession.get(), []);
  askSession.setOwner('another');
  askSession.pushForSession('owner', 'A', askSession.token(), turn);
  assert.deepEqual(askSession.get(), []);
});