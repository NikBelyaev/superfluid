import test from 'node:test';
import assert from 'node:assert/strict';

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
