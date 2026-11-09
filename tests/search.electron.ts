import assert from 'node:assert/strict';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { repository, temp } from './fixtures';
import { git } from '../apps/server/src/vcs/gitCommand';

const require = createRequire(import.meta.url);
const project = await repository();
const data = await temp();
const feature = join(await temp(), 'feature');
const evidence = resolve('test-results/search');
await mkdir(evidence, { recursive: true });
await writeFile(
  join(project, 'models.py'),
  'class Inventory:\n    sku = "alpha-disk"\n    def stock_count(self): pass\n',
);
await writeFile(join(project, '.gitignore'), 'ignored.py\n');
await writeFile(join(project, 'inventory_notes.md'), 'inventory guide\n');
await writeFile(join(project, 'guide.md'), 'Introduction\nThe body-only-document match is here.\n');
await writeFile(join(project, 'inventory_tools.py'), 'def inventory_count(): return 1\n');
await mkdir(join(project, 'services'));
await rename(await repository(), join(project, 'services/catalog'));
await writeFile(
  join(project, 'services/catalog/models.py'),
  'class CatalogInventory: pass\ncatalog_value = "catalog-disk"\n',
);
await writeFile(join(project, 'ignored.py'), 'class IgnoredInventory: pass\n');
await mkdir(join(project, '.worktrees/other'), { recursive: true });
await writeFile(
  join(project, '.worktrees/other/models.py'),
  'class InventoryFromOtherWorktree: pass\n',
);
await git(project, ['add', '.']);
await git(project, ['commit', '-m', 'Search fixture']);
await git(project, ['worktree', 'add', '-b', 'feature/search', feature]);
await writeFile(join(feature, 'models.py'), 'class FeatureInventory:\n    sku = "beta-disk"\n');
const env = Object.fromEntries(
  Object.entries({ ...process.env, SF_DATA_DIR: join(data, 'data'), SF_TEST: '1' }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.SF_DEV_URL;
const launch = () =>
  electron.launch({
    executablePath: process.env.SF_EXECUTABLE || require('electron'),
    args: [...(process.env.SF_EXECUTABLE ? [] : [resolve('.')]), '--project=' + project],
    env,
  });
let app = await launch();
const errors: string[] = [];
let nativeOutput = '';
const capture = () => {
  app.process().stderr?.on('data', (chunk) => {
    nativeOutput = (nativeOutput + chunk.toString()).slice(-12000);
  });
};
capture();
try {
  let page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: new RegExp(basename(project)) })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'main', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const input = () => page.getByRole('textbox', { name: 'Search worktree', exact: true });
  const results = () => page.getByRole('option');
  const onlyType = async (type: string) => {
    for (const name of ['Classes', 'Files', 'Documents', 'Symbols', 'Text']) {
      const button = page
        .getByRole('group', { name: 'Types', exact: true })
        .getByRole('button', { name, exact: true });
      if ((await button.getAttribute('aria-pressed')) !== String(name === type))
        await button.click();
    }
  };
  const openSearch = async (query: string) => {
    await page.keyboard.press('Meta+Shift+f');
    await expect(input()).toBeFocused();
    await input().fill(query);
  };
  const openText = async (query: string) => {
    await openSearch('');
    await onlyType('Text');
    await input().fill(query);
  };
  const openSymbols = async (query: string) => {
    await page.keyboard.press('Meta+t');
    await expect(input()).toBeFocused();
    await onlyType('Classes');
    await input().fill(query);
  };
  await openSearch('');
  await page.screenshot({ path: join(evidence, 'empty.png') });
  await page.mouse.click(8, 300);
  await expect(page.getByRole('dialog', { name: 'Search', exact: true })).toBeHidden();
  await openSearch('inv');
  const classFilter = () =>
    page
      .getByRole('group', { name: 'Types', exact: true })
      .getByRole('button', { name: 'Classes', exact: true });
  await classFilter().click();
  await page.keyboard.type('entory');
  await expect(input()).toHaveValue('inventory');
  await expect(input()).toBeFocused();
  await classFilter().click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('inventory');
  await expect(input()).toHaveValue('inventory');
  await page.getByRole('listbox', { name: 'Matches' }).focus();
  await page.keyboard.press('Backspace');
  await expect(input()).toHaveValue('inventor');
  await page.keyboard.type('y');
  for (const type of ['Classes', 'Files', 'Documents', 'Symbols', 'Text'])
    await expect(
      page
        .getByRole('group', { name: 'Types', exact: true })
        .getByRole('button', { name: type, exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('checkbox', { name: 'All repositories', exact: true })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Repository services/catalog', exact: true }),
  ).toBeChecked();
  for (const type of ['class', 'file', 'document', 'symbol', 'text'])
    await expect(page.locator(`[role="option"][data-type="${type}"]`).first()).toBeVisible();
  assert.equal(await page.getByRole('button', { name: /Best match|Newest|A to Z/ }).count(), 0);
  const rootRepository = page.getByRole('checkbox', {
    name: 'Repository ' + basename(project),
    exact: true,
  });
  const repositoryQuery = page.getByRole('searchbox', { name: 'Filter repositories', exact: true });
  await repositoryQuery.fill('CATALOG');
  await expect(rootRepository).toHaveCount(0);
  await expect(
    page
      .getByRole('checkbox', { name: 'Repository services/catalog', exact: true })
      .locator('..')
      .getByTitle('services/catalog', { exact: true }),
  ).toHaveText('catalog');
  await expect(
    page
      .getByRole('checkbox', { name: 'Repository services/catalog', exact: true })
      .locator('..')
      .getByTitle('main', { exact: true }),
  ).toHaveText('main');
  await repositoryQuery.fill('missing-repository');
  await expect(page.getByText('No matching repositories.', { exact: true })).toBeVisible();
  await repositoryQuery.fill('');
  await rootRepository.uncheck();
  await page.keyboard.type('_');
  await expect(input()).toHaveValue('inventory_');
  await expect(input()).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(page.locator('[role="option"]:not([data-path^="services/catalog/"])')).toHaveCount(
    0,
  );
  await expect(results().first()).toBeVisible();
  await onlyType('Classes');
  await input().focus();
  await page.keyboard.press('Escape');
  await openSearch('inventory');
  await expect(classFilter()).toHaveAttribute('aria-pressed', 'true');
  await expect(rootRepository).not.toBeChecked();
  await expect(results()).toHaveCount(1);
  await expect(results().first().locator('strong')).toHaveText('CatalogInventory');
  await onlyType('');
  await page.getByRole('checkbox', { name: 'Repository services/catalog', exact: true }).uncheck();
  await expect(page.getByText('Select a repository', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.locator('[role="option"][data-type="file"]').first()).toBeVisible();
  await onlyType('Documents');
  await expect(results()).toHaveCount(1);
  await expect(results().first()).toHaveAttribute('data-type', 'document');
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toContainText(
    'inventory guide',
  );
  await expect(results().first()).toContainText('inventory guide');
  await page.screenshot({ path: join(evidence, 'documents.png') });
  await input().fill('body-only-document');
  await expect(results()).toHaveCount(1);
  await expect(results().first()).toHaveAttribute('data-path', 'guide.md');
  await expect(results().first()).toContainText('The body-only-document match is here.');
  await expect(results().first().locator('p mark')).toHaveText('body-only-document');
  await page.screenshot({ path: join(evidence, 'document-content.png') });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'guide.md', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('body-only-document');
  await openSearch('inventory');
  await onlyType('Files');
  await expect(results()).toHaveCount(1);
  await expect(results().first()).toHaveAttribute('data-path', 'inventory_tools.py');
  await onlyType('Classes');
  await expect(results()).toHaveCount(2);
  await expect(results().first().locator('strong')).toHaveText('Inventory');
  await expect(page.locator('[role="option"]:not([data-type="class"])')).toHaveCount(0);
  const rootClass = page.locator('[role="option"][data-path="models.py"]');
  await rootClass.click();
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toContainText(
    'alpha-disk',
  );
  await page.screenshot({ path: join(evidence, 'classes.png') });
  await page
    .getByRole('group', { name: 'Types', exact: true })
    .getByRole('button', { name: 'Symbols', exact: true })
    .click();
  await expect(page.locator('[role="option"][data-type="symbol"]').first()).toBeVisible();
  await onlyType('Symbols');
  await input().fill('stock_count');
  await expect(results()).toHaveCount(1);
  await expect(results().first().locator('strong')).toHaveText('Inventory.stock_count');
  await page.screenshot({ path: join(evidence, 'method-owner.png') });
  await input().fill('inventory');
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.locator('[role="option"][data-type="text"]').first()).toBeVisible();
  await page.locator('[role="option"][data-type="class"][data-path="models.py"]').click();
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toContainText(
    'alpha-disk',
  );
  await page.screenshot({ path: join(evidence, 'all-types.png') });
  const hovered = page.locator('[role="option"][data-type="file"]').first();
  await hovered.hover();
  await expect(hovered).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toContainText(
    'inventory_',
  );
  await page.screenshot({ path: join(evidence, 'hover.png') });
  const dialog = page.getByRole('dialog', { name: 'Search', exact: true });
  const heading = page.getByRole('toolbar', { name: 'Move search window', exact: true });
  const originalPosition = (await dialog.boundingBox())!;
  const headerBox = (await heading.boundingBox())!;
  await page.mouse.move(headerBox.x + 8, headerBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + 68, headerBox.y + 40);
  await page.mouse.up();
  await expect(dialog).toHaveCSS('left', `${originalPosition.x + 60}px`);
  await expect(dialog).toHaveCSS('top', `${originalPosition.y + 32}px`);
  await heading.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog).toHaveCSS('left', `${originalPosition.x + 44}px`);
  await page.keyboard.press('/');
  await expect(input()).toBeFocused();
  await page.screenshot({ path: join(evidence, 'moved.png') });
  const initialSize = (await dialog.boundingBox())!;
  await page.mouse.move(
    initialSize.x + initialSize.width - 3,
    initialSize.y + initialSize.height - 3,
  );
  await page.mouse.down();
  await page.mouse.move(
    initialSize.x + initialSize.width - 243,
    initialSize.y + initialSize.height - 103,
  );
  await page.mouse.up();
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toBeHidden();
  const resized = (await dialog.boundingBox())!;
  assert.ok(resized.width < initialSize.width && resized.height < initialSize.height);
  await page.screenshot({ path: join(evidence, 'resized.png') });
  let handle = (await heading.boundingBox())!;
  await page.mouse.dblclick(handle.x + 8, handle.y + 8);
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toBeVisible();
  handle = (await heading.boundingBox())!;
  await page.mouse.dblclick(handle.x + 8, handle.y + 8);

  await page.emulateMedia({ colorScheme: 'dark' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toBeVisible();
  await page.screenshot({ path: join(evidence, 'dark-1280.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toBeHidden();
  await page.screenshot({ path: join(evidence, 'compact-900.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1512, 980));
  await page.emulateMedia({ colorScheme: 'light' });
  await results().first().hover();
  await input().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: 'Matches' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(results().last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(results().first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(input()).toBeFocused();
  await page.locator('[role="option"][data-type="class"][data-path="models.py"]').click();
  await input().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'models.py', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('alpha-disk');
  await writeFile(join(project, 'models.py'), 'class Inventory:\n    sku = "external-disk"\n');
  await openText('external-disk');
  await expect(results()).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.main-editor .view-lines')).toContainText('external-disk');
  await page.locator('.main-editor .editor-host').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('class RecoveredInventory:\n    sku = "buffer-only"\n');
  await expect(page.locator('.main-editor .view-lines')).toContainText('RecoveredInventory');
  await openSymbols('RecoveredInventory');
  await expect(results()).toHaveCount(1);
  await page.keyboard.press('Escape');
  await openText('buffer-only');
  await expect(results()).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'Result preview' })).toContainText(
    'buffer-only',
  );
  await page.screenshot({ path: join(evidence, 'text-unsaved.png') });
  await input().fill('external-disk');
  await expect(page.getByText('No results found', { exact: true })).toBeVisible();
  await classFilter().click();
  await page.getByRole('checkbox', { name: 'Repository services/catalog', exact: true }).uncheck();
  await input().focus();
  await page.keyboard.press('Escape');
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^feature\/search$/ })
    .click();
  await openSearch('buffer-only');
  await expect(classFilter()).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('checkbox', { name: 'All repositories', exact: true })).toBeChecked();
  await onlyType('Text');
  await expect(page.getByText('No results found', { exact: true })).toBeVisible();
  await input().fill('beta-disk');
  await expect(results()).toHaveCount(1);
  await page.keyboard.press('Escape');
  await openSymbols('FeatureInventory');
  await expect(results()).toHaveCount(1);
  await page.screenshot({ path: join(evidence, 'other-worktree.png') });
  await page.keyboard.press('Escape');
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await openSearch('buffer-only');
  await expect(classFilter()).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('checkbox', { name: 'Repository services/catalog', exact: true }),
  ).not.toBeChecked();
  await input().focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+p');
  await page
    .getByRole('textbox', { name: 'Search commands', exact: true })
    .fill('Go to symbol in worktree');
  await page.keyboard.press('Enter');
  await input().fill('RecoveredInventory');
  await expect(results()).toHaveCount(1);
  await onlyType('Text');
  await input().fill('buffer-only');
  await expect(results()).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+p');
  await expect(input()).toBeFocused();
  await input().fill('inventory_notes');
  await expect(results()).toHaveCount(1);
  await expect(results().first()).toHaveAttribute('data-type', 'document');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'inventory_notes.md', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('inventory guide');
  assert.equal(errors.length, 0, errors.join('\n'));
  await app.close();
  app = await launch();
  capture();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: new RegExp(basename(project)) })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'main', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await openSearch('buffer-only');
  await expect(classFilter()).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page
      .getByRole('group', { name: 'Types', exact: true })
      .getByRole('button', { name: 'Text', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('checkbox', { name: 'Repository services/catalog', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await input().focus();
  await page.keyboard.press('Escape');
  await openSearch('buffer-only');
  await expect(classFilter()).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('checkbox', { name: 'All repositories', exact: true })).toBeChecked();
  await expect(results()).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.main-editor .view-lines')).toContainText('buffer-only');
  await page.screenshot({ path: join(evidence, 'recovered.png') });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Search Electron pass:', JSON.stringify({ project, data, evidence }));
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  console.error('Search fixture:', { project, data, nativeOutput, errors });
  throw error;
} finally {
  await app.close().catch(() => {});
}
