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

test('file mutations release tree actions while Git status is still refreshing', async () => {
  await using fixture = await setup();
  const { page, errors } = fixture;
  const create = page.getByRole('button', { name: 'New file', exact: true });
  const input = page.getByRole('textbox', { name: 'New file name', exact: true });
  const row = (path: string) => page.locator(`[data-path="${path}"]`);
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.gitPause = f.signal();
    f.gitEntered = f.signal();
  });
  await create.click();
  await input.fill('first.py');
  await input.press('Enter');
  await row('first.py').waitFor();
  await page.evaluate(() => window.treeFixture.gitEntered.promise);
  await expect(create).toBeEnabled();
  await create.click();
  await input.fill('second.py');
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.gitPause!.resolve();
    f.gitPause = null;
  });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('second.py');
  await input.press('Enter');
  await row('second.py').waitFor();
  await expect(create).toBeEnabled();
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.gitPause = f.signal();
    f.gitEntered = f.signal();
  });
  await row('first.py').click();
  await row('second.py').click({ modifiers: ['ControlOrMeta'] });
  await row('first.py').click({ button: 'right' });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.evaluate(() => window.treeFixture.gitEntered.promise);
  await expect(row('first.py')).toHaveCount(0);
  await expect(row('second.py')).toHaveCount(0);
  await expect(create).toBeEnabled();
  await create.click();
  await page.evaluate(() => window.treeFixture.gitPause!.resolve());
  await expect(input).toBeFocused();
  await input.press('Escape');
  assert.deepEqual(errors, []);
});

test('file names report sibling duplicates before submission and clear errors as they change', async () => {
  await using fixture = await setup();
  const { page, errors } = fixture;
  const row = (path: string) => page.locator(`[data-path="${path}"]`);
  const alert = page.locator('.project-tree').getByRole('alert');
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'New file name', exact: true });
  const enterHint = page.locator('.tree-name-enter');
  for (const name of ['', ' ', '.', '..', 'folder/name', 'folder\\name']) {
    await input.fill(name);
    await expect(enterHint).toHaveCount(0);
  }
  await input.fill('a');
  await expect(enterHint).toHaveCount(1);
  await input.fill('src');
  await expect(enterHint).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(alert).toContainText('already exists');
  await input.press('Enter');
  await expect(input).toBeFocused();
  assert.deepEqual(
    await page.evaluate(() => window.treeFixture.files.get('source')!.map((entry) => entry.path)),
    ['src', 'src-other'],
  );
  await input.fill('src.py');
  await expect(enterHint).toHaveCount(1);
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(alert).toHaveCount(0);
  await input.press('Enter');
  await row('src.py').waitFor();
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const folder = page.getByRole('textbox', { name: 'New folder name', exact: true });
  await folder.fill('src.py');
  await expect(folder).toHaveAttribute('aria-invalid', 'true');
  await folder.press('Escape');
  await row('src.py').focus();
  await row('src.py').press('F2');
  const rename = page.getByRole('textbox', { name: 'File name', exact: true });
  await expect(rename).toHaveValue('src.py');
  await expect(rename).toHaveAttribute('aria-invalid', 'false');
  await rename.fill('src-other');
  await expect(rename).toHaveAttribute('aria-invalid', 'true');
  await rename.fill('different.py');
  await expect(rename).toHaveAttribute('aria-invalid', 'false');
  await rename.press('Escape');
  await row('src').getByRole('button', { name: 'New file in src', exact: true }).click();
  await input.fill('src.py');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.files
      .get('source')!
      .push({ name: 'src.py', path: 'src/src.py', directory: false, symlink: false });
    f.changed();
  });
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('available.py');
  await expect(alert).toHaveCount(0);
  await input.press('Escape');
  await page.evaluate(() => {
    const f = window.treeFixture;
    f.useApp.setState({
      git: {
        source: {
          files: [{ path: 'src.py', index: '?', worktree: '?' }],
          branch: 'main',
          head: '',
          upstream: '',
          branches: [],
          ahead: 0,
          behind: 0,
          repo: true,
          changes: { insertions: 0, deletions: 0 },
        },
      },
    });
    f.useApp.getState().setView({ changes: true }, 'source');
  });
  await page.getByRole('tree', { name: 'Changed files', exact: true }).waitFor();
  await row('src.py').focus();
  await row('src.py').press('F2');
  await rename.fill('src');
  await expect(rename).toHaveAttribute('aria-invalid', 'true');
  await expect(alert).toContainText('already exists');
  await rename.press('Escape');
  assert.deepEqual(errors, []);
});
