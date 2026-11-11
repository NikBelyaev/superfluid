import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffFromFile } from '@pierre/diffs';
import { workingFileText } from './workingFileText';

test('deleted working files use disk for clean retained buffers and preserve unsaved edits', () => {
  const retained = { text: 'retained\n', dirty: false };
  const compare = (base: string, disk: string, buffer = retained) =>
    parseDiffFromFile(
      { name: 'file.py', contents: base },
      { name: 'file.py', contents: workingFileText(disk, true, buffer) },
    );
  const deleted = compare(retained.text, '');
  assert.equal(deleted.hunks[0].deletionLines, 1);
  assert.equal(deleted.hunks[0].additionLines, 0);
  assert.equal(compare('', '').hunks.length, 0);
  const recreated = compare('', 'recreated\n');
  assert.equal(recreated.additionLines[0], 'recreated\n');
  assert.equal(workingFileText('', true, { text: 'unsaved\n', dirty: true }), 'unsaved\n');
  assert.equal(workingFileText('disk\n', false, retained), retained.text);
});
