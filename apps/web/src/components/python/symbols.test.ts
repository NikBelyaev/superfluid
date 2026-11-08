import assert from 'node:assert/strict';
import test from 'node:test';
import { sameSymbol, symbolAt, type DocumentSymbol } from './symbols';

test('symbol identity ignores positions within one definition and distinguishes nested scopes and duplicate names', () => {
  const symbol = (
    name: string,
    kind: number,
    start: number,
    end: number,
    children?: DocumentSymbol[],
  ): DocumentSymbol => ({
    name,
    kind,
    range: { start: { line: start, character: 0 }, end: { line: end, character: 0 } },
    children,
  });
  const symbols = [
    symbol('A', 5, 0, 10, [symbol('foo', 6, 2, 5), symbol('bar', 6, 6, 9)]),
    symbol('B', 5, 12, 20, [symbol('foo', 6, 14, 17)]),
    symbol('run', 12, 22, 25),
    symbol('run', 12, 27, 30),
  ];
  const location = (line: number, column = 1, path = 'models.py') => ({ path, line, column });
  for (const [from, to, expected] of [
    [location(1, 7), location(2), true],
    [location(3, 9), location(5, 20), true],
    [location(3, 9), location(1, 7), false],
    [location(3, 9), location(7, 9), false],
    [location(3, 9), location(15, 9), false],
    [location(23), location(28), false],
    [location(3), location(6), false],
    [location(3), location(3, 1, 'other.py'), false],
    [location(40), location(41), false],
  ] as const)
    assert.equal(sameSymbol(symbols, from, to), expected, JSON.stringify({ from, to }));
  assert.equal(sameSymbol([], location(3, 9), location(3, 9)), true);
  assert.equal(symbolAt(symbols, 2, 8)?.name, 'A.foo');
});
