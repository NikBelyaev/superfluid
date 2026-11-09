import test from 'node:test';
import assert from 'node:assert/strict';
import type { GitStatus, Operation } from '@superfluid/contracts';
import { fileRepositoryIds, gitActionProblem, repositoriesForAction } from './repositories';

const repository = { id: 'core', path: 'apps/core', branch: 'task/example' };
const clean: GitStatus = {
  branch: 'task/example',
  baseBranch: 'main',
  head: 'abc',
  upstream: 'origin/task/example',
  ahead: 0,
  behind: 0,
  files: [],
  branches: ['main', 'task/example'],
  repo: true,
  changes: { insertions: 0, deletions: 0 },
  hasRemote: true,
  push: { ahead: 0, behind: 0 },
  prChanges: false,
};

test('file decorations include the owning repositories of navigation targets', () => {
  const repositories = [
    { ...repository, id: 'root', path: '' },
    repository,
    { ...repository, id: 'procs', path: 'apps/procs' },
    { ...repository, id: 'nested', path: 'apps/procs/nested' },
  ];
  assert.deepEqual(
    fileRepositoryIds(repositories, [
      'apps/core/main.py',
      'apps/procs/base_command.py',
      'apps/procs/other.py',
      'apps/procs/nested/model.py',
      'README.md',
      'file:///outside/source.py',
    ]),
    ['core', 'procs', 'nested', 'root'],
  );
  assert.deepEqual(fileRepositoryIds(repositories, ['apps/coreutils/main.py']), ['root']);
  assert.deepEqual(fileRepositoryIds([repository], ['outside.py']), []);
});

test('Git actions follow dirty, unpushed and published states and block unresolved operations', () => {
  const group = [repository];
  for (const action of ['commit', 'push', 'pr', 'publish', 'stash', 'stash-apply'] as const)
    assert.ok(gitActionProblem(action, group, { core: clean }), action);
  const dirty = { ...clean, files: [{ path: 'binary', index: '?', worktree: '?' }] };
  assert.equal(gitActionProblem('commit', group, { core: dirty }), '');
  assert.equal(gitActionProblem('stash', group, { core: dirty }), '');
  assert.equal(gitActionProblem('publish', group, { core: dirty }), '');
  assert.match(gitActionProblem('push', group, { core: dirty }), /Commit or stash/);
  assert.match(gitActionProblem('pr', group, { core: dirty }), /Commit or stash/);
  const unpushed = { ...clean, prChanges: true, push: { ahead: 1, behind: 0 } };
  assert.equal(gitActionProblem('push', group, { core: unpushed }), '');
  assert.match(gitActionProblem('pr', group, { core: unpushed }), /Push/);
  const published = { ...clean, prChanges: true };
  assert.equal(gitActionProblem('pr', group, { core: published }), '');
  const operation: Operation = {
    id: 'pr',
    sessionId: 'session',
    repositoryId: 'core',
    phase: 'uncertain',
    commit: 'abc',
    url: 'https://example.test/1',
    evidence: { branch: 'refs/heads/task/example' },
  };
  assert.ok(gitActionProblem('pr', group, { core: published }, [operation]));
  assert.ok(gitActionProblem('publish', group, { core: published }, [operation]));
  assert.equal(
    gitActionProblem('pr', group, { core: published }, [{ ...operation, phase: 'reviewed' }]),
    '',
  );
  assert.match(
    gitActionProblem('publish', group, { core: { ...dirty, hasRemote: false } }),
    /remote/,
  );
});

test('batch actions skip clean siblings and restoration requires a clean destination', () => {
  const sibling = { ...repository, id: 'other', path: 'apps/other' };
  const dirty = { ...clean, files: [{ path: 'main.py', index: '.', worktree: 'M' }] };
  const statuses = { core: dirty, other: { ...clean, stash: 'saved' } };
  assert.deepEqual(repositoriesForAction('commit', [repository, sibling], statuses), [repository]);
  assert.deepEqual(repositoriesForAction('stash-apply', [repository, sibling], statuses), [
    sibling,
  ]);
  assert.ok(gitActionProblem('stash-apply', [repository, sibling], statuses));
  assert.equal(gitActionProblem('stash-apply', [sibling], statuses), '');
  assert.match(
    gitActionProblem('push', [repository], { core: { ...clean, push: { ahead: 1, behind: 1 } } }),
    /Pull/,
  );
});
