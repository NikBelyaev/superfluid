import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineRanges } from './inlineRanges';

test('a same-line replacement highlights only the changed fragments on both versions', () => {
  const original = 'return fetch(parameters={}, result_path=path)\n';
  const modified = "return fetch(parameters='test', result_path=path)\n";
  const changes = inlineRanges(original, modified);
  assert.equal(changes.length, 1);
  const [change] = changes;
  assert.equal(change.original.startLineNumber, 1);
  assert.equal(change.original.endLineNumber, 1);
  assert.equal(
    original.slice(change.original.startColumn - 1, change.original.endColumn - 1),
    '{}',
  );
  assert.equal(
    modified.slice(change.modified.startColumn - 1, change.modified.endColumn - 1),
    "'test'",
  );
});
