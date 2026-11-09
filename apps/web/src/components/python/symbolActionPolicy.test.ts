import test from 'node:test';
import assert from 'node:assert/strict';
import type { PythonDefinition } from '@superfluid/contracts';
import { symbolActionPolicy, symbolReference } from './symbolActionPolicy';

const uri = 'file:///workspace/main.py';
const definition = (line = 0, character = 0, target = uri): PythonDefinition => ({
  module: { uri: target, position: { line: 0, character: 0 }, name: 'main', kind: 2 },
  containers: [],
  symbol: { uri: target, position: { line, character }, name: 'value', kind: 13 },
});

test('quick actions follow the hovered occurrence rather than the kind of its target', () => {
  const at = (
    prefix: string,
    definitions = [definition(0, prefix.length)],
    name = 'value',
    line = 0,
  ) =>
    symbolActionPolicy({
      name,
      prefix,
      uri,
      position: { line, character: prefix.length },
      definitions,
    });
  for (const prefix of ['def ', 'class ', '    async def '])
    assert.deepEqual(at(prefix), ['rename', 'search', 'copy', 'delete']);
  for (const prefix of ['', '    def run('])
    assert.deepEqual(at(prefix), ['rename', 'search', 'copy']);
  for (const prefix of ['import module as ', '    Thing as ', 'with resource as '])
    assert.deepEqual(at(prefix), ['rename-alias', 'definition', 'search']);
  for (const prefix of ['from module import ', 'obj.', 'print('])
    assert.deepEqual(at(prefix, [definition(4, 8)]), ['definition', 'search', 'copy']);
  assert.deepEqual(at('', [definition(0), definition(2)], 'value', 0), [
    'rename',
    'search',
    'copy',
  ]);
  assert.deepEqual(at('', [definition(0), definition(2)], 'value', 2), [
    'choose-definition',
    'search',
    'copy-name',
  ]);
  assert.deepEqual(at('', [definition(0, 0, 'file:///library/main.pyi')]), [
    'definition',
    'search',
    'copy',
  ]);
  assert.deepEqual(at('', []), ['search', 'copy-name']);
  for (const name of ['return', 'None', '42', '(', '']) assert.deepEqual(at('', [], name), []);
  const attribute = {
    ...definition(0, 8),
    symbol: {
      ...definition(0, 8).symbol,
      range: { start: { line: 0, character: 8 }, end: { line: 0, character: 27 } },
    },
  };
  assert.deepEqual(at('        self.', [attribute], 'attribute_path'), [
    'rename',
    'search',
    'copy',
  ]);
  assert.deepEqual(at('        self.', [attribute], 'attribute_path', 2), [
    'definition',
    'search',
    'copy',
  ]);
});

test('a binding reference includes its containing function instead of pointing at the function', () => {
  const target = {
    ...definition(),
    binding: true,
    symbol: { ...definition().symbol, name: 'run', kind: 12 },
  };
  assert.equal(symbolReference(target, 'param'), 'main.run.param');
  assert.equal(symbolReference(definition(), 'alias'), 'main.value');
});
