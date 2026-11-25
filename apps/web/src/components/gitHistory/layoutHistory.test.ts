import test from 'node:test';
import assert from 'node:assert/strict';
import type { GitHistoryCommit } from '@superfluid/contracts';
import { layoutHistory } from './layoutHistory';

test('history lanes connect both sides of a merge across a page boundary', () => {
  const commit = (hash: string, ...parents: string[]): GitHistoryCommit => ({
    hash,
    parents,
    author: '',
    date: '',
    refs: [],
    subject: '',
  });
  const merge = commit('merge', 'main', 'topic');
  const main = commit('main', 'root');
  const topic = commit('topic', 'root');
  const root = commit('root');
  const first = layoutHistory([merge, main]);
  const unrelated = commit('unrelated');
  const { rows } = layoutHistory([merge, main, topic, root, unrelated]);
  assert.deepEqual(rows.slice(0, first.rows.length), first.rows);
  assert.deepEqual(
    rows.map((row) => row.lane),
    [0, 0, 1, 0, 0],
  );
  assert.deepEqual(
    rows[0].lines.map((line) => line.lane),
    [0, 1],
  );
  assert.match(rows[2].lines.at(-1)!.path, /C/);
  assert.equal(rows[0].branch, rows[3].branch);
  assert.equal(rows[0].lines[1].branch, rows[2].branch);
  assert.equal(rows[2].lines.at(-1)!.branch, rows[3].branch);
  assert.notEqual(rows[0].branch, rows[2].branch);
  assert.notEqual(rows[3].branch, rows[4].branch);
  assert.equal(rows[3].lines.length, 1);
  assert.equal(rows[0].width, rows[1].width);
  assert.ok(rows[3].width < rows[0].width);
});
