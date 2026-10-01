// Run: node --test artifacts/brain-lite/src/lib/graph-helpers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCompleteDate, validateRange } from './graph-dates.ts';
import { DEFAULT_FILTERS, filtersToParams, neighborhood, personKey, scopeCounts, visibleScopeIds } from './graph-model.ts';

const node = (over: Record<string, unknown>) => ({ id: 'x', kind: 'memory', title: 't', type: null, count: 0, memory_id: null, memory_ids: [], space_id: null, date: null, status: null, pinned: false, ...over }) as never;

test('partial or impossible dates are not complete', () => {
  for (const v of ['', '2025', '2025-0', '2025-02-3', '0002-01-01', '2025-02-30', '2025-13-01']) assert.equal(isCompleteDate(v), false, v);
  assert.equal(isCompleteDate('2024-02-29'), true);
});

test('validateRange: empty ok, partial blocked, reversed blocked', () => {
  assert.equal(validateRange('', ''), null);
  assert.equal(validateRange('2025-01-01', ''), null);
  assert.equal(validateRange('2025-01-0', ''), 'partial');
  assert.equal(validateRange('2025-03-01', '2025-02-01'), 'reversed');
  assert.equal(validateRange('2025-02-01', '2025-02-01'), null);
});

test('filtersToParams omits types when all memory chips on and passes dates/limit', () => {
  assert.deepEqual(filtersToParams(DEFAULT_FILTERS), { limit: 150 });
  const p = filtersToParams({ ...DEFAULT_FILTERS, chips: ['events', 'tasks', 'people'], from: '2025-01-01', suggested: true, limit: 300 });
  assert.deepEqual(p, { types: 'appointment,task', from: '2025-01-01', include_suggested: true, limit: 300 });
});

test('Space/Person scope is limited to visible memories; total_count shown separately', () => {
  const nodes = [node({ id: 'm1', memory_id: 1 }), node({ id: 'm2', memory_id: 2 })];
  const space = node({ id: 'space:a', kind: 'space', memory_ids: [1, 2, 9], total_count: 14 });
  assert.deepEqual(visibleScopeIds(space, nodes), [1, 2]);
  assert.deepEqual(scopeCounts(space, nodes), { visible: 2, total: 14 });
  assert.deepEqual(scopeCounts(node({ kind: 'person', memory_ids: [1] }), nodes), { visible: 1, total: null });
});

test('neighborhood hops and personKey', () => {
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }] as never[];
  assert.deepEqual([...neighborhood(edges, 'a', 2)].sort(), ['a', 'b', 'c']);
  assert.equal(personKey(node({ id: 'person:sara ali', title: 'Sara Ali' })), 'sara ali');
});
