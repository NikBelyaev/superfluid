import assert from 'node:assert/strict';
import { test } from 'node:test';
import { treeGit } from './treeGit';

test('colors Git states and marks ancestor folders without confusing path prefixes', () => {
  const git = treeGit([
    { path: 'src/app.py', index: '.', worktree: 'M' },
    { path: 'new/file.py', index: 'A', worktree: '.' },
    { path: 'unknown/', index: '?', worktree: '?' },
    { path: 'deleted.py', index: 'D', worktree: '.' },
    { path: 'conflict.py', index: 'A', worktree: 'A' },
    { path: 'dst/moved.py', original: 'old/deep/file.py', index: 'R', worktree: '.' },
    { path: 'cache/ignored.py', index: '!', worktree: '!' },
  ]);
  assert.deepEqual(
    [...git.statuses.values()],
    ['modified', 'added', 'untracked', 'deleted', 'conflict', 'renamed', 'ignored'],
  );
  assert.deepEqual([...git.directories].sort(), [
    '',
    'dst',
    'new',
    'old',
    'old/deep',
    'src',
    'unknown',
  ]);
  assert.equal(git.directories.has('s'), false);
  assert.equal(git.getStatus('unknown/deep/file.py'), 'untracked');
  assert.equal(git.getStatus('new/file.py'), 'added');
  assert.equal(git.getStatus('src/clean.py'), undefined);
  assert.deepEqual(treeGit().directories, new Set());
});
