import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppEvent } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { LanguageServers } from '../python/LanguageServers';
import { WorkspaceWatcher } from './WorkspaceWatcher';
import { git } from '../vcs/gitCommand';
import { repository, session, temp } from '../../../../tests/fixtures';

test('linked worktree index changes notify their owning session without a working-file event', async () => {
  const root = await repository();
  const linked = await temp();
  await git(root, ['worktree', 'add', '-b', 'markers', linked]);
  await writeFile(join(linked, 'main.py'), 'stage this\n');
  const s = {
    ...session(linked),
    id: 'linked',
    gitDir: (await git(linked, ['rev-parse', '--absolute-git-dir'])).trim(),
  };
  const store = new Store(await temp());
  const lsp = new LanguageServers(store, () => {});
  let resolveChanged!: (event: AppEvent) => void;
  const changed = new Promise<AppEvent>((resolve) => {
    resolveChanged = resolve;
  });
  const watcher = new WorkspaceWatcher(lsp, resolveChanged);
  try {
    await watcher.observeGit(s, s.gitDir);
    await git(linked, ['add', 'main.py']);
    assert.deepEqual(await changed, { type: 'files.changed', sessionId: s.id });
  } finally {
    watcher.close();
    lsp.close();
    store.close();
  }
});
