import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffFromFile } from '@pierre/diffs';
import { inlineHunk } from './inlineHunk';
import { fileDiffOptions } from './diffOptions';

test('a Git marker opens only its change block, with original file coordinates', () => {
  const original = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
  const modified = 'one\nTWO\nthree\nfour\nfive\nsix\nseven\nnew\nlines\n';
  const file = parseDiffFromFile(
    { name: 'x.py', contents: original },
    { name: 'x.py', contents: modified },
    fileDiffOptions,
  );
  assert.equal(file.hunks.length, 1, 'nearby markers may share one patch hunk');
  assert.deepEqual(inlineHunk(file, 2), {
    start: 2,
    end: 2,
    kind: 'modified',
    original: 'two\n',
    modified: 'TWO\n',
    originalLine: 2,
    modifiedLine: 2,
  });
  assert.equal(inlineHunk(file, 9)?.modified, 'new\nlines\n');
  assert.equal(inlineHunk(file, 9)?.original, 'eight\n');
  assert.equal(inlineHunk(file, 4), undefined);
});

test('inline additions and deletions preserve empty sides and first-line anchors', () => {
  for (const [original, modified, line, kind] of [
    ['', 'new\nfile\n', 2, 'added'],
    ['gone\n', '', 1, 'deleted'],
    ['gone\nkeep\n', 'keep\n', 1, 'deleted'],
    ['keep\ngone\n', 'keep\n', 1, 'deleted'],
  ] as const) {
    const file = parseDiffFromFile(
      { name: 'x', contents: original },
      { name: 'x', contents: modified },
    );
    const change = inlineHunk(file, line)!;
    assert.equal(change.kind, kind);
    assert.equal(kind === 'added' ? change.original : change.modified, '');
    assert.equal(change.original + change.modified, kind === 'added' ? modified : 'gone\n');
  }
});
