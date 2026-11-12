import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vcsRequests } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { ProjectService } from '../project/ProjectService';
import { LanguageServers } from '../python/LanguageServers';
import { GitService } from './GitService';
import { SourceControlService } from './SourceControlService';
import { git } from './gitCommand';
import { HostingService } from '../hosting/HostingService';
import { SourceControlDiscovery } from '../hosting/SourceControlDiscovery';
import { PullRequestService } from '../pullRequest/PullRequestService';
import { repository, session, temp } from '../../../../tests/fixtures';

async function fixture(wrapped = true) {
  const root = wrapped ? await repository() : await temp();
  await mkdir(join(root, 'apps'));
  const first = join(root, 'apps', 'first'),
    second = join(root, 'apps', 'second');
  await rename(await repository(), first);
  await rename(await repository(), second);
  if (wrapped) {
    await writeFile(join(root, '.gitignore'), 'apps/\n');
    await git(root, ['add', '.gitignore']);
    await git(root, ['commit', '-m', 'Ignore nested repositories']);
  }
  const store = new Store(await temp());
  const projects = new ProjectService(store, new LanguageServers(store, () => {}));
  const service = new SourceControlService(new GitService(store, () => {}), projects, store);
  const s = session(root);
  const repos = await service.repositories.list(s);
  const firstId = repos.find((r) => r.path === 'apps/first')!.id;
  const secondId = repos.find((r) => r.path === 'apps/second')!.id;
  const act = (
    repositoryId: string,
    action: 'commit' | 'push' | 'create-branch' | 'checkout' | 'stash' | 'stash-apply',
    extra: Record<string, unknown> = {},
  ) =>
    service.act(
      s,
      vcsRequests['git.act'].parse({
        sessionId: s.id,
        repositoryId,
        operationId: crypto.randomUUID(),
        action,
        ...extra,
      }),
    );
  return { root, first, second, s, store, service, projects, repos, firstId, secondId, act };
}

for (const wrapped of [true, false]) {
  test(`repository worktrees preserve sources and reopen as one context (${wrapped ? 'Git wrapper' : 'plain folder'})`, async () => {
    const f = await fixture(wrapped);
    try {
      const project = await f.projects.add(f.root);
      const source = (await f.projects.sessions(project.id))[0];
      const repositories = await f.service.repositories.list(source);
      const ids = repositories.filter((r) => r.path).map((r) => r.id);
      await git(f.second, ['switch', '-c', 'stage']);
      await writeFile(join(f.first, 'main.py'), 'keep original dirty file\n');
      f.store.draft({
        sessionId: source.id,
        path: 'apps/first/main.py',
        text: 'keep draft',
        hash: 'old',
        version: 1,
      });
      const created = await f.service.createWorktree(source, {
        sessionId: source.id,
        repositoryIds: ids,
        branch: 'task/worktree',
        base: 'HEAD',
      });
      for (const path of ['apps/first', 'apps/second']) {
        assert.equal(
          (await git(join(created.path, path), ['branch', '--show-current'])).trim(),
          'task/worktree',
        );
        assert.equal(
          (await git(join(f.root, path), ['branch', '--show-current'])).trim(),
          path === 'apps/second' ? 'stage' : 'main',
        );
      }
      assert.match(await readFile(join(f.first, 'main.py'), 'utf8'), /keep original/);
      f.projects.saveState(created, {
        sessionId: created.id,
        state: { active: 'apps/first/main.py' },
      });
      const reopened = (await f.projects.sessions(project.id)).find((s) => s.id === created.id);
      assert.equal(reopened?.branch, 'task/worktree');
      assert.equal(reopened?.state.active, 'apps/first/main.py');
      assert.equal((await f.service.repositories.list(reopened!)).filter((r) => r.path).length, 2);
      for (const r of (await f.service.repositories.list(reopened!)).filter((r) => r.path))
        assert.equal(
          (await f.service.status(reopened!, r.id)).baseBranch,
          r.path === 'apps/second' ? 'stage' : 'main',
        );
      if (wrapped) {
        const single = await f.projects.createWorktree(source, {
          sessionId: source.id,
          branch: 'task/root',
          base: 'HEAD',
        });
        assert.equal((await f.service.status(single)).baseBranch, 'main');
      }
      assert.notEqual(created.id, source.id);
    } finally {
      f.store.close();
    }
  });
}

test('worktree preflight rejects a conflicting branch without creating other branches', async () => {
  const f = await fixture();
  try {
    const project = await f.projects.add(f.root);
    const source = (await f.projects.sessions(project.id))[0];
    const ids = (await f.service.repositories.list(source)).filter((r) => r.path).map((r) => r.id);
    await git(f.second, ['branch', 'already-exists']);
    await assert.rejects(
      () =>
        f.service.createWorktree(source, {
          sessionId: source.id,
          repositoryIds: ids,
          branch: 'already-exists',
          base: 'HEAD',
        }),
      /already exists/,
    );
    assert.equal((await git(f.first, ['branch', '--list', 'already-exists'])).trim(), '');
    assert.equal((await f.projects.sessions(project.id)).length, 1);
    await assert.rejects(
      () =>
        f.service.createWorktree(source, {
          sessionId: source.id,
          repositoryIds: ['outside'],
          branch: 'safe',
          base: 'HEAD',
        }),
      /belong/,
    );
  } finally {
    f.store.close();
  }
});

test('a failing checkout hook rolls back newly created repository worktrees and branches', async () => {
  const f = await fixture();
  try {
    const project = await f.projects.add(f.root);
    const source = (await f.projects.sessions(project.id))[0];
    const ids = (await f.service.repositories.list(source)).filter((r) => r.path).map((r) => r.id);
    await writeFile(join(f.second, '.git/hooks/post-checkout'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });
    await assert.rejects(() =>
      f.service.createWorktree(source, {
        sessionId: source.id,
        repositoryIds: ids,
        branch: 'hook-failure',
        base: 'HEAD',
      }),
    );
    for (const path of [f.root, f.first, f.second]) {
      assert.equal(
        (await git(path, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm)?.length,
        1,
      );
      assert.equal((await git(path, ['branch', '--list', 'hook-failure'])).trim(), '');
      assert.equal(
        (
          await git(path, ['config', '--get', 'branch.hook-failure.gh-merge-base'], { accept: [1] })
        ).trim(),
        '',
      );
    }
    assert.equal((await f.projects.sessions(project.id)).length, 1);
  } finally {
    f.store.close();
  }
});

test('nested repositories are discovered independently of parent ignores, with worktree Git files and no symlink escapes', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      f.repos.map((r) => r.path),
      ['', 'apps/first', 'apps/second'],
    );
    for (const [url, provider] of [
      ['https://github.com/example/project.git', 'github'],
      ['git@github.com:example/project.git', 'github'],
      ['ssh://git@company.ghe.com/team/project.git', 'github'],
      ['ssh://git@gitlab.company.test:2222/team/project.git', 'gitlab'],
      ['https://gitlab.com/team/project.git', 'gitlab'],
      ['https://example.test/github.com/project.git', undefined],
      ['file:///tmp/github.com/project.git', undefined],
    ] as const) {
      await git(f.root, ['config', 'remote.origin.url', url]);
      const repos = await f.service.repositories.list(f.s, true);
      assert.equal(repos.find((r) => !r.path)!.provider, provider, url);
    }
    await git(f.root, ['config', 'remote.origin.url', 'https://github.com/example/project.git']);
    await git(f.root, [
      'config',
      'remote.origin.pushurl',
      'git@gitlab.company.test:team/project.git',
    ]);
    assert.equal(
      (await f.service.repositories.list(f.s, true)).find((r) => !r.path)!.provider,
      'gitlab',
    );
    await symlink(await repository(), join(f.root, 'apps', 'outside'));
    await mkdir(join(f.root, '.venv'));
    await rename(await repository(), join(f.root, '.venv', 'hidden'));
    await mkdir(join(f.root, 'apps', 'broken'));
    await writeFile(join(f.root, 'apps', 'broken', '.git'), 'gitdir: missing\n');
    const worktree = join(f.root, 'apps', 'linked');
    await git(f.first, ['worktree', 'add', '-b', 'linked', worktree]);
    const repos = await f.service.repositories.list(f.s, true);
    assert.deepEqual(
      repos.map((r) => r.path),
      ['', 'apps/broken', 'apps/first', 'apps/linked', 'apps/second'],
    );
    assert.equal(repos.find((r) => r.path === 'apps/broken')!.branch, 'Git unavailable');
    await assert.rejects(() =>
      f.service.status(f.s, repos.find((r) => r.path === 'apps/broken')!.id),
    );
    assert.equal(repos.find((r) => r.path === 'apps/first')!.id, f.firstId);
    assert.equal(
      (await f.service.repositories.target(f.s, repos.find((r) => r.path === 'apps/linked')!.id))
        .path,
      await realpath(worktree),
    );
    await assert.rejects(() => f.service.status(f.s, 'outside'), /does not belong/);
    await rename(f.first, join(f.root, 'old-first'));
    await symlink(await repository(), f.first);
    await assert.rejects(() => f.service.status(f.s, f.firstId), /outside the worktree/);
  } finally {
    f.store.close();
  }
});

test('repository status, diffs, commits and pushes stay in their destination session and repository', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.first, 'main.py'), 'first\nextra\n');
    await writeFile(join(f.second, 'main.py'), 'second\n');
    const [first, second] = await Promise.all([
      f.service.status(f.s, f.firstId),
      f.service.status(f.s, f.secondId),
    ]);
    assert.deepEqual(first.changes, { insertions: 2, deletions: 1 });
    assert.deepEqual(second.changes, { insertions: 1, deletions: 1 });
    assert.match(
      await f.service.diff(
        f.s,
        vcsRequests['git.diff'].parse({ sessionId: f.s.id, path: 'apps/first/main.py' }),
      ),
      /\+first/,
    );
    const parent = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
    const sibling = (await git(f.second, ['rev-parse', 'HEAD'])).trim();
    const saved = await f.act(f.secondId, 'stash');
    assert.equal(saved.phase, 'completed', saved.error ?? '');
    assert.equal(await git(f.second, ['diff']), '');
    assert.match(await git(f.first, ['diff']), /first/);
    assert.equal(
      (await f.act(f.secondId, 'stash-apply', { stash: saved.evidence.stash })).phase,
      'completed',
    );
    assert.match(await git(f.second, ['diff']), /second/);
    f.store.put('operations', {
      id: 'unresolved-sibling',
      sessionId: f.s.id,
      repositoryId: f.secondId,
      phase: 'uncertain',
      evidence: {},
    });
    const op = await f.act(f.firstId, 'commit', { message: 'First only', paths: ['main.py'] });
    assert.equal(op.phase, 'completed', op.error ?? '');
    assert.equal(op.sessionId, f.s.id);
    assert.equal(op.repositoryId, f.firstId);
    f.store.put('operations', { ...op, phase: 'committing', commit: undefined });
    await f.service.status(f.s, f.firstId);
    assert.equal(
      f.store.get<import('@superfluid/contracts').Operation>('operations', op.id)?.phase,
      'completed',
    );
    assert.equal(
      f.store.get<import('@superfluid/contracts').Operation>('operations', 'unresolved-sibling')
        ?.phase,
      'uncertain',
    );
    assert.equal((await git(f.root, ['rev-parse', 'HEAD'])).trim(), parent);
    assert.equal((await git(f.second, ['rev-parse', 'HEAD'])).trim(), sibling);
    assert.match((await f.service.inspect(f.s, op.id)).log, /First only/);
    f.store.put('operations', {
      id: 'unresolved-root',
      sessionId: f.s.id,
      phase: 'uncertain',
      evidence: {},
    });
    await assert.rejects(
      () => f.act(f.repos.find((r) => !r.path)!.id, 'commit', { message: 'Root' }),
      /Review the result to continue/,
    );
    await assert.rejects(
      () => f.service.status({ ...f.s, id: 'inactive-session' }, f.firstId),
      /does not belong/,
    );
    const remote = await temp();
    await git(remote, ['init', '--bare']);
    await git(f.first, ['remote', 'add', 'origin', remote]);
    assert.equal((await f.act(f.firstId, 'push')).phase, 'completed');
    assert.equal((await git(remote, ['rev-parse', 'refs/heads/main'])).trim(), op.commit);
    await assert.rejects(
      () => f.act(f.firstId, 'commit', { message: 'Escape', paths: ['../second/main.py'] }),
      /outside the worktree/,
    );
  } finally {
    f.store.close();
  }
});

test('editor Git bases use the destination repository index, including untracked and linked worktrees', async () => {
  const f = await fixture();
  try {
    const base = (path: string, repositoryId?: string) =>
      f.service.index(f.s, { sessionId: f.s.id, path, repositoryId });
    assert.equal(await base('apps/first/main.py'), 'print("initial")\n');
    await writeFile(join(f.first, 'main.py'), 'staged\n');
    await git(f.first, ['add', 'main.py']);
    await writeFile(join(f.first, 'main.py'), 'unstaged\n');
    assert.equal(await base('apps/first/main.py'), 'staged\n');
    assert.equal(await base('main.py', f.secondId), 'print("initial")\n');
    await writeFile(join(f.first, 'new[1].py'), 'new\n');
    assert.equal(await base('apps/first/new[1].py'), '');
    await git(f.first, ['add', '--', 'new[1].py']);
    assert.equal(await base('apps/first/new[1].py'), 'new\n');
    await git(f.first, ['mv', 'new[1].py', 'renamed.py']);
    assert.equal(await base('apps/first/renamed.py'), 'new\n');
    assert.equal(await base('apps/first/new[1].py'), '');
    await writeFile(join(f.first, '.gitignore'), 'ignored.py\n');
    await writeFile(join(f.first, 'ignored.py'), 'ignored\n');
    assert.equal(await base('apps/first/ignored.py'), null);
    await writeFile(join(f.first, 'binary'), Buffer.from([0, 1, 2]));
    await git(f.first, ['add', 'binary']);
    assert.equal(await base('apps/first/binary'), null);
    const unborn = await temp();
    await git(unborn, ['init', '-b', 'main']);
    await writeFile(join(unborn, 'first.py'), 'before first commit\n');
    await git(unborn, ['add', 'first.py']);
    assert.equal(
      await f.service.index(session(unborn), { sessionId: 'test', path: 'first.py' }),
      'before first commit\n',
    );
    const linked = await temp();
    await git(f.first, ['worktree', 'add', '-b', 'editor-base', linked]);
    await writeFile(join(linked, 'main.py'), 'linked index\n');
    await git(linked, ['add', 'main.py']);
    const destination = session(linked);
    assert.equal(
      await f.service.index(destination, { sessionId: destination.id, path: 'main.py' }),
      'linked index\n',
    );
    assert.equal(await base('apps/first/main.py'), 'staged\n');
    await git(f.first, ['reset', '--', 'main.py']);
    assert.equal(await base('apps/first/main.py'), 'print("initial")\n');
    await assert.rejects(() => base('../outside.py'), /outside the worktree/);
    await assert.rejects(() => base('main.py', 'outside'), /does not belong/);
  } finally {
    f.store.close();
  }
});

test('branch operations carry dirty files, preserve drafts, and replay without switching again', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.second, 'main.py'), 'keep dirty\n');
    const input = vcsRequests['git.act'].parse({
      sessionId: f.s.id,
      repositoryId: f.firstId,
      operationId: 'create-first',
      action: 'create-branch',
      branch: 'task/example',
      base: 'HEAD',
    });
    assert.equal((await f.service.act(f.s, input)).phase, 'completed');
    const switched = await f.act(f.secondId, 'create-branch', {
      branch: 'task/example',
      base: 'HEAD',
    });
    assert.equal(switched.phase, 'completed', switched.error ?? '');
    assert.equal((await git(f.second, ['branch', '--show-current'])).trim(), 'task/example');
    assert.equal(await readFile(join(f.second, 'main.py'), 'utf8'), 'keep dirty\n');
    assert.equal((await git(f.root, ['branch', '--show-current'])).trim(), 'main');
    await git(f.first, ['switch', 'main']);
    assert.equal((await f.service.act(f.s, input)).phase, 'completed');
    assert.equal((await git(f.first, ['branch', '--show-current'])).trim(), 'main');
    f.store.draft({
      sessionId: f.s.id,
      path: 'apps/first/main.py',
      text: 'unsaved',
      hash: 'old',
      version: 1,
    });
    await assert.rejects(
      () => f.act(f.firstId, 'checkout', { branch: 'task/example' }),
      /unsaved recovery/,
    );
    await assert.rejects(() => f.act(f.firstId, 'stash'), /unsaved recovery/);
    f.store.dropDraft(f.s.id, 'apps/first/main.py', 1);
    f.store.draft({
      sessionId: f.s.id,
      path: 'apps/second/main.py',
      text: 'sibling draft',
      hash: 'old',
      version: 1,
    });
    assert.equal(
      (await f.act(f.firstId, 'checkout', { branch: 'task/example' })).phase,
      'completed',
    );
    assert.equal((await git(f.first, ['branch', '--show-current'])).trim(), 'task/example');
  } finally {
    f.store.close();
  }
});

test('hosting adapters and remote choices stay scoped to each nested repository and survive reopening', async () => {
  const f = await fixture();
  try {
    await git(f.root, ['remote', 'add', 'origin', 'https://github.com/root/wrapper.git']);
    await git(f.first, ['remote', 'add', 'origin', 'https://github.com/team/first.git']);
    await git(f.second, ['remote', 'add', 'origin', 'git@gitlab.company.test:team/second.git']);
    await git(f.second, ['remote', 'add', 'work', 'git@gitlab.company.test:upstream/second.git']);
    const project = await f.projects.add(f.root);
    f.store.put('projects', {
      ...project,
      hosting: {
        provider: 'github',
        host: 'github.com',
        remote: 'origin',
        sourceProject: 'root/wrapper',
        targetProject: 'root/wrapper',
      },
    });
    const source = (await f.projects.sessions(project.id))[0];
    const repositories = await f.service.repositories.list(source);
    const first = await f.service.repositories.target(
      source,
      repositories.find((r) => r.path === 'apps/first')!.id,
    );
    const secondId = repositories.find((r) => r.path === 'apps/second')!.id;
    const second = await f.service.repositories.target(source, secondId);
    const discovery = new SourceControlDiscovery(f.root, async (cli, args) =>
      args[0] === '--version'
        ? `${cli === 'git' ? 'git version' : cli === 'gh' ? 'gh version' : 'glab'} 1.2.3`
        : cli === 'glab'
          ? '{"hosts":[{"host":"gitlab.company.test","user":"developer","state":"success"}]}'
          : '{"hosts":{}}',
    );
    const calls: { cli: string; cwd: string }[] = [];
    const hosting = new HostingService(
      f.store,
      async (cli, _args, target) => {
        calls.push({ cli, cwd: target.cwd });
        return cli === 'gh'
          ? '{"defaultBranchRef":{"name":"main"}}'
          : '{"id":1,"default_branch":"develop"}';
      },
      discovery,
    );
    await f.projects.setRemote(
      source,
      { sessionId: source.id, repositoryId: secondId, remote: 'work' },
      second,
    );
    assert.equal((await hosting.context(first)).sourceProject, 'team/first');
    const context = await hosting.context(second);
    assert.equal(context.provider, 'gitlab');
    assert.equal(context.sourceProject, 'upstream/second');
    assert.equal((await hosting.context(source)).sourceProject, 'root/wrapper');
    assert.ok(calls.some((call) => call.cli === 'gh' && call.cwd === first.path));
    assert.ok(calls.some((call) => call.cli === 'glab' && call.cwd === second.path));
    await assert.rejects(
      () =>
        new PullRequestService(hosting).patch(second, {
          sessionId: source.id,
          repositoryId: secondId,
          ref: { provider: 'github', host: 'github.com', project: 'team/first', number: 1 },
        }),
      /another repository/,
    );
    f.store.close();
    const reopened = new Store(f.store.directory);
    try {
      const restored = new HostingService(reopened);
      assert.equal((await restored.remotes(second)).selected, 'work');
      assert.equal((await restored.remotes(first)).selected, 'origin');
      assert.equal((await restored.remotes(source)).selected, 'origin');
    } finally {
      reopened.close();
    }
  } finally {
    if (f.store.db.isOpen) f.store.close();
  }
});
