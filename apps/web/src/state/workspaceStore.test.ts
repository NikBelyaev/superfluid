import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { desktop } from '../rpc/desktop';
import {
  emptyView,
  surfaceKey,
  moveTab,
  restoreView,
  tabGroup,
  tabsToClose,
} from './workspaceView';
import { flushLayouts, showSurface, useApp } from './workspaceStore';
import type { GitStatus } from '@superfluid/contracts';
import { session } from '../../../../tests/fixtures';

test('opening projects restores supported surfaces from incompatible saved layouts', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const request = {
    kind: 'pr',
    ref: { provider: 'gitlab', host: 'gitlab.example.test', project: 'app/editor', number: 42 },
    revealChecks: 'pipeline-42',
  };
  const supported = [
    { kind: 'files' },
    { kind: 'file', path: 'main.py' },
    { kind: 'diff', mode: 'branch' },
    { kind: 'browser', url: 'https://example.test' },
    request,
  ];
  const incompatible = [{ kind: 'unsupported' }, null, { kind: 'file' }, { kind: 'pr', ref: {} }];
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
      assert.deepEqual(restored.tabs, [{ kind: 'file', path: 'main.py' }]);
      assert.deepEqual(restored.active, { kind: 'file', path: 'main.py' });
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
            ...emptyView(),
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

test('tabs reorder and move between groups without losing duplicates, selection or editor state', () => {
  const file = { kind: 'file', path: 'main.py' } as const;
  const files = { kind: 'files' } as const;
  const diff = { kind: 'diff' } as const;
  let view = restoreView({
    layoutVersion: 1,
    tabs: [file, files, diff],
    active: files,
    editorViews: { 'main:main.py': { cursorState: [], viewState: null, contributionsState: {} } },
  });
  view = moveTab(view, 'main', 'main', 'diff:', 'file:main.py');
  assert.deepEqual(view.tabs, [diff, file, files]);
  assert.deepEqual(view.active, files);
  const moved = moveTab(view, 'main', 'right', 'file:main.py');
  assert.deepEqual(moved.tabs, [diff, files]);
  assert.deepEqual(moved.rightTabs, [file]);
  assert.deepEqual(moved.surface, file);
  assert.deepEqual(moved.editorViews['side:main.py'], view.editorViews['main:main.py']);
  const duplicate = moveTab(
    { ...moved, tabs: [file, ...moved.tabs] },
    'main',
    'right',
    'file:main.py',
  );
  assert.deepEqual(duplicate.rightTabs, [file]);
  const returned = moveTab(moved, 'right', 'main', 'file:main.py', 'files');
  assert.deepEqual(returned.tabs, [diff, file, files]);
  assert.equal(returned.surface, null);
  assert.equal(returned.rightPanelOpen, false);
  const bottomFile = moveTab(returned, 'main', 'bottom', 'file:main.py');
  assert.deepEqual(bottomFile.editorViews['bottom:main.py'], returned.editorViews['main:main.py']);
  const bottom = moveTab(returned, 'main', 'bottom', 'files');
  assert.deepEqual(tabGroup(bottom, 'bottom'), { tabs: [files], active: files });
  assert.equal(moveTab(bottom, 'main', 'right', 'missing'), bottom);
  assert.deepEqual(restoreView(JSON.parse(JSON.stringify(bottom))), bottom);
});

test('tab close scopes use the clicked tab and preserve the ordering of remaining tabs', () => {
  const tabs = ['a.py', 'b.py', 'c.py'].map((path) => ({ kind: 'file' as const, path }));
  for (const [scope, expected] of [
    ['this', ['file:b.py']],
    ['others', ['file:a.py', 'file:c.py']],
    ['left', ['file:a.py']],
    ['right', ['file:c.py']],
    ['all', ['file:a.py', 'file:b.py', 'file:c.py']],
  ] as const)
    assert.deepEqual(tabsToClose(tabs, 'file:b.py', scope), expected);
  assert.deepEqual(tabsToClose(tabs, 'file:a.py', 'left'), []);
  assert.deepEqual(tabsToClose(tabs, 'file:c.py', 'right'), []);
  assert.deepEqual(tabsToClose(tabs, 'missing', 'all'), []);
  assert.deepEqual(tabs.map(surfaceKey), ['file:a.py', 'file:b.py', 'file:c.py']);
});

test('a hidden right panel restores its selected tab without opening itself', () => {
  const files = { kind: 'files' } as const,
    diff = { kind: 'diff' } as const;
  const view = restoreView({
    ...emptyView(),
    surface: files,
    rightTabs: [files, diff],
    rightPanelOpen: false,
  });
  assert.equal(view.rightPanelOpen, false);
  assert.deepEqual(view.surface, files);
  assert.deepEqual(restoreView(JSON.parse(JSON.stringify(view))), view);
});

test('surfaces stay in their worktree and Files is a single tree tab alongside terminals', async () => {
  const initial = useApp.getState();
  const call = mock.method(desktop, 'call', async () => ({}));
  const diff = { kind: 'diff' } as const;
  try {
    useApp.setState({
      sessionId: 'active',
      views: {
        active: emptyView(),
        inactive: { ...emptyView(), surface: diff, rightTabs: [diff] },
      },
    });
    showSurface({ kind: 'terminal', id: 'shell' }, 'inactive');
    showSurface({ kind: 'terminal', id: 'shell' }, 'inactive');
    assert.deepEqual(useApp.getState().views.active, emptyView());
    assert.deepEqual(useApp.getState().views.inactive, {
      ...emptyView(),
      surface: diff,
      rightTabs: [diff],
      bottomSurface: { kind: 'terminal', id: 'shell' },
      bottomTabs: [{ kind: 'terminal', id: 'shell' }],
    });
    showSurface({ kind: 'file', path: 'main.py' }, 'inactive');
    assert.deepEqual(useApp.getState().views.inactive.bottomSurface, {
      kind: 'terminal',
      id: 'shell',
    });
    assert.deepEqual(useApp.getState().views.inactive.surface, { kind: 'file', path: 'main.py' });
    useApp.getState().setView({ changes: true }, 'inactive');
    showSurface({ kind: 'files' }, 'inactive');
    showSurface({ kind: 'files' }, 'inactive');
    const view = useApp.getState().views.inactive;
    assert.equal(surfaceKey({ kind: 'files' }), 'files');
    assert.deepEqual(view.surface, { kind: 'files' });
    assert.equal(view.changes, false);
    assert.equal(view.rightTabs.filter((surface) => surface.kind === 'files').length, 1);
    showSurface({ kind: 'diff' }, 'inactive', 'main');
    assert.equal(useApp.getState().views.inactive.changes, false);
    assert.deepEqual(useApp.getState().views.inactive.surface, { kind: 'files' });
  } finally {
    await flushLayouts();
    call.mock.restore();
    useApp.setState(initial, true);
  }
});

test('reopening layouts moves legacy terminals below the editor and drops stale processes', async () => {
  const initial = useApp.getState();
  const project = { id: 'project', name: 'Fixture', path: '/fixture', lastOpened: 0 };
  const session = {
    id: 'session',
    projectId: project.id,
    path: project.path,
    branch: 'main',
    head: '',
    gitDir: '',
    python: '',
    available: true,
    state: {
      ...emptyView(),
      layoutVersion: undefined,
      tabs: ['main.py'],
      active: 'main.py',
      surface: { kind: 'terminal', id: 'shell' },
      rightTabs: [
        { kind: 'diff' },
        { kind: 'terminal', id: 'shell' },
        { kind: 'terminal', id: 'old' },
      ],
      terminalTabs: ['old', 'shell'],
    },
  };
  const call = mock.method(desktop, 'call', async () => [session]);
  try {
    useApp.setState({
      views: {},
      switchSession: () => {},
      runs: [
        {
          id: 'shell',
          sessionId: session.id,
          name: 'Terminal',
          command: 'sh',
          state: 'running',
          startedAt: 0,
        },
      ],
    });
    await useApp.getState().openProject(project);
    const view = useApp.getState().views[session.id];
    assert.deepEqual(view.tabs, [{ kind: 'file', path: 'main.py' }]);
    assert.deepEqual(view.active, { kind: 'file', path: 'main.py' });
    assert.deepEqual(view.bottomSurface, { kind: 'terminal', id: 'shell' });
    assert.deepEqual(view.bottomTabs, [{ kind: 'terminal', id: 'shell' }]);
    assert.deepEqual(view.rightTabs, [{ kind: 'diff' }]);
    assert.equal(view.surface, null);
    useApp.setState({ views: {}, runs: [] });
    await useApp.getState().openProject(project);
    assert.equal(useApp.getState().views[session.id].bottomSurface, null);
    assert.deepEqual(useApp.getState().views[session.id].bottomTabs, []);
  } finally {
    call.mock.restore();
    useApp.setState(initial, true);
  }
});

test('search filters restore per mode and malformed saved choices fall back safely', () => {
  const searchFilters = {
    search: { types: ['class', 'document'], excluded: ['nested-repository'] },
    files: { types: [], excluded: [] },
  };
  assert.deepEqual(restoreView({ searchFilters }).searchFilters, searchFilters);
  for (const searchFilters of [
    null,
    { search: { types: ['unknown'], excluded: [] } },
    { files: { types: ['file'], excluded: [42] } },
  ])
    assert.equal(restoreView({ searchFilters }).searchFilters, undefined);
});
