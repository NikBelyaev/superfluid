import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { within } from '../files/paths';
import { Store } from '../persistence/Store';
import { GitService, parseStatus } from './GitService';
import { git } from './gitCommand';
import { HostingService } from '../hosting/HostingService';
import { githubRequest } from '../../../../tests/hostingFixtures';
import { temp, session, repository } from '../../../../tests/fixtures';

test('porcelain parsing preserves whitespace and rename paths', () => {
  const result = parseStatus(
    '# branch.oid abc\0# branch.head main\0# branch.ab +2 -1\0' +
      '1 .M N... 100644 100644 100644 aaa bbb folder/odd name\n.py\0' +
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.py\0old.py\0? brand new.py\0',
  );
  assert.equal(result.branch, 'main');
  assert.equal(result.ahead, 2);
  assert.equal(result.files[0].path, 'folder/odd name\n.py');
  assert.equal(result.files[1].original, 'old.py');
  assert.equal(result.files[2].path, 'brand new.py');
});

test('status groups untracked directories and counts staged, unstaged and loose untracked lines', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {}),
    s = session(root);
  try {
    await writeFile(join(root, 'main.py'), 'staged\n');
    await git(root, ['add', 'main.py']);
    await writeFile(join(root, 'main.py'), 'working\nextra\n');
    await mkdir(join(root, 'new'));
    await writeFile(join(root, 'odd\tname\n.py'), 'one\ntwo');
    await writeFile(join(root, 'new', 'generated.py'), 'not\ncounted\nrecursively\n');
    await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2, 10]));
    const status = await service.status(s);
    assert.deepEqual(
      status.files.filter((file) => file.path.startsWith('new/')),
      [{ path: 'new/', index: '?', worktree: '?' }],
    );
    assert.deepEqual(status.changes, { insertions: 4, deletions: 1 });
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'Save changes']);
    assert.deepEqual((await service.status(s)).changes, { insertions: 0, deletions: 0 });
    assert.deepEqual((await service.status({ ...s, gitDir: '' })).changes, {
      insertions: 0,
      deletions: 0,
    });
  } finally {
    store.close();
  }
});

test('branch bases follow creation, persist through checkout, and respect explicit GitHub configuration', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {}),
    s = session(root);
  try {
    await git(root, ['switch', '-c', 'stage']);
    const created = await service.act(s, {
      sessionId: s.id,
      operationId: 'branch-base',
      action: 'create-branch',
      branch: 'task/from-stage',
      base: 'HEAD',
    });
    assert.equal(created.phase, 'completed', created.error ?? '');
    assert.equal((await service.status(s)).baseBranch, 'stage');
    assert.equal((await service.status(s)).prChanges, false);
    await writeFile(join(root, 'main.py'), 'task changes\n');
    await git(root, ['commit', '-am', 'Task changes']);
    assert.equal((await service.status(s)).prChanges, true);
    await git(root, ['switch', 'main']);
    assert.equal((await service.status(s)).baseBranch, undefined);
    await git(root, ['switch', 'task/from-stage']);
    assert.equal((await service.status(s)).baseBranch, 'stage');
    await git(root, ['switch', '-c', 'external', 'main']);
    assert.equal((await service.status(s)).baseBranch, 'main');
    await git(root, ['config', 'branch.external.gh-merge-base', 'stage']);
    assert.equal((await service.status(s)).baseBranch, 'stage');
    await git(root, ['switch', '-c', 'unknown', (await git(root, ['rev-parse', 'HEAD'])).trim()]);
    assert.equal((await service.status(s)).baseBranch, undefined);
  } finally {
    store.close();
  }
});

test('publication uses a verified commit and explicit destination ref', async () => {
  const root = await repository(),
    remote = await temp();
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'work', remote]);
  const store = new Store(await temp()),
    events: any[] = [],
    service = new GitService(store, (o) => events.push(structuredClone(o)));
  const s = session(root);
  try {
    await writeFile(join(root, 'removed.py'), 'old\n');
    await git(root, ['add', 'removed.py']);
    await git(root, ['commit', '-m', 'File to remove']);
    await git(root, ['rm', 'removed.py']);
    await writeFile(join(root, 'main.py'), 'print("modified")\n');
    await writeFile(join(root, 'added.py'), 'print("new")\n');
    await mkdir(join(root, 'new'));
    await writeFile(join(root, 'new', 'task.py'), 'print("task")\n');
    await rename(await repository(), join(root, 'nested'));
    assert.ok((await service.status(s)).files.some((file) => file.path === 'new/'));
    const op = await service.act(s, {
      sessionId: s.id,
      operationId: 'commit-1',
      action: 'commit',
      message: 'Change',
      allChanges: true,
    });
    assert.equal(op.phase, 'completed');
    assert.ok(op.commit);
    assert.equal(await git(root, ['show', `${op.commit}:added.py`]), 'print("new")\n');
    assert.equal(await git(root, ['show', `${op.commit}:new/task.py`]), 'print("task")\n');
    assert.equal(await git(root, ['ls-tree', 'HEAD', 'nested']), '');
    await writeFile(join(root, 'later.py'), 'print("later")\n');
    const again = await service.act(s, {
      sessionId: s.id,
      operationId: 'commit-1',
      action: 'commit',
      message: 'Change',
      allChanges: true,
    });
    assert.equal(again.commit, op.commit);
    assert.equal(await git(root, ['diff', '--cached', '--name-only']), '');
    const unchanged = await service.act(s, {
      sessionId: s.id,
      operationId: 'unchanged',
      action: 'commit',
      message: 'No changes',
    });
    assert.equal(unchanged.phase, 'completed');
    assert.equal(unchanged.evidence.skipped, true);
    const push = await service.act(s, { sessionId: s.id, operationId: 'push-1', action: 'push' });
    assert.equal(push.phase, 'completed');
    assert.equal((await git(remote, ['rev-parse', 'refs/heads/main'])).trim(), op.commit);
    assert.equal((await service.status(s)).upstream, 'work/main');
    assert.deepEqual((await service.status(s)).push, { ahead: 0, behind: 0 });
    assert.deepEqual((await service.status(s)).outgoing, { insertions: 0, deletions: 0 });
    assert.ok(events.some((e) => e.phase === 'committing'));
  } finally {
    store.close();
  }
});

test('a first local commit needs no Git remote', async () => {
  const root = await temp();
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Superfluid Test']);
  await git(root, ['config', 'user.email', 'test@superfluid.invalid']);
  await writeFile(join(root, 'first.py'), 'print(1)\n');
  const store = new Store(await temp());
  try {
    const service = new GitService(store, () => {});
    await git(root, ['add', '.']);
    assert.deepEqual((await service.status(session(root))).changes, {
      insertions: 1,
      deletions: 0,
    });
    const op = await service.act(session(root), {
      sessionId: 'test',
      operationId: 'initial',
      action: 'commit',
      message: 'First',
      paths: ['first.py'],
    });
    assert.equal(op.phase, 'completed', op.error ?? '');
    assert.equal((await git(root, ['rev-list', '--count', 'HEAD'])).trim(), '1');
  } finally {
    store.close();
  }
});

test('committing all changes preserves unresolved merge conflicts', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {}),
    s = session(root);
  try {
    await git(root, ['switch', '-c', 'incoming']);
    await writeFile(join(root, 'main.py'), 'incoming\n');
    await git(root, ['commit', '-am', 'Incoming']);
    await git(root, ['switch', 'main']);
    await writeFile(join(root, 'main.py'), 'current\n');
    await git(root, ['commit', '-am', 'Current']);
    const head = await git(root, ['rev-parse', 'HEAD']);
    await git(root, ['merge', 'incoming'], { accept: [1] });
    const conflicts = await git(root, ['ls-files', '--unmerged', '-z']);
    assert.ok(conflicts);
    const stash = await service.act(s, {
      sessionId: s.id,
      operationId: 'stash-unresolved',
      action: 'stash',
    });
    assert.equal(stash.phase, 'failed');
    assert.match(stash.error || '', /merge conflicts/);
    const result = await service.act(s, {
      sessionId: s.id,
      operationId: 'unresolved-merge',
      action: 'commit',
      message: 'Do not commit conflict markers',
      allChanges: true,
    });
    assert.equal(result.phase, 'failed');
    assert.match(result.error || '', /merge conflicts/i);
    assert.equal(await git(root, ['rev-parse', 'HEAD']), head);
    assert.equal(await git(root, ['ls-files', '--unmerged', '-z']), conflicts);
  } finally {
    store.close();
  }
});

test('diffs include untracked files and files whose parent directory was deleted', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {});
  try {
    await writeFile(join(root, 'new.py'), 'new value\n');
    assert.match(await service.diff(session(root), 'new.py', 'unstaged', 'HEAD'), /\+new value/);
    await mkdir(join(root, 'removed'));
    await writeFile(join(root, 'removed', 'old.py'), 'old value\n');
    await assert.rejects(
      () => service.diff(session(root), 'removed/', 'unstaged', 'HEAD'),
      /Open individual files from the project tree/,
    );
    assert.match(
      await service.diff(session(root), 'removed/old.py', 'unstaged', 'HEAD'),
      /\+old value/,
    );
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'More files']);
    await import('node:fs/promises').then((fs) =>
      fs.rm(join(root, 'removed'), { recursive: true }),
    );
    await within(root, 'removed/old.py', true);
    assert.match(
      await service.diff(session(root), 'removed/old.py', 'unstaged', 'HEAD'),
      /-old value/,
    );
  } finally {
    store.close();
  }
});

test('publish pipeline creates one request per operation for GitHub and GitLab', async () => {
  for (const provider of ['github', 'gitlab'] as const) {
    const root = await repository(),
      remote = await temp(),
      store = new Store(await temp());
    await git(remote, ['init', '--bare']);
    await git(root, ['remote', 'add', 'origin', remote]);
    store.put('projects', {
      id: 'project',
      name: 'Fixture',
      path: root,
      lastOpened: 0,
      hosting: {
        provider,
        host: provider === 'github' ? 'github.com' : 'gitlab.example.test',
        remote: 'origin',
        sourceProject: 'superfluid-tests/fluid-lab',
        targetProject: 'superfluid-tests/fluid-lab',
      },
    });
    let creates = 0;
    const titles: string[] = [];
    const hosting = new HostingService(store, async (_file, args) => {
      if (args[0] === 'repo')
        return provider === 'github'
          ? '{"defaultBranchRef":{"name":"main"}}'
          : '{"default_branch":"main","id":11}';
      if (args[1] === 'list') return '[]';
      if (args[1] === 'create') {
        creates++;
        titles.push(args[args.indexOf('--title') + 1]);
        return provider === 'github'
          ? githubRequest.url
          : 'https://gitlab.example.test/superfluid-tests/fluid-lab/-/merge_requests/42';
      }
      const sha = (await git(root, ['rev-parse', 'HEAD'])).trim();
      return JSON.stringify(
        provider === 'github'
          ? { ...githubRequest, headRefOid: sha }
          : {
              iid: 42,
              title: 'Fixture',
              description: '',
              state: 'opened',
              web_url: 'https://gitlab.example.test/superfluid-tests/fluid-lab/-/merge_requests/42',
              author: null,
              source_branch: 'main',
              target_branch: 'main',
              sha,
              updated_at: '2026-11-07',
              source_project_id: 11,
            },
      );
    });
    try {
      await writeFile(join(root, 'main.py'), 'print("published")\n');
      const service = new GitService(store, () => {}, hosting);
      const input = {
        sessionId: 'test',
        operationId: 'publish',
        action: 'publish' as const,
        message: 'Publish title\n\nCommit details',
        paths: ['main.py'],
        body: 'A multiline\nbody',
      };
      const op = await service.act(session(root), input);
      assert.equal(op.phase, 'completed', op.error ?? '');
      assert.equal(op.pullRequest?.provider, provider);
      assert.equal((await git(remote, ['rev-parse', 'refs/heads/main'])).trim(), op.commit);
      await service.act(session(root), input);
      assert.equal(creates, 1);
      const separate = await service.act(session(root), {
        sessionId: 'test',
        operationId: 'separate-pr',
        action: 'pr',
      });
      assert.equal(separate.phase, 'completed', separate.error ?? '');
      assert.deepEqual(titles, ['Publish title', 'Publish title']);
      for (const message of ['', 'Already committed']) {
        const clean = await service.act(session(root), {
          sessionId: 'test',
          operationId: `clean-${message}`,
          action: 'publish',
          allChanges: true,
          message,
        });
        assert.equal(clean.phase, 'completed', clean.error ?? '');
        assert.equal(clean.commit, op.commit);
      }
      const changed = await service.act(session(root), {
        sessionId: 'test',
        operationId: 'changed-compare',
        action: 'pr',
        branch: 'another-branch',
      });
      assert.equal(changed.phase, 'failed');
      assert.match(changed.error || '', /branch changed/);
    } finally {
      store.close();
    }
  }
});

test('a post-commit ref change stops publication without resetting the branch', async () => {
  const root = await repository();
  await git(root, ['branch', 'other']);
  const remote = await temp();
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  await writeFile(
    join(root, '.git', 'hooks', 'post-commit'),
    '#!/bin/sh\ngit symbolic-ref HEAD refs/heads/other\n',
    { mode: 0o755 },
  );
  await writeFile(join(root, 'main.py'), 'changed\n');
  const store = new Store(await temp());
  try {
    store.put('projects', {
      id: 'project',
      name: 'Fixture',
      path: root,
      lastOpened: 0,
      hosting: {
        provider: 'github',
        host: 'github.com',
        remote: 'origin',
        sourceProject: 'superfluid-tests/fluid-lab',
        targetProject: 'superfluid-tests/fluid-lab',
      },
    });
    const hosting = new HostingService(store, async () => '{"defaultBranchRef":{"name":"main"}}');
    const op = await new GitService(store, () => {}, hosting).act(session(root), {
      sessionId: 'test',
      operationId: 'race',
      action: 'publish',
      message: 'Change',
      paths: ['main.py'],
    });
    assert.equal(op.phase, 'needs-review');
    assert.equal((await git(root, ['branch', '--show-current'])).trim(), 'other');
    assert.equal((await git(remote, ['show-ref'], { accept: [1] })).trim(), '');
  } finally {
    store.close();
  }
});

test('stash preserves staged and new files, pins restoration, and retains recovery data on conflicts', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {}),
    s = session(root);
  try {
    const nested = join(root, 'nested');
    await rename(await repository(), nested);
    const nestedHead = await git(nested, ['rev-parse', 'HEAD']);
    await writeFile(join(root, 'removed.py'), 'remove me\n');
    await git(root, ['add', 'removed.py']);
    await git(root, ['commit', '-m', 'Tracked deletion fixture']);
    await git(root, ['rm', 'removed.py']);
    await writeFile(join(root, 'main.py'), 'staged\n');
    await git(root, ['add', 'main.py']);
    await writeFile(join(root, 'main.py'), 'working\n');
    await writeFile(join(root, 'new.py'), 'new\n');
    const staged = await git(root, ['diff', '--cached']);
    const request = { sessionId: s.id, operationId: 'stash-1', action: 'stash' as const };
    const saved = await service.act(s, request);
    assert.equal(saved.phase, 'completed', saved.error ?? '');
    const oid = String(saved.evidence.stash);
    assert.equal((await service.status(s)).stash, oid);
    assert.deepEqual((await service.status(s)).files, [
      { path: 'nested/', index: '?', worktree: '?' },
    ]);
    assert.equal(await git(nested, ['rev-parse', 'HEAD']), nestedHead);
    await service.act(s, request);
    assert.equal((await git(root, ['stash', 'list'])).trim().split('\n').length, 1);
    await writeFile(join(root, 'main.py'), 'other changes\n');
    const other = await service.act(s, { ...request, operationId: 'stash-2' });
    assert.equal(other.phase, 'completed', other.error ?? '');
    const restore = {
      sessionId: s.id,
      operationId: 'apply-1',
      action: 'stash-apply' as const,
      stash: oid,
    };
    assert.equal((await service.act(s, restore)).phase, 'completed');
    assert.equal(await readFile(join(root, 'main.py'), 'utf8'), 'working\n');
    assert.equal(await readFile(join(root, 'new.py'), 'utf8'), 'new\n');
    assert.equal(await git(root, ['diff', '--cached']), staged);
    assert.equal((await service.status(s)).stash, other.evidence.stash);
    assert.equal((await service.act(s, restore)).phase, 'completed');
    const dirty = await service.act(s, { ...restore, operationId: 'apply-dirty' });
    assert.equal(dirty.phase, 'failed');
    assert.match(dirty.error || '', /local changes/);
    await git(root, ['stash', 'push', '-u']);
    await writeFile(join(root, 'main.py'), 'conflicting base\n');
    await git(root, ['commit', '-am', 'Conflicting base']);
    const conflict = await service.act(s, { ...restore, operationId: 'apply-conflict' });
    assert.equal(conflict.phase, 'uncertain');
    assert.equal(await readFile(join(root, 'main.py'), 'utf8'), 'conflicting base\n');
    assert.match((await service.inspect(s, conflict.id)).log, new RegExp(oid));
    assert.ok((await git(root, ['stash', 'list', '--format=%H'])).includes(oid));
  } finally {
    store.close();
  }
});

test('an uncertain Git result blocks a fresh operation ID until explicitly reviewed', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    service = new GitService(store, () => {}),
    s = session(root);
  try {
    store.put('operations', { id: 'unknown', sessionId: s.id, phase: 'uncertain', evidence: {} });
    await assert.rejects(
      () =>
        service.act(s, {
          sessionId: s.id,
          operationId: 'another',
          action: 'commit',
          message: 'Duplicate',
        }),
      /previous Git operation/,
    );
    assert.equal(service.acknowledge(s, 'unknown').phase, 'reviewed');
    assert.equal(store.get<any>('operations', 'unknown').evidence.previousPhase, 'uncertain');
  } finally {
    store.close();
  }
});

test('hosting preflight stops before commit and uncertain creation preserves its link', async () => {
  const root = await repository(),
    remote = await temp(),
    store = new Store(await temp());
  await git(remote, ['init', '--bare']);
  await git(root, ['remote', 'add', 'origin', remote]);
  store.put('projects', {
    id: 'project',
    name: 'Fixture',
    path: root,
    lastOpened: 0,
    hosting: {
      provider: 'gitlab',
      host: 'gitlab.example.test',
      remote: 'origin',
      sourceProject: 'platform/editor',
      targetProject: 'platform/editor',
    },
  });
  let authenticated = false;
  const hosting = new HostingService(store, async (_file, args) => {
    if (!authenticated) throw new Error('Sign in to GitLab.');
    if (args[0] === 'repo') return '{"default_branch":"main","id":11}';
    if (args[1] === 'list') return '[]';
    if (args[1] === 'create')
      return 'https://gitlab.example.test/platform/editor/-/merge_requests/42';
    throw new Error('Connection lost after creation.');
  });
  try {
    const service = new GitService(store, () => {}, hosting);
    const initial = (await git(root, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(root, 'main.py'), 'changed\n');
    const failed = await service.act(session(root), {
      sessionId: 'test',
      operationId: 'preflight',
      action: 'publish',
      base: 'main',
      message: 'Change',
      paths: ['main.py'],
    });
    assert.equal(failed.phase, 'failed');
    assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), initial);
    assert.equal((await git(root, ['diff', '--cached', '--name-only'])).trim(), '');
    authenticated = true;
    const context = await hosting.context(session(root));
    const changedTarget = await service.act(session(root), {
      sessionId: 'test',
      operationId: 'changed-target',
      action: 'publish',
      message: 'Change',
      paths: ['main.py'],
      targetProject: 'other/editor',
      hostingRevision: context.revision,
    });
    assert.equal(changedTarget.phase, 'failed');
    assert.match(changedTarget.error ?? '', /hosting target changed/);
    assert.equal((await git(root, ['rev-parse', 'HEAD'])).trim(), initial);
    const uncertain = await service.act(session(root), {
      sessionId: 'test',
      operationId: 'created',
      action: 'publish',
      message: 'Change',
      paths: ['main.py'],
    });
    assert.equal(uncertain.phase, 'uncertain');
    assert.equal(uncertain.pullRequest?.number, 42);
    assert.equal(uncertain.url, 'https://gitlab.example.test/platform/editor/-/merge_requests/42');
  } finally {
    store.close();
  }
});
