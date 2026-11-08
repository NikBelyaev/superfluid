import test from 'node:test';
import assert from 'node:assert/strict';
import type { GitStatus } from '@superfluid/contracts';
import { session } from '../../../../tests/fixtures';

test('opening projects restores supported surfaces from incompatible saved layouts', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const request = {
    kind: 'pr',
    ref: { provider: 'gitlab', host: 'gitlab.example.test', project: 'app/editor', number: 42 },
  };
  const supported = [
    { kind: 'file', path: 'main.py' },
    { kind: 'diff', mode: 'branch' },
    { kind: 'browser', url: 'https://example.test' },
    request,
  ];
  const incompatible = [{ kind: 'files' }, null, { kind: 'file' }, { kind: 'pr', ref: {} }];
  const sessions = incompatible.map((surface, index) => ({
    ...session('/workspace'),
    id: String(index),
    state: { tabs: ['main.py'], active: 'main.py', surface, rightTabs: [...supported, surface] },
  }));
  sessions.push({
    ...session('/workspace'),
    id: 'supported',
    state: { tabs: ['main.py'], active: 'main.py', surface: request, rightTabs: supported },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      superfluid: {
        call: async (method: string) => {
          assert.equal(method, 'session.list');
          return sessions;
        },
      },
    },
  });
  const { useApp } = await import('~/state/workspaceStore');
  const before = useApp.getState();
  try {
    useApp.setState({ views: {}, runs: [], switchSession: () => {} });
    await useApp.getState().openProject({
      id: 'project',
      name: 'Fixture',
      path: '/workspace',
      lastOpened: 0,
    });
    assert.equal(useApp.getState().error, null);
    for (const saved of sessions) {
      const restored = useApp.getState().views[saved.id];
      assert.deepEqual(restored.rightTabs, supported);
      assert.deepEqual(restored.surface, saved.state.surface === null ? null : request);
      assert.deepEqual(restored.tabs, ['main.py']);
      assert.equal(restored.active, 'main.py');
    }
  } finally {
    useApp.setState(before, true);
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('refreshing selected repositories preserves freshly discovered sibling branches', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const status: GitStatus = {
    branch: 'main',
    head: 'abc',
    upstream: '',
    ahead: 0,
    behind: 0,
    files: [],
    branches: ['main'],
    repo: true,
    changes: { insertions: 0, deletions: 0 },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      superfluid: {
        call: async (method: string, input: { repositoryId: string }) => {
          assert.equal(method, 'git.status');
          assert.equal(input.repositoryId, 'core');
          return { ...status, branch: 'task/current' };
        },
      },
    },
  });
  const { useApp } = await import('~/state/workspaceStore');
  const before = useApp.getState();
  try {
    useApp.setState({
      repositories: {
        session: [
          { id: 'root', path: '', branch: 'Detached HEAD' },
          { id: 'core', path: 'apps/core', branch: 'task/previous' },
        ],
      },
      repositoryGit: { session: { root: status } },
    });
    await useApp.getState().refreshRepositoryGit('session', ['core']);
    assert.deepEqual(
      useApp.getState().repositories.session.map((r) => r.branch),
      ['Detached HEAD', 'task/current'],
    );
  } finally {
    useApp.setState(before, true);
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('closing hundreds of worktree layouts does not flood the IPC queue', async () => {
  const original = (globalThis as any).window;
  let active = 0,
    peak = 0,
    writes = 0;
  (globalThis as any).window = {
    superfluid: {
      call: async () => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        writes++;
        active--;
      },
    },
  };
  const { useApp, flushLayouts } = await import('~/state/workspaceStore');
  const before = useApp.getState().views;
  try {
    useApp.setState({
      views: Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [
          String(i),
          {
            tabs: [],
            active: null,
            expanded: [],
            changes: false,
            surface: null,
            rightTabs: [],
            history: [],
            historyIndex: -1,
            editorViews: {},
          },
        ]),
      ),
    });
    await flushLayouts();
    assert.equal(writes, 200);
    assert.equal(peak, 1);
  } finally {
    useApp.setState({ views: before });
    (globalThis as any).window = original;
  }
});
