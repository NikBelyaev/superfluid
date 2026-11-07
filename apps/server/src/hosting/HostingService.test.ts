import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../persistence/Store';
import { HostingService, remoteRepository } from './HostingService';
import { SourceControlDiscovery } from './SourceControlDiscovery';
import { PullRequestService } from '../pullRequest/PullRequestService';
import { repository, session, temp } from '../../../../tests/fixtures';
import { gitlabRequest } from '../../../../tests/hostingFixtures';
import { git } from '../vcs/gitCommand';
import type { HostingBinding } from '@superfluid/contracts';

test('an authenticated self-hosted remote needs no repository binding and defaults to its fork parent', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    s = session(root);
  await git(root, ['remote', 'add', 'origin', 'git@gitlab.example.test:people/fluid/editor.git']);
  let scans = 0;
  const discovery = new SourceControlDiscovery(root, async (file, args) => {
    if (args[0] === '--version')
      return `${file === 'git' ? 'git version' : file === 'gh' ? 'gh version' : 'glab'} 1.2.3`;
    scans++;
    return file === 'glab'
      ? JSON.stringify({
          hosts: [{ host: 'gitlab.example.test', user: 'fluid-dev', state: 'success' }],
        })
      : '{"hosts":{}}';
  });
  const calls: string[][] = [];
  const hosting = new HostingService(
    store,
    async (_file, args) => {
      calls.push(args);
      return args[2].endsWith('/people/fluid/editor')
        ? '{"default_branch":"main","forked_from_project":{"path_with_namespace":"platform/editor"}}'
        : '{"default_branch":"develop"}';
    },
    discovery,
  );
  try {
    const context = await hosting.context(s);
    assert.equal(context.provider, 'gitlab');
    assert.equal(context.host, 'gitlab.example.test');
    assert.equal(context.sourceProject, 'people/fluid/editor');
    assert.equal(context.targetProject, 'platform/editor');
    assert.equal(context.defaultBranch, 'develop');
    const overridden = await hosting.context(s, 'people/fluid/editor');
    assert.equal(overridden.defaultBranch, 'main');
    assert.notEqual(context.revision, overridden.revision);
    assert.equal(scans, 2);
    assert.ok(calls.every((args) => args[0] === 'repo'));
    assert.equal(store.get('projects', s.projectId), undefined);
    const requests = calls.length;
    await git(root, ['remote', 'set-url', 'origin', 'git@unknown.example.test:team/editor.git']);
    await assert.rejects(
      () => hosting.context(s),
      /glab auth login --hostname unknown.example.test/,
    );
    assert.equal(calls.length, requests);
  } finally {
    store.close();
  }
});

test('remote selection uses Git push settings and requires a choice for ambiguous names', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    s = session(root);
  const service = new HostingService(store);
  try {
    await git(root, ['remote', 'add', 'first', 'https://github.com/team/first.git']);
    assert.equal((await service.remotes(s)).selected, 'first');
    await git(root, ['remote', 'add', 'second', 'https://github.com/team/second.git']);
    assert.equal((await service.remotes(s)).selected, null);
    await assert.rejects(() => service.resolve(s), /Choose a Git remote/);
    await git(root, ['config', 'remote.pushDefault', 'second']);
    assert.equal((await service.remotes(s)).selected, 'second');
    await git(root, ['config', 'branch.main.pushRemote', 'first']);
    assert.equal((await service.remotes(s)).selected, 'first');
  } finally {
    store.close();
  }
});

test('hosting remote parsing preserves HTTP ports and nested namespaces', () => {
  for (const [remote, expected] of [
    [
      'https://gitlab.example.test:8443/group/sub/repo.git',
      { host: 'gitlab.example.test:8443', project: 'group/sub/repo' },
    ],
    [
      'git@ssh.example.test:group/sub/repo.git',
      { host: 'ssh.example.test', project: 'group/sub/repo' },
    ],
    [
      'ssh://git@ssh.example.test:2222/group/sub/repo.git',
      { host: 'ssh.example.test', project: 'group/sub/repo' },
    ],
  ] as const)
    assert.deepEqual(remoteRepository(remote), expected);
  assert.throws(() => remoteRepository('https://token@gitlab.example.test/group/repo'));
});

test('setup inspects the selected remote without a hosting CLI or credentials', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    s = session(root);
  const service = new HostingService(
    store,
    async () => {
      throw new Error('Setup must not call a hosting CLI.');
    },
    new SourceControlDiscovery(root, async () => {
      throw new Error('Setup must not inspect credentials.');
    }),
  );
  try {
    assert.equal(await service.repository(s), null);
    await git(root, [
      'remote',
      'add',
      'origin',
      'https://code.company.test:8443/group/sub/editor.git',
    ]);
    assert.deepEqual(await service.repository(s), {
      host: 'code.company.test:8443',
      project: 'group/sub/editor',
      provider: null,
    });
    await git(root, [
      'remote',
      'set-url',
      'origin',
      'https://secret@code.company.test/group/editor.git',
    ]);
    await assert.rejects(() => service.repository(s), /without embedded credentials/);
    await git(root, ['remote', 'set-url', 'origin', 'git@github.com:team/editor.git']);
    assert.deepEqual(await service.repository(s), {
      host: 'github.com',
      project: 'team/editor',
      provider: 'github',
    });
  } finally {
    store.close();
  }
});

test('hosting binds writes to their server and rejects stale worktree and request state', async () => {
  const root = await repository(),
    store = new Store(await temp()),
    s = session(root);
  const hosting: HostingBinding = {
    provider: 'gitlab',
    host: 'gitlab.example.test',
    remote: 'origin',
    sourceProject: 'people/fluid/editor',
    targetProject: 'platform/editor',
  };
  await git(root, ['remote', 'add', 'origin', 'git@ssh.example.test:people/fluid/editor.git']);
  store.put('projects', { id: s.projectId, path: root, name: 'Fixture', lastOpened: 1, hosting });
  let writes = 0;
  const current = structuredClone(gitlabRequest);
  const service = new HostingService(store, async (_file, args) => {
    if (args[1] === 'update' || args[0] === 'api') {
      writes++;
      current.description = '';
      return '';
    }
    if (args[0] === 'repo') return '{"default_branch":"develop"}';
    return JSON.stringify(current);
  });
  try {
    const context = await service.context(s);
    assert.equal(context.defaultBranch, 'develop');
    const target = await service.resolve(s);
    const ref = {
      provider: 'gitlab' as const,
      host: hosting.host,
      project: hosting.targetProject,
      number: 42,
    };
    const requests = new PullRequestService(service);
    await assert.rejects(
      () => requests.patch(s, { sessionId: s.id, ref: { ...ref, host: 'other.example.test' } }),
      /another repository/,
    );
    await assert.rejects(
      () =>
        requests.update(s, {
          sessionId: s.id,
          ref,
          expectedUpdatedAt: 'older',
          changes: { body: 'New' },
        }),
      /changed on the server/,
    );
    assert.equal(writes, 0);
    const updated = await requests.update(s, {
      sessionId: s.id,
      ref,
      expectedUpdatedAt: gitlabRequest.updated_at,
      changes: { body: '' },
    });
    assert.equal(writes, 1);
    assert.equal(updated.body, '');
    await git(root, ['remote', 'set-url', 'origin', 'git@ssh.example.test:other/repo.git']);
    await assert.rejects(() => service.assertCurrent(s, target), /connection changed/);
    store.close();
    const reopened = new Store(store.directory);
    try {
      assert.deepEqual(
        reopened.get<{ hosting: HostingBinding }>('projects', s.projectId)?.hosting,
        hosting,
      );
    } finally {
      reopened.close();
    }
  } finally {
    if (store.db.isOpen) store.close();
  }
});
