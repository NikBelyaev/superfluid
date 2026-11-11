import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from 'playwright/test';

async function setup() {
  const bundle = await build({
    entryPoints: ['apps/web/src/components/sidebar/ProjectTree.fixture.tsx'],
    bundle: true,
    write: false,
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'without-editor-runtime',
        setup(build) {
          build.onResolve({ filter: /components\/editor\/monaco$/ }, () => ({
            path: 'monaco',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const monaco = {};',
          }));
        },
      },
    ],
  });
  const stack = new AsyncDisposableStack();
  try {
    const browser = stack.use(await chromium.launch({ channel: 'chrome' }));
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://localhost/**', (route) =>
      route.fulfill({
        contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
        body: route.request().url().endsWith('.js')
          ? bundle.outputFiles[0].text
          : '<div id="root"></div><style>.tree-scroll{height:400px;overflow:auto}.tree-row{position:absolute;height:28px;display:flex;width:100%}.file-label{flex:1}.tree-branch{position:absolute;width:100%}.tree-row-end{display:flex}.tree-name-input{width:150px}</style><script type="module" src="/fixture.js"></script>',
      }),
    );
    await page.goto('http://localhost/');
    await expect(page.getByRole('tree', { name: 'Project files' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
    return Object.assign(stack.move(), { page, errors });
  } catch (error) {
    await stack.disposeAsync();
    throw error;
  }
}

test('creating consecutive files and replacing a draft takes one click', async () => {
  await using fixture = await setup();
  const { page, errors } = fixture;
  const tree = page.getByRole('tree', { name: 'Project files' });
  const row = (path: string) => page.locator(`[data-path="${path}"]`);
  const input = page.getByRole('textbox', { name: 'New file name', exact: true });
  const ready = () => expect(tree).toHaveAttribute('aria-busy', 'false');
  await ready();
  for (const name of ['one.py', 'two.py', 'three.py']) {
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await expect(input).toBeFocused();
    await input.fill(name);
    await input.press('Enter');
    await row(name).waitFor();
    await ready();
  }
  for (const name of ['nested-one.py', 'nested-two.py']) {
    await row('src').getByRole('button', { name: 'New file in src', exact: true }).click();
    await expect(input).toBeFocused();
    await input.fill(name);
    await input.press('Enter');
    await row(`src/${name}`).waitFor();
    await ready();
  }
  await row('src').getByRole('button', { name: 'New file in src', exact: true }).click();
  await expect(input).toBeFocused();
  await input.fill('cancelled.py');
  await row('src').getByRole('button', { name: 'New file in src', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await input.press('Escape');
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(input).toBeFocused();
  await input.fill('cancelled-root.py');
  await row('src').getByRole('button', { name: 'New file in src', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await input.press('Escape');
  for (const name of ['menu-one.py', 'menu-two.py']) {
    await row('src').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New file', exact: true }).click();
    await expect(input).toBeFocused();
    await input.fill(name);
    await input.press('Enter');
    await row(`src/${name}`).waitFor();
    await ready();
  }
  await row('one.py').click();
  await row('two.py').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(2);
  await row('one.py').click({ button: 'right' });
  const deletion = page.getByRole('menuitem', { name: 'Delete', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await deletion.click();
  await ready();
  await expect(row('one.py')).toBeVisible();
  await expect(row('two.py')).toBeVisible();
  await row('three.py').click({ button: 'right' });
  await expect(row('three.py')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.dismiss());
  await deletion.click();
  await ready();
  await row('one.py').click();
  await row('two.py').click({ modifiers: ['ControlOrMeta'] });
  await row('one.py').getByRole('button', { name: 'Actions for one.py', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await deletion.click();
  await expect(row('one.py')).toHaveCount(0);
  await expect(row('two.py')).toHaveCount(0);
  await expect(row('three.py')).toBeVisible();
  await ready();
  await row('src').click();
  await row('src-other').click({ modifiers: ['Shift'] });
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(2);
  await row('src-other').press('ControlOrMeta+a');
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(3);
  page.once('dialog', (dialog) => dialog.accept());
  await row('src-other').press('Delete');
  await expect(row('src')).toHaveCount(0);
  await expect(row('src-other')).toHaveCount(0);
  await expect(row('three.py')).toHaveCount(0);
  await ready();
  let unexpectedConfirmation = false;
  page.on('dialog', async (dialog) => {
    unexpectedConfirmation = true;
    await dialog.dismiss();
  });
  await tree.press('Delete');
  assert.equal(unexpectedConfirmation, false);
  assert.deepEqual(errors, []);
});

test('batch trash preflights buffers and drafts, binds the session, and retains partial results', async () => {
  await using fixture = await setup();
  const { page, errors } = fixture;
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.files
      .get('source')!
      .push(
        ...['a.py', 'b.py'].map((path) => ({ name: path, path, directory: false, symlink: false })),
      );
    f.dirty('b.py');
  });
  const trash = () =>
    page.evaluate(() =>
      window.treeFixture
        .trashFiles('source', ['a.py', 'b.py'])
        .catch((error: Error) => error.message),
    );
  page.once('dialog', (dialog) => dialog.accept());
  assert.match(String(await trash()), /unsaved/);
  assert.deepEqual(await page.evaluate(() => window.treeFixture.trashed), []);
  await page.evaluate(() => {
    window.treeFixture.clean();
    window.treeFixture.drafts.add('source:b.py');
  });
  page.once('dialog', (dialog) => dialog.accept());
  assert.match(String(await trash()), /recovery draft/);
  assert.deepEqual(await page.evaluate(() => window.treeFixture.trashed), []);
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.drafts.clear();
    f.pause = f.signal();
    f.entered = f.signal();
    f.useApp.getState().setView(
      {
        tabs: [
          { kind: 'file', path: 'a.py' },
          { kind: 'file', path: 'b.py' },
        ],
        active: { kind: 'file', path: 'a.py' },
        rightTabs: [{ kind: 'file', path: 'b.py' }],
        surface: { kind: 'file', path: 'b.py' },
        bottomTabs: [{ kind: 'file', path: 'a.py' }],
        bottomSurface: { kind: 'file', path: 'a.py' },
      },
      'source',
    );
  });
  page.once('dialog', (dialog) => dialog.accept());
  const deleting = trash();
  await page.evaluate(() => window.treeFixture.entered.promise);
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.useApp.setState({ sessionId: 'other' });
    f.pause!.resolve();
  });
  assert.equal(await deleting, true);
  const state = await page.evaluate(() => {
    const f = window.treeFixture,
      state = f.useApp.getState();
    return {
      trashed: f.trashed,
      active: state.sessionId,
      view: state.views.source,
      other: f.files.get('other'),
    };
  });
  assert.deepEqual(state.trashed, [
    { sessionId: 'source', path: 'a.py' },
    { sessionId: 'source', path: 'b.py' },
  ]);
  assert.equal(state.active, 'other');
  assert.equal(state.other?.[0].path, 'one.py');
  assert.deepEqual([state.view.tabs, state.view.rightTabs, state.view.bottomTabs], [[], [], []]);
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.files.get('source')!.push(
      ...['src/child.py', 'a.py', 'b.py', 'c.py'].map((path) => ({
        name: path,
        path,
        directory: false,
        symlink: false,
      })),
    );
    f.pause = null;
  });
  page.once('dialog', (dialog) => dialog.accept());
  assert.equal(
    await page.evaluate(() =>
      window.treeFixture.trashFiles('source', ['src', 'src-other', 'src/child.py', 'src']),
    ),
    true,
  );
  assert.deepEqual(await page.evaluate(() => window.treeFixture.trashed.slice(2)), [
    { sessionId: 'source', path: 'src' },
    { sessionId: 'source', path: 'src-other' },
  ]);
  await page.evaluate(() => {
    window.treeFixture.failure = 'b.py';
  });
  page.once('dialog', (dialog) => dialog.accept());
  assert.equal(
    await page.evaluate(() =>
      window.treeFixture
        .trashFiles('source', ['a.py', 'b.py', 'c.py'])
        .catch((error: Error) => error.message),
    ),
    'Trash failed',
  );
  assert.deepEqual(
    await page.evaluate(() => window.treeFixture.files.get('source')!.map((entry) => entry.path)),
    ['b.py', 'c.py'],
  );
  assert.deepEqual(errors, []);
});
