import test from 'node:test';
import assert from 'node:assert/strict';
import { symbolAt, type DocumentSymbol } from './symbols';

const symbols: DocumentSymbol[] = [
  {
    name: 'Store',
    kind: 5,
    range: { start: { line: 1, character: 0 }, end: { line: 9, character: 20 } },
    children: [
      {
        name: 'count',
        kind: 6,
        range: { start: { line: 2, character: 4 }, end: { line: 4, character: 17 } },
      },
      {
        name: 'Nested',
        kind: 5,
        range: { start: { line: 5, character: 4 }, end: { line: 9, character: 20 } },
        children: [
          {
            name: 'run',
            kind: 6,
            range: { start: { line: 6, character: 8 }, end: { line: 9, character: 20 } },
          },
        ],
      },
    ],
  },
  {
    name: 'main',
    kind: 12,
    range: { start: { line: 11, character: 0 }, end: { line: 12, character: 10 } },
  },
];

test('lineage uses the enclosing symbol, including class and nested scopes', () => {
  for (const [line, character, expected] of [
    [1, 6, { name: 'Store', kind: 5 }],
    [2, 8, { name: 'Store.count', kind: 6 }],
    [3, 0, { name: 'Store.count', kind: 6 }],
    [4, 16, { name: 'Store.count', kind: 6 }],
    [4, 17, { name: 'Store', kind: 5 }],
    [5, 10, { name: 'Store.Nested', kind: 5 }],
    [8, 15, { name: 'Store.Nested.run', kind: 6 }],
    [11, 4, { name: 'main', kind: 12 }],
    [0, 0, undefined],
    [9, 20, undefined],
    [12, 10, undefined],
  ] as const)
    assert.deepEqual(symbolAt(symbols, line, character), expected, `${line}:${character}`);
  assert.equal(symbolAt([], 0, 0), undefined);
});
