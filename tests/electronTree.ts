import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { repository, temp } from './fixtures';
import { git } from '../apps/server/src/vcs/gitCommand';

const directory = await temp();
const project = await repository();
await mkdir(join(project, 'src', 'models'), { recursive: true });
await mkdir(join(project, 'empty'));
await mkdir(join(project, 'scratch'));
await mkdir(join(project, 'other', 'nested'), { recursive: true });
await writeFile(join(project, 'scratch', 'item.py'), 'value = 0\n');
await writeFile(join(project, 'other', 'model_159_second.py'), 'value = 2\n');
await writeFile(join(project, 'other', 'nested', 'model_159_copy.py'), 'value = 3\n');
await Promise.all(
  Array.from({ length: 160 }, (_, index) =>
    writeFile(
      join(project, 'src', 'models', `model_${String(index).padStart(3, '0')}.py`),
      'value = 1\n',
    ),
  ),
);
await git(project, ['add', '.']);
await git(project, ['commit', '-m', 'Tree fixture']);
const worktree = join(directory, 'parallel');
await git(project, ['worktree', 'add', '-b', 'feature/tree', worktree]);
await writeFile(join(project, 'main.py'), 'print("changed")\n');
const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
  SF_DATA_DIR: join(directory, 'data'),
  SF_TEST: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.SF_DEV_URL;
const executablePath = process.env.SF_EXECUTABLE || createRequire(import.meta.url)('electron');
const args = [...(process.env.SF_EXECUTABLE ? [] : [resolve('.')]), '--project=' + project];
let app = await electron.launch({
  executablePath,
  args,
  env,
  recordVideo: { dir: 'test-results/file-search-video', size: { width: 1512, height: 980 } },
});
console.log('Tree fixture:', project, 'Electron PID:', app.process().pid);
await mkdir('test-results', { recursive: true });
const errors: string[] = [];
let failed = false;

try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  await page
    .getByRole('button', { name: new RegExp(basename(project)) })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  console.log('Workspace opened');
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  console.log('Project files opened');
  const entry = (path: string) => page.locator(`.tree-row[data-path="${path}"]`);
  const fileSearch = page.getByRole('textbox', { name: 'Search project files', exact: true });
  const searchButton = page.getByRole('button', { name: 'Search project files', exact: true });
  const matches = page.getByRole('tree', { name: 'Project files', exact: true });
  await expect(entry('src')).toHaveAttribute('aria-expanded', 'false');
  await expect(fileSearch).toHaveCount(0);
  await page.screenshot({ path: 'test-results/project-files-search.png' });
  await searchButton.hover();
  await page.screenshot({ path: 'test-results/project-search-hover-collapsed.png' });
  await page.keyboard.press('Meta+f');
  await expect(fileSearch).toBeFocused();
  await fileSearch.press('Escape');
  await expect(searchButton).toHaveAttribute('aria-expanded', 'false');
  await searchButton.click();
  await expect(fileSearch).toBeFocused();
  await expect(searchButton).toHaveAttribute('aria-expanded', 'true');
  await searchButton.hover();
  await page.screenshot({ path: 'test-results/project-search-hover-expanded.png' });
  await page.getByRole('button', { name: 'Close file search', exact: true }).hover();
  await page.screenshot({ path: 'test-results/project-search-hover-close.png' });
  await expect(page.locator('.sidebar-title').getByRole('textbox')).toHaveCount(1);
  await fileSearch.fill('MODEL_159');
  await expect(entry('src/models/model_159.py')).toBeVisible();
  await expect(matches.getByRole('treeitem')).toHaveCount(4);
  await expect(entry('src')).toHaveAttribute('aria-expanded', 'true');
  await expect(entry('src/models')).toHaveAttribute('aria-expanded', 'true');
  await expect(entry('other')).toHaveAttribute('aria-expanded', 'false');
  await expect(entry('other').getByTitle('2 matching files', { exact: true })).toHaveText('2');
  await expect(entry('other/nested')).toHaveCount(0);
  await expect(entry('src/models/model_159.py').locator('mark')).toHaveText('model_159');
  await page.screenshot({ path: 'test-results/project-files-search-nested.png' });
  await entry('other').getByRole('button', { name: 'Expand other', exact: true }).click();
  await expect(entry('other/nested')).toHaveAttribute('aria-expanded', 'true');
  await expect(entry('other/nested/model_159_copy.py')).toBeVisible();
  await expect(entry('other/model_159_second.py')).toBeVisible();
  await entry('other').getByRole('button', { name: 'Collapse other', exact: true }).click();
  await page.locator('.project-tree').evaluate((element) => {
    element.style.width = '240px';
    element.style.flex = 'none';
  });
  await page.screenshot({ path: 'test-results/project-files-search-compact.png' });
  await page.locator('.project-tree').evaluate((element) => {
    element.style.removeProperty('width');
    element.style.removeProperty('flex');
  });
  await entry('src/models').getByRole('button', { name: 'Collapse models', exact: true }).click();
  await expect(entry('src/models/model_159.py')).toHaveCount(0);
  await entry('src/models').getByRole('button', { name: 'Expand models', exact: true }).click();
  await entry('src/models')
    .getByRole('button', { name: 'New file in src/models', exact: true })
    .click();
  const searchFileName = page.getByRole('textbox', { name: 'New file name', exact: true });
  await expect(searchFileName).toBeFocused();
  await searchFileName.fill('model_159_extra.py');
  await searchFileName.press('Enter');
  await expect(entry('src/models/model_159_extra.py')).toBeVisible();
  assert.equal(await readFile(join(project, 'src/models/model_159_extra.py'), 'utf8'), '');
  await rm(join(project, 'src/models/model_159_extra.py'));
  await expect(entry('src/models/model_159_extra.py')).toHaveCount(0);
  await expect(entry('src/models/model_159.py')).toBeVisible();
  await fileSearch.press('Enter');
  await expect(page.getByRole('tab', { name: 'model_159.py', exact: true })).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    // Electron has no public API for wrapping an existing invoke handler.
    const handlers = (
      ipcMain as typeof ipcMain & {
        _invokeHandlers: Map<string, (...args: unknown[]) => unknown>;
      }
    )._invokeHandlers;
    const original = handlers.get('workspace')!;
    let release!: () => void;
    let started!: () => void;
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    const state = globalThis as typeof globalThis & {
      fileSearchGate?: {
        requested: Promise<void>;
        release: () => void;
        hold: () => void;
        restore: () => void;
      };
    };
    state.fileSearchGate = {
      requested,
      release,
      hold() {
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        this.requested = new Promise<void>((resolve) => {
          started = resolve;
        });
        this.release = release;
      },
      restore() {
        release();
        ipcMain.removeHandler('workspace');
        ipcMain.handle('workspace', original);
      },
    };
    ipcMain.removeHandler('workspace');
    ipcMain.handle('workspace', async (...args) => {
      if (args[1] === 'files.search') {
        started();
        await gate;
      }
      return original(...args);
    });
  });
  try {
    await page.getByRole('button', { name: 'Refresh project tree', exact: true }).click();
    await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            fileSearchGate: { requested: Promise<void> };
          }
        ).fileSearchGate.requested,
    );
    await entry('other').getByRole('button', { name: 'Expand other', exact: true }).click();
    await expect(entry('other/nested/model_159_copy.py')).toBeVisible();
    await app.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          fileSearchGate: { release: () => void };
        }
      ).fileSearchGate.release(),
    );
    await expect(matches).toHaveAttribute('aria-busy', 'false');
    await expect(entry('other')).toHaveAttribute('aria-expanded', 'true');
    await expect(entry('other/nested/model_159_copy.py')).toBeVisible();
    await page.screenshot({ path: 'test-results/project-files-search-expanded.png' });
    await app.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          fileSearchGate: { hold: () => void };
        }
      ).fileSearchGate.hold(),
    );
    await fileSearch.fill('src/models/model_158');
    await app.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            fileSearchGate: { requested: Promise<void> };
          }
        ).fileSearchGate.requested,
    );
    await expect(page.getByRole('status', { name: 'Searching files', exact: true })).toBeVisible();
    await expect(entry('src/models/model_159.py')).toBeVisible();
    await expect(matches.getByText('Loading files…', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/project-files-search-pending.png' });
  } finally {
    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        fileSearchGate?: { restore: () => void };
      };
      state.fileSearchGate?.restore();
      delete state.fileSearchGate;
    });
  }
  await expect(entry('src/models/model_158.py')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Searching files', exact: true })).toHaveCount(0);
  await expect(entry('src/models/model_159.py')).toHaveCount(0);
  await entry('src/models/model_158.py').click();
  await expect(page.getByRole('tab', { name: 'model_158.py', exact: true })).toBeVisible();
  await page.locator('.editor-host').click();
  await page.keyboard.press('Meta+f');
  await expect(fileSearch).not.toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close file search', exact: true }).click();
  await page.locator('.editor-host').click();
  await page.locator('.tree-root').click();
  await page.keyboard.press('Meta+f');
  await expect(fileSearch).toBeFocused();
  await fileSearch.fill('missing-file');
  await expect(page.getByText('No matching files.', { exact: true })).toBeVisible();
  await writeFile(join(project, 'src/models/missing-file.md'), 'Search fixture\n');
  await expect(entry('src/models/missing-file.md')).toBeVisible();
  await rm(join(project, 'src/models/missing-file.md'));
  await expect(page.getByText('No matching files.', { exact: true })).toBeVisible();
  await fileSearch.press('Escape');
  await expect(fileSearch).toHaveCount(0);
  await expect(entry('src')).toHaveAttribute('aria-expanded', 'false');
  await entry('src').click();
  await entry('src/models').click();
  await expect(entry('src/models/model_000.py')).toBeVisible();
  await entry('src/models').getByRole('button', { name: 'Collapse models', exact: true }).click();
  await entry('src').getByRole('button', { name: 'Collapse src', exact: true }).click();
  await entry('scratch').click();
  await entry('scratch/item.py').waitFor();
  await rm(join(project, 'scratch'), { recursive: true });
  await expect(entry('scratch')).toHaveCount(0);
  await expect(page.locator('.project-tree').getByRole('alert')).toHaveCount(0);
  await entry('src').click();
  await entry('src').hover();
  await expect(entry('src').locator('.tree-actions button')).toHaveCount(3);
  await entry('src').getByRole('button', { name: 'New file in src', exact: true }).click();
  const fileName = page.getByRole('textbox', { name: 'New file name', exact: true });
  await expect(fileName).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await fileName.fill('created.py');
  await fileName.press('Enter');
  await entry('src/created.py').waitFor();
  await expect(entry('src/created.py').locator('.tree-actions button')).toHaveCount(2);
  await entry('src').hover();
  await entry('src').getByRole('button', { name: 'New folder in src', exact: true }).click();
  const folderName = page.getByRole('textbox', { name: 'New folder name', exact: true });
  await expect(folderName).toBeFocused();
  await folderName.fill('generated');
  await folderName.press('Enter');
  await entry('src/generated').waitFor();
  const actions = async (path: string) => {
    await entry(path).hover();
    await entry(path)
      .getByRole('button', { name: `Actions for ${path}`, exact: true })
      .click();
  };
  for (const path of ['src/created.py', 'src/generated']) {
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const original = clipboard.write;
      const backup = await Promise.all(
        (await clipboard.read())
          .filter((item) => item.types.length > 0)
          .map(
            async (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  await Promise.all(
                    item.types.map(async (type) => [type, await item.getType(type)]),
                  ),
                ),
              ),
          ),
      );
      const state = globalThis as typeof globalThis & { treeCopy?: Promise<string> };
      state.treeCopy = new Promise((resolve, reject) => {
        clipboard.write = async (items) => {
          try {
            let copied;
            try {
              await original.call(clipboard, items);
              const [item] = await clipboard.read();
              const type = item.types.find(
                (type) => type === 'text/uri-list' || type.includes('public.file-url'),
              );
              if (!type) throw new Error(`No file URL in clipboard: ${item.types.join(', ')}`);
              const value = await item.getType(type);
              if (!('text' in value)) throw new Error('Expected a file URL payload.');
              copied = await value.text();
            } finally {
              clipboard.write = original;
              await original.call(clipboard, backup);
            }
            resolve(copied);
          } catch (error) {
            reject(error);
            throw error;
          }
        };
      });
    });
    await actions(path);
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    const copied = await app.evaluate(
      () => (globalThis as typeof globalThis & { treeCopy?: Promise<string> }).treeCopy,
    );
    assert.equal(copied, pathToFileURL(await realpath(join(project, path))).href);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await entry('src').hover();
  await entry('src').getByRole('button', { name: 'New file in src', exact: true }).click();
  await fileName.fill('created.py');
  await fileName.press('Enter');
  await expect(page.locator('.project-tree').getByRole('alert')).toContainText(/EEXIST|exists/);
  await expect(fileName).toHaveValue('created.py');
  await fileName.fill('copy.py');
  await fileName.press('Enter');
  await entry('src/copy.py').waitFor();
  assert.equal(await readFile(join(project, 'src/copy.py'), 'utf8'), '');
  await entry('src').hover();
  await entry('src').getByRole('button', { name: 'New file in src', exact: true }).click();
  await fileName.fill('cancelled.py');
  await writeFile(join(project, 'src', 'watched.py'), 'value = 3\n');
  await expect(entry('src/watched.py')).toBeVisible();
  await expect(fileName).toHaveValue('cancelled.py');
  await fileName.press('Escape');
  await rm(join(project, 'src', 'watched.py'));
  await expect(entry('src/watched.py')).toHaveCount(0);
  await expect(fileName).toHaveCount(0);
  await assert.rejects(readFile(join(project, 'src/cancelled.py')), { code: 'ENOENT' });
  await page.screenshot({ path: 'test-results/project-tree-wide.png' });
  await page.locator('.project-tree').evaluate((element) => {
    element.style.width = '240px';
    element.style.flex = 'none';
  });
  await expect(
    entry('src').getByRole('button', { name: 'New file in src', exact: true }),
  ).toBeHidden();
  await actions('src');
  await page.screenshot({ path: 'test-results/project-tree-compact.png' });
  await page.getByRole('menuitem', { name: 'New file', exact: true }).click();
  await expect(fileName).toBeFocused();
  await fileName.press('Escape');
  await page.locator('.project-tree').evaluate((element) => {
    element.style.removeProperty('width');
    element.style.removeProperty('flex');
  });
  await entry('src/copy.py').hover();
  await entry('src/copy.py')
    .getByRole('button', { name: 'Rename src/copy.py', exact: true })
    .click();
  const renameInput = page.getByRole('textbox', { name: 'File name', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(renameInput).toBeFocused();
  assert.deepEqual(
    await renameInput.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
    [0, 4],
  );
  await page.keyboard.insertText('renamed');
  await expect(renameInput).toHaveValue('renamed.py');
  await page.screenshot({ path: 'test-results/project-tree-inline-rename.png' });
  await renameInput.press('Enter');
  await expect(entry('src/copy.py')).toHaveCount(0);
  await entry('src/renamed.py').waitFor();
  await expect(page.getByRole('tree', { name: 'Project files' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await entry('src/renamed.py').focus();
  await page.keyboard.press('F2');
  await expect(renameInput).toHaveValue('renamed.py');
  await renameInput.fill('created.py');
  await renameInput.press('Enter');
  await expect(page.locator('.project-tree').getByRole('alert')).toContainText(/exists/);
  await expect(renameInput).toHaveValue('created.py');
  await renameInput.press('Escape');
  await entry('src/renamed.py').waitFor();
  await actions('src/generated');
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const folderInput = page.getByRole('textbox', { name: 'Folder name', exact: true });
  await expect(folderInput).toBeFocused();
  assert.deepEqual(
    await folderInput.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
    [0, 9],
  );
  await folderInput.fill('generated.v2');
  await folderInput.press('Enter');
  await entry('src/generated.v2').waitFor();
  await expect(page.getByRole('tree', { name: 'Project files' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await entry('src/generated.v2').focus();
  await page.keyboard.press('F2');
  await expect(folderInput).toBeFocused();
  assert.deepEqual(
    await folderInput.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
    [0, 12],
  );
  await folderInput.fill('generated');
  await folderInput.press('Enter');
  await entry('src/generated').waitFor();
  await expect(page.getByRole('tree', { name: 'Project files' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  for (const [name, end] of [
    ['.env', 4],
    ['README', 6],
    ['archive.tar.gz', 11],
  ] as const) {
    const path = `src/generated/${name}`;
    await writeFile(join(project, path), 'keep');
    if ((await entry('src/generated').getAttribute('aria-expanded')) === 'false')
      await entry('src/generated').click();
    await entry(path).focus();
    await page.keyboard.press('F2');
    await expect(renameInput).toBeFocused();
    assert.deepEqual(
      await renameInput.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
      [0, end],
    );
    await page.keyboard.insertText('cancelled');
    await renameInput.press('Escape');
    assert.equal(await readFile(join(project, path), 'utf8'), 'keep');
    await rm(join(project, path));
    await expect(entry(path)).toHaveCount(0);
  }
  await entry('src/renamed.py').focus();
  await page.keyboard.press('Tab');
  await expect(
    entry('src/renamed.py').getByRole('button', { name: 'Rename src/renamed.py', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    entry('src/renamed.py').getByRole('button', { name: 'Actions for src/renamed.py' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/project-tree-actions.png' });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(entry('src/renamed.py')).toHaveCount(0);
  await entry('src/created.py').dragTo(page.locator('.tree-root'));
  await entry('created.py').waitFor();
  await expect(page.getByRole('tree', { name: 'Project files' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(entry('src/created.py')).toHaveCount(0);
  await entry('created.py').dragTo(entry('src/generated'));
  await entry('src/generated/created.py').waitFor();
  await expect(page.getByRole('tree', { name: 'Project files' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(entry('src/created.py')).toHaveCount(0);
  await entry('src/generated').click({ modifiers: ['Meta'] });
  await expect(entry('src/generated')).toHaveAttribute('aria-selected', 'true');
  await entry('src/generated').dragTo(entry('src/models'));
  await entry('src/models/generated').waitFor();
  await entry('src/models/generated/created.py').waitFor();
  assert.equal(await readFile(join(project, 'src/models/generated/created.py'), 'utf8'), '');
  await actions('src/models/generated');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(entry('src/models/generated')).toHaveCount(0);
  await entry('src/models').getByRole('button', { name: 'Collapse models', exact: true }).click();
  console.log('File and folder actions, pointer DnD, and nested selection passed');
  await entry('src/models').click();
  await entry('src/models/model_000.py').waitFor();
  console.log('Nested files loaded');
  await page.screenshot({ path: 'test-results/project-tree.png' });
  await entry('src/models').focus();
  await page.keyboard.press('ArrowRight');
  await expect(entry('src/models/model_000.py')).toBeFocused();
  await page.keyboard.press('End');
  await expect(entry('main.py')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(entry('src/models/model_159.py')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(entry('empty')).toBeFocused();
  await page.keyboard.press('End');
  await expect(entry('main.py')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(entry('src/models/model_159.py')).toBeFocused();
  const treeScroll = page.getByRole('tree', { name: 'Project files', exact: true });
  const scrollBeforeSearch = await treeScroll.evaluate((element) => element.scrollTop);
  await page.keyboard.press('Control+f');
  await expect(fileSearch).toBeFocused();
  await fileSearch.fill('model_');
  await expect(matches).toHaveAttribute('aria-busy', 'false');
  await fileSearch.press('ArrowDown');
  await expect(entry('src/models/model_000.py')).toBeFocused();
  await page.keyboard.press('End');
  await expect(entry('src/models/model_159.py')).toBeFocused();
  assert.ok((await matches.getByRole('treeitem').count()) < 80);
  await page.screenshot({ path: 'test-results/project-files-search-keyboard.png' });
  await page.keyboard.press('Meta+f');
  await expect(fileSearch).toBeFocused();
  await expect(fileSearch).toHaveValue('model_');
  await fileSearch.fill('model_158');
  await expect(entry('src/models/model_158.py')).toBeVisible();
  await page.getByRole('button', { name: 'Close file search', exact: true }).click();
  await expect(fileSearch).toHaveCount(0);
  assert.equal(await treeScroll.evaluate((element) => element.scrollTop), scrollBeforeSearch);
  await entry('src/models/model_159.py').focus();
  assert.ok((await page.locator('.tree-row').count()) < 80);
  await page.screenshot({ path: 'test-results/project-tree-sticky.png' });
  await page.keyboard.press('ArrowLeft');
  await expect(entry('src/models')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(entry('src/models')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await entry('src/models/model_000.py').waitFor();
  await entry('src/models/model_000.py').click();
  await entry('src/models/model_001.py').click({ modifiers: ['Meta'] });
  await expect(page.locator('.tree-row[aria-selected="true"]')).toHaveCount(2);
  await expect(page.locator('.editor-host')).toBeVisible();
  await page.locator('.editor-host').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('# unsaved in source worktree\n');
  await writeFile(join(project, 'src/models/model_000.py'), '# external edit\n');
  await expect(page.locator('.toast')).toContainText('changed on disk');
  await entry('src/models/model_000.py').dragTo(entry('src'));
  await expect(page.locator('.toast')).toContainText(/Save|unsaved/);
  assert.equal(
    await readFile(join(project, 'src/models/model_000.py'), 'utf8'),
    '# external edit\n',
  );
  await writeFile(join(project, 'src/models/model_000.py'), 'value = 1\n');
  await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.getByRole('tree', { name: 'Changed files' })).toBeVisible();
  await entry('main.py').click();
  await page.getByLabel('Diff comparison', { exact: true }).waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await entry('src/models/model_000.py').waitFor();
  await writeFile(join(project, 'src', 'models', 'added.py'), 'value = 2\n');
  await expect(entry('src/models/added.py')).toBeVisible();
  await entry('src/models/added.py').focus();
  await page.keyboard.press('End');
  await expect(entry('main.py')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(entry('src/models/model_159.py')).toBeFocused();
  await page.keyboard.press('Meta+f');
  await fileSearch.fill('models/added.py');
  await expect(entry('src/models/added.py')).toBeVisible();
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^feature\/tree$/ })
    .click();
  await expect(page.locator('.worktree-chip.active')).toHaveText('feature/tree');
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await expect(entry('src')).toHaveAttribute('aria-expanded', 'false');
  await expect(fileSearch).toHaveCount(0);
  await matches.focus();
  await page.keyboard.press('Meta+f');
  await fileSearch.fill('models/added.py');
  await expect(page.getByText('No matching files.', { exact: true })).toBeVisible();
  await fileSearch.press('Escape');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  const emptyTree = page.getByRole('tree', { name: 'Changed files' });
  await expect(emptyTree).toHaveAttribute('aria-busy', 'false');
  await expect(emptyTree).toContainText('No local changes.');
  await expect(fileSearch).toHaveCount(0);
  assert.equal(
    await readFile(join(project, 'src/models/model_000.py'), 'utf8'),
    '# unsaved in source worktree\n',
  );
  await emptyTree.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await expect(entry('src/models/model_159.py')).toBeVisible();
  await expect(fileSearch).toHaveCount(0);
  await expect(page.locator('.view-lines')).toContainText('unsaved');
  await app.close();
  await page.video()?.saveAs(resolve('test-results/file-search-motion.webm'));
  app = await electron.launch({ executablePath, args, env });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: new RegExp(basename(project)) })
    .first()
    .click();
  await expect(entry('src/models/model_159.py')).toBeVisible();
  await expect(page.locator('.view-lines')).toContainText('unsaved');
  assert.deepEqual(errors, []);
  console.log(
    'Project tree Electron flow passed: keyboard, virtualization, selection, changes, watcher, worktrees, reopen.',
  );
} catch (error) {
  failed = true;
  console.error('Renderer errors:', errors);
  throw error;
} finally {
  const page = await app.firstWindow().catch(() => undefined);
  await page?.screenshot({ path: 'test-results/project-tree-final.png' }).catch(() => {});
  if (failed) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
  else await app.close();
}
