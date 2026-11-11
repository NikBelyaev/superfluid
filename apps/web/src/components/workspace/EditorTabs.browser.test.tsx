import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

test('chain tabs follow the selected location across groups, tabs and restored worktrees', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
        import { createRoot } from 'react-dom/client';
        import { EditorTabs } from '~/components/workspace/EditorTabs';
        import { useApp } from '~/state/workspaceStore';
        import { followFile } from '~/state/fileChains';
        import { emptyView, restoreView, setTabGroup } from '~/state/workspaceView';
        window.superfluid = { call: async () => ({}) };
        const location = (path, line) => ({ path, line, column: 1, label: path });
        const root = location('main.py', 1), middle = location('models.py', 12);
        const chain = followFile(followFile({ kind: 'file', path: root.path }, root, middle),
          middle, location('utils.py', 24));
        const sessions = ['one', 'two'].map(id => ({ id, path: '/' + id }));
        const view = () => ['main', 'right', 'bottom'].reduce((view, group) =>
          setTabGroup(view, group, [chain, { kind: 'files' }], chain), emptyView());
        useApp.setState({ sessions, sessionId: 'one',
          views: { one: view(), two: view() },
          repositories: { one: [{ id: 'root', path: '' }] },
          repositoryGit: { one: { root: { files: [
            { path: 'models.py', index: '.', worktree: 'M' },
            { path: 'utils.py', index: 'A', worktree: '.' }
          ] } } }
        });
        const element = createRoot(document.getElementById('root'));
        function Fixture() {
          const id = useApp(a => a.sessionId);
          const session = sessions.find(s => s.id === id);
          return <>
            {sessions.map(s => <button key={s.id} onClick={() => useApp.setState({ sessionId: s.id, surfaceMenu: null })}>{s.id}</button>)}
            <button onClick={() => useApp.setState({ views: Object.fromEntries(
              Object.entries(useApp.getState().views).map(([id, view]) => [id, restoreView(JSON.parse(JSON.stringify(view)))])
            ) })}>Restore</button>
            {['main', 'right', 'bottom'].map(group => <section key={id + group} data-group={group}>
              <EditorTabs session={session} group={group} />
            </section>)}
          </>;
        }
        element.render(<Fixture />);
        window.unmount = () => element.unmount();
      `,
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [
      {
        name: 'documents-without-monaco',
        setup(build) {
          build.onResolve({ filter: /state\/editor\/Documents$/ }, () => ({
            path: 'Documents',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
              export const subscribe = () => () => {};
              export const getRevision = () => 0;
              export const documentPath = path => path;
              export const documents = {
                items: new Map(), key: (id, path) => id + ':' + path,
                captureViews() {}, outline: async () => [],
                open: async () => ({ version: 0 }),
              };
            `,
          }));
        },
      },
    ],
  });
  await using browser = await chromium.launch();
  await using context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://superfluid.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('https://superfluid.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const screen = new AsyncDisposableStack();
  screen.defer(async () => {
    await page.evaluate('window.unmount?.()');
  });
  await using _mounted = screen.move();
  for (const group of ['main', 'right', 'bottom']) {
    const panel = page.locator(`[data-group="${group}"]`);
    const current = panel.locator('.chain-last-link');
    const visit = async (name: string) => {
      await panel
        .getByRole('button', { name: 'Navigation chain from main.py', exact: true })
        .click();
      await page.getByRole('menuitem', { name: new RegExp('^' + name + ':') }).click();
    };
    await expect(current).toHaveText('utils.py');
    await visit('models.py');
    await expect(current).toHaveText('models.py');
    await expect(current).toHaveAttribute('title', 'models.py:12');
    await expect(current.locator('.tab-label')).toHaveAttribute('data-git-status', 'modified');
    await panel.getByRole('tab', { name: 'Files', exact: true }).click();
    await expect(current).toHaveAttribute('aria-selected', 'false');
    await current.click();
    await expect(current).toHaveText('models.py');
    await expect(current).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'two', exact: true }).click();
    await expect(current).toHaveText('utils.py');
    await page.getByRole('button', { name: 'one', exact: true }).click();
    await expect(current).toHaveText('models.py');
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(current).toHaveText('models.py');
    await current.click();
    await expect(current).toHaveAttribute('title', 'models.py:12');
    await panel.getByRole('button', { name: 'First file: main.py' }).click();
    await expect(current).toHaveText('main.py');
    await visit('utils.py');
    await expect(current).toHaveText('utils.py');
    await visit('models.py');
    await expect(current).toHaveText('models.py');
  }
  assert.deepEqual(errors, []);
});
