import assert from 'node:assert/strict';
import { test } from 'node:test';
import { treeWindow } from './treeWindow';

const rows = [
  { depth: 0, subtreeEnd: 66 },
  { depth: 1, subtreeEnd: 64 },
  { depth: 2, subtreeEnd: 63 },
  ...Array.from({ length: 60 }, (_, i) => ({ depth: 3, subtreeEnd: i + 4 })),
  { depth: 2, subtreeEnd: 64 },
  { depth: 1, subtreeEnd: 66 },
  { depth: 2, subtreeEnd: 66 },
  { depth: 0, subtreeEnd: 67 },
];

test('keeps scrolled ancestors in the virtual window once, in tree order', () => {
  const visible = treeWindow(rows, 567, 280);
  assert.deepEqual(
    visible.filter((row) => row.sticky),
    [
      { index: 0, top: 567, sticky: true },
      { index: 1, top: 595, sticky: true },
      { index: 2, top: 623, sticky: true },
    ],
  );
  assert.equal(visible.length, 33);
  assert.equal(new Set(visible.map((row) => row.index)).size, visible.length);
  assert.ok(visible.every((row, i) => !i || row.index > visible[i - 1].index));
  assert.ok(treeWindow(rows, 0, 280).every((row) => !row.sticky));
});

test('pushes an outgoing folder below its parent and replaces it with the next branch', () => {
  const leaving = treeWindow(rows, 61 * 28 + 14, 280);
  assert.equal(leaving.find((row) => row.index === 2)?.top, 62 * 28);
  assert.deepEqual(
    treeWindow(rows, 64 * 28, 280)
      .filter((row) => row.sticky)
      .map((row) => row.index),
    [0, 64],
  );
  assert.ok(treeWindow(rows, 66 * 28, 280).every((row) => !row.sticky));
});

test('does not pin collapsed folders or the flat changes list', () => {
  const flat = Array.from({ length: 100 }, (_, index) => ({ depth: 0, subtreeEnd: index + 1 }));
  assert.ok(treeWindow(flat, 567, 280).every((row) => !row.sticky));
  assert.deepEqual(treeWindow([], 0, 280), []);
});
