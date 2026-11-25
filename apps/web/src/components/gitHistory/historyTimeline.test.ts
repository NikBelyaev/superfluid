import test from 'node:test';
import assert from 'node:assert/strict';
import type { GitHistoryCommit } from '@superfluid/contracts';
import { historyKey, historyTimeline } from './historyTimeline';
import { layoutHistory } from './layoutHistory';

test('multi-repository history keeps the displayed prefix and separates identical commit hashes', () => {
  const commit = (hash: string, day: number, parents: string[] = []): GitHistoryCommit => ({
    hash,
    date: `2026-11-${day}T12:00:00Z`,
    parents,
    author: '',
    subject: '',
    refs: [],
  });
  const root = { id: 'root', path: '', branch: 'main' };
  const nested = { id: 'nested', path: 'nested', branch: 'main' };
  const a = {
    repository: root,
    commits: [commit('root-tip', 24, ['shared'])],
    next: { offset: 1, revision: '' },
  };
  const b = {
    repository: nested,
    commits: [commit('nested-tip', 25, ['shared']), commit('shared', 21)],
    next: null,
  };

  const first = historyTimeline([a, b]);
  assert.deepEqual(
    first.entries.map(({ key }) => key),
    ['nested:nested-tip', 'root:root-tip'],
  );
  assert.equal(first.next, a);

  const { entries, next } = historyTimeline([
    { ...a, commits: [...a.commits, commit('shared', 21)], next: null },
    b,
  ]);
  assert.deepEqual(entries.slice(0, 2), first.entries);
  assert.deepEqual(
    entries.map(({ key }) => key),
    ['nested:nested-tip', 'root:root-tip', 'root:shared', 'nested:shared'],
  );
  assert.equal(next, undefined);

  const { rows } = layoutHistory(
    entries.map(({ key, repository, commit }) => ({
      hash: key,
      parents: commit.parents.map((parent) => historyKey(repository, parent)),
    })),
  );
  assert.deepEqual(
    rows.map(({ lane }) => lane),
    [0, 1, 1, 0],
  );
});
