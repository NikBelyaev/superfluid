import test from 'node:test';
import assert from 'node:assert/strict';
import { recordLocation, removeLineageEntry } from './lineage';

test('lineage records file switches, preserves surface destinations and truncates forward history', () => {
  const first = { path: 'a.py', line: 12, column: 4, label: 'a.py' };
  const second = { path: 'b.py', line: 8, column: 2, label: 'b.py' };
  const right = { ...second, group: 'right' as const };
  const initial = recordLocation([], -1, first);
  const switched = recordLocation(initial.history, initial.historyIndex, second);
  assert.deepEqual(switched.history, [first, second]);
  assert.deepEqual(recordLocation(switched.history, switched.historyIndex, second), switched);
  assert.deepEqual(recordLocation(switched.history, 0, right), {
    history: [first, right],
    historyIndex: 1,
  });
  assert.deepEqual(recordLocation(switched.history, 1, right).history, [first, second, right]);
  const full = Array.from({ length: 100 }, (_, line) => ({ ...first, line: line + 1 }));
  const bounded = recordLocation(full, 99, right);
  assert.equal(bounded.history.length, 100);
  assert.deepEqual(bounded.history[0], full[1]);
  assert.equal(bounded.historyIndex, 99);
});

test('removing a lineage entry preserves the current position or selects its neighbor', () => {
  const history = ['a', 'b', 'c', 'd'].map((label) => ({
    path: `${label}.py`,
    line: 1,
    column: 1,
    label,
  }));
  for (const [current, removed, labels, selected] of [
    [2, 0, ['b', 'c', 'd'], 'c'],
    [2, 3, ['a', 'b', 'c'], 'c'],
    [2, 2, ['a', 'b', 'd'], 'b'],
    [0, 0, ['b', 'c', 'd'], 'b'],
    [3, 3, ['a', 'b', 'c'], 'c'],
  ] as const) {
    const result = removeLineageEntry(history, current, removed);
    assert.deepEqual(
      result.history.map((item) => item.label),
      labels,
    );
    assert.equal(result.history[result.historyIndex].label, selected);
  }
  assert.deepEqual(
    history.map((item) => item.label),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(removeLineageEntry([history[0]], 0, 0), { history: [], historyIndex: -1 });
  assert.deepEqual(removeLineageEntry([history[0], history[0]], 1, 0), {
    history: [history[0]],
    historyIndex: 0,
  });
});
