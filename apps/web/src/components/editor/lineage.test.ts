import test from 'node:test';
import assert from 'node:assert/strict';
import { removeLineageEntry } from './lineage';

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
