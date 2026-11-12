import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffFromFile } from '@pierre/diffs';
import { lineMarkers } from './lineMarkers';
import { fileDiffOptions } from './diffOptions';

test('Git markers keep modified line coordinates and anchor deletions at either edge', () => {
  for (const [before, after, expected] of [
    [
      'a\nb\nc\nd\ne\n',
      'a\nB\nc\nd\ne\nnew\n',
      [
        { start: 2, end: 2, kind: 'modified' },
        { start: 6, end: 6, kind: 'added' },
      ],
    ],
    ['a\nb\nc\n', 'b\nc\n', [{ start: 1, end: 1, kind: 'deleted', before: true }]],
    ['a\nb\nc\n', 'a\nb\n', [{ start: 2, end: 2, kind: 'deleted', before: false }]],
    ['a\n', '', [{ start: 1, end: 1, kind: 'deleted', before: true }]],
    ['', 'new\nfile\n', [{ start: 1, end: 2, kind: 'added' }]],
    ['a\r\nb\r\n', 'a\r\nB\r\n', [{ start: 2, end: 2, kind: 'modified' }]],
    ['a\nb\n', 'a\r\nb\r\n', []],
    ['a\n', 'a\n', []],
  ] as const) {
    const file = parseDiffFromFile(
      { name: 'file.py', contents: before },
      { name: 'file.py', contents: after },
      fileDiffOptions,
    );
    assert.deepEqual(lineMarkers(file), expected);
  }
});
