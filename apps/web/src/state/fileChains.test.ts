import assert from 'node:assert/strict';
import test from 'node:test';
import { followFile, selectFileLocation, surfacePaths } from './fileChains';
import { emptyView, mapViewFiles, moveTab, restoreView, surfaceKey } from './workspaceView';

const location = (path: string, line = 1, column = 1) => ({ path, line, column, label: path });

test('a chain retains its identity while following definitions, revisiting locations and selecting its root', () => {
  const root = location('main.py', 4, 8),
    target = location('models.py', 12);
  const chain = followFile({ kind: 'file', path: root.path }, root, target);
  const next = followFile(chain, { ...target, line: 18 }, location('utils.py', 7));
  assert.equal(surfaceKey(next), surfaceKey(chain));
  assert.deepEqual(next.chain?.entries, [root, { ...target, line: 18 }, location('utils.py', 7)]);
  assert.equal(next.path, 'utils.py');
  const returned = selectFileLocation(next, root);
  assert.equal(returned.chain?.index, 0);
  assert.equal(returned.path, 'main.py');
  const revisited = followFile(returned, root, location('utils.py', 7));
  assert.equal(revisited.chain?.entries.length, 3);
  assert.equal(revisited.chain?.index, 2);
  assert.deepEqual(surfacePaths(revisited), ['main.py', 'models.py', 'utils.py']);
  assert.deepEqual(restoreView({ ...emptyView(), tabs: [next], active: next }).tabs, [next]);
  assert.deepEqual(chain.chain?.entries, [root, target]);
});

test('different positions in a file remain distinct and long chains keep their starting file', () => {
  let tab = followFile(
    { kind: 'file', path: 'main.py' },
    location('main.py'),
    location('same.py', 2),
  );
  tab = followFile(tab, location('same.py', 2), location('same.py', 20));
  assert.equal(tab.chain?.entries.length, 3);
  assert.equal(selectFileLocation(tab, location('same.py', 2)).chain?.index, 1);
  for (let line = 21; line < 130; line++)
    tab = followFile(tab, location('same.py', line - 1), location('same.py', line));
  assert.equal(tab.chain?.entries.length, 100);
  assert.equal(tab.chain?.entries[0]?.path, 'main.py');
  assert.equal(tab.chain?.index, 99);
  assert.equal(tab.chain?.entries.at(-1)?.line, 129);
});

test('moving a chain transfers every file position and keeps lineage attached to that tab', () => {
  const tab = followFile(
    { kind: 'file', path: 'main.py' },
    location('main.py'),
    location('models.py', 12),
  );
  const saved = {
    cursorState: [],
    viewState: {
      scrollLeft: 0,
      firstPosition: { lineNumber: 1, column: 1 },
      firstPositionDeltaTop: 0,
    },
    contributionsState: {},
  };
  const view = {
    ...restoreView(emptyView()),
    tabs: [tab],
    active: tab,
    history: [{ ...location('models.py', 12), tab: surfaceKey(tab) }],
    historyIndex: 0,
    editorViews: { 'main:main.py': saved, 'main:models.py': saved },
  };
  const moved = moveTab(view, 'main', 'right', surfaceKey(tab));
  assert.deepEqual(moved.editorViews['side:main.py'], saved);
  assert.deepEqual(moved.editorViews['side:models.py'], saved);
  assert.equal(moved.history[0]?.group, 'right');
  assert.equal(moved.history[0]?.tab, surfaceKey(tab));
  assert.deepEqual(moved.surface, tab);
  assert.deepEqual(restoreView(JSON.parse(JSON.stringify(moved))), moved);
  const bottom = moveTab(moved, 'right', 'bottom', surfaceKey(tab));
  assert.deepEqual(bottom.bottomSurface, tab);
  assert.deepEqual(bottom.editorViews['bottom:main.py'], saved);
  assert.deepEqual(bottom.editorViews['bottom:models.py'], saved);
  assert.equal(bottom.history[0]?.group, 'bottom');
});

test('renaming and deleting chain members preserves the remaining trail and hidden panel state', () => {
  const tab = followFile(
    { kind: 'file', path: 'main.py' },
    location('main.py'),
    location('models.py', 12),
  );
  const view = { ...emptyView(), rightTabs: [tab], surface: tab, rightPanelOpen: false };
  const renamed = mapViewFiles(view, (path) => (path === 'main.py' ? 'renamed.py' : path));
  assert.equal(surfaceKey(renamed.rightTabs[0]!), surfaceKey(tab));
  assert.deepEqual(surfacePaths(renamed.rightTabs[0]!), ['renamed.py', 'models.py']);
  const removed = mapViewFiles(renamed, (path) => (path === 'models.py' ? null : path));
  assert.deepEqual(surfacePaths(removed.rightTabs[0]!), ['renamed.py']);
  assert.equal(removed.surface?.kind === 'file' && removed.surface.path, 'renamed.py');
  assert.equal(removed.rightPanelOpen, false);
  assert.equal(mapViewFiles(removed, () => null).surface, null);
});

test('restoring malformed chains falls back safely and keeps valid entries bounded', () => {
  for (const chain of [
    {},
    { id: '', entries: [location('a.py')], index: 0 },
    { id: 'bad', entries: [{ path: 'a.py', line: 0, column: 1 }], index: 0 },
  ]) {
    const restored = restoreView({
      ...emptyView(),
      tabs: [{ kind: 'file', path: 'fallback.py', chain }],
    });
    assert.deepEqual(restored.tabs, [{ kind: 'file', path: 'fallback.py' }]);
  }
  const restored = restoreView({
    ...emptyView(),
    tabs: [
      {
        kind: 'file',
        path: 'stale.py',
        chain: {
          id: 'valid',
          entries: Array.from({ length: 120 }, (_, i) => location('a.py', i + 1)),
          index: 119,
        },
      },
    ],
  });
  const tab = restored.tabs[0];
  assert.equal(tab?.kind === 'file' && tab.chain?.entries.length, 100);
  assert.equal(tab?.kind === 'file' && tab.chain?.index, 99);
});
