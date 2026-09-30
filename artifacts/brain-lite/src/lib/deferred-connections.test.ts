// Run: node --test artifacts/brain-lite/src/lib/deferred-connections.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearDeferredConnections, deferredConnectionsKey, readDeferredConnections, saveDeferredConnection } from './deferred-connections.ts';

function browserStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
  };
}

test('Later survives a fresh read and stores only unique IDs', () => {
  const storage = browserStorage();
  assert.deepEqual(saveDeferredConnection('owner', 12, storage), [12]);
  assert.deepEqual(saveDeferredConnection('owner', 12, storage), [12]);
  saveDeferredConnection('owner', 34, storage);
  assert.equal(storage.getItem(deferredConnectionsKey('owner')), '[12,34]');
  assert.deepEqual(readDeferredConnections('owner', storage), [12, 34]);
});

test('owners are isolated; logout/deletion cleanup and review reset remove only that owner', () => {
  const storage = browserStorage();
  saveDeferredConnection('a', 1, storage);
  saveDeferredConnection('b', 2, storage);
  assert.deepEqual(readDeferredConnections('c', storage), []);
  clearDeferredConnections('a', storage);
  assert.deepEqual(readDeferredConnections('a', storage), []);
  assert.equal(storage.getItem(deferredConnectionsKey('a')), null);
  assert.deepEqual(readDeferredConnections('b', storage), [2]);
  assert.notEqual(deferredConnectionsKey('a/b'), deferredConnectionsKey('a%2Fb'));
  assert.throws(() => deferredConnectionsKey(''));
});

test('malformed JSON and invalid shapes are safe; only positive safe integer IDs are trusted', () => {
  const storage = browserStorage();
  for (const raw of ['{', 'null', '{}', '"12"', '12']) {
    storage.setItem(deferredConnectionsKey('a'), raw);
    assert.deepEqual(readDeferredConnections('a', storage), []);
  }
  storage.setItem(deferredConnectionsKey('a'), '[1,1,"2",null,-2,0,1.5,9007199254740992,3,{}]');
  assert.deepEqual(readDeferredConnections('a', storage), [1, 3]);
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => saveDeferredConnection('a', id, storage));
  }
  storage.setItem(deferredConnectionsKey('a'), '{');
  assert.deepEqual(saveDeferredConnection('a', 4, storage), [4]);
});

test('sequential tab writes read latest storage instead of overwriting a cached snapshot', () => {
  const storage = browserStorage();
  readDeferredConnections('a', storage);
  saveDeferredConnection('a', 5, storage);
  assert.deepEqual(saveDeferredConnection('a', 6, storage), [5, 6]);
  clearDeferredConnections('a', storage);
  assert.deepEqual(saveDeferredConnection('a', 7, storage), [7]);
});

test('blocked reads, quota failures and blocked removals propagate instead of claiming success', () => {
  const storage = browserStorage();
  saveDeferredConnection('a', 1, storage);
  assert.throws(() => readDeferredConnections('a', { getItem() { throw new Error('blocked'); } }));
  assert.throws(() => saveDeferredConnection('a', 2, {
    ...storage, setItem() { throw new Error('quota'); },
  }));
  assert.deepEqual(readDeferredConnections('a', storage), [1]);
  assert.throws(() => clearDeferredConnections('a', { removeItem() { throw new Error('blocked'); } }));
});

test('frontend wiring guards success UI and clears outgoing authenticated owners', () => {
  const deck = readFileSync(new URL('../components/connections.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../hooks/use-connections.ts', import.meta.url), 'utf8');
  assert.match(deck, /if \(deferred\.defer\(current\.id\)\) toast/);
  assert.match(deck, /if \(!deferred\.reset\(\)\) return/);
  assert.match(app, /clearDeferredConnections\(prev\.current\)/);
  assert.match(hook, /catch \{\s*persistenceError\(\);\s*return false;/);
  assert.match(hook, /window\.addEventListener\('storage', refresh\)/);
});