import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { repository, temp } from './fixtures';

const require = createRequire(import.meta.url);
const project = await repository();
const data = await temp();
const evidence = resolve('test-results/hover');
await mkdir(evidence, { recursive: true });
await writeFile(
  join(project, 'models.py'),
  'class Store(dict[str, int]):\n    def __init__(self, get_response: object | None = None): pass\n    @staticmethod\n    def count() -> int:\n        """Count the items in this store.\n\n        Includes all stored items.\n\n        Returns the current count.\n        """\n        return 42\n',
);
await writeFile(
  join(project, 'main.py'),
  'from models import Store; Store.count\nimport base64\n\nstore = Store()\nstore.count()\nbase64.decodebytes(b"")\nmissing_symbol\nfrom models import Store as Inventory\nalias_store = Inventory()\nflag = 1\nflag = 2\nprint(flag)\n',
);
await writeFile(
  join(project, 'attributes.py'),
  'class NestedAttributeValueFromObjectGetter:\n    def __init__(self):\n        self.attribute_path = self.get_attribute_path()\n    def reset(self):\n        self.attribute_path = 2\n    def read(self):\n        return self.attribute_path\n',
);
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

let failed = false;
try {
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: new RegExp(basename(project)) })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('[data-path="main.py"]').click();
  await expect(page.locator('.statusbar')).toContainText(/(?:ty|pyright) ready/);
  const hover = page.locator('.monaco-hover:visible');
  const showSymbol = async (line: number, column: number, surface = '.main-editor') => {
    await expect(page.locator(`${surface} .view-lines`)).toContainText('store.count');
    await page.locator(`${surface} .editor-host`).click();
    await page.keyboard.press('Meta+ArrowUp');
    for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Control+A');
    for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Meta+K');
    await page.keyboard.press('Meta+I');
    await expect(hover.locator('.monaco-tokenized-source').first()).toBeVisible();
  };
  const visit = async (name: string, target = page) => {
    await target
      .getByRole('button', { name: 'Navigation chain from main.py', exact: true })
      .click();
    await target
      .getByRole('menuitem', { name: new RegExp(name.replaceAll('.', '\\.') + '\\s*:') })
      .first()
      .click();
    await expect(target.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  };
  const symbolPoint = (surface = '.main-editor', text = 'count', lineText = 'store.count()') =>
    page
      .locator(`${surface} .view-line`)
      .filter({ hasText: lineText })
      .evaluate((line, text) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const start = node.textContent!.indexOf(text);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + text.length);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        throw new Error('Symbol token was not rendered');
      }, text);
  await showSymbol(4, 8);
  await expect(hover).toContainText('Count the items');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  const contextMenu = page.locator('.monaco-menu-container:visible');
  const activateMenuAction = async (name: string) => {
    const item = contextMenu.getByRole('menuitem', { name, exact: true });
    await item.hover();
    await item.press('Enter');
  };
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.locator('[data-symbol-action]')).toHaveCount(3);
  await expect(
    contextMenu.getByRole('menuitem', { name: 'Copy reference', exact: true }),
  ).toBeVisible();
  await expect(contextMenu.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveCount(0);
  await expect(
    contextMenu.getByRole('menuitem', { name: 'Delete definition', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: join(evidence, 'context-menu-usage-light.png') });
  await page.keyboard.press('Escape');
  await showSymbol(4, 8);
  const action = (name: string) => hover.getByRole('link', { name, exact: true });
  await expect(action('Go to definition')).toBeVisible();
  await expect(action('Rename')).toHaveCount(0);
  await expect(action('Search')).toBeVisible();
  await expect(action('Copy reference')).toBeVisible();
  await expect(action('Delete definition')).toHaveCount(0);
  await expect(hover).toHaveClass(/symbol-actions-above/);
  await page.screenshot({ path: join(evidence, 'actions-usage.png') });
  await page.keyboard.press('Escape');
  await showSymbol(0, 34);
  await expect(action('Go to definition')).toBeVisible();
  await expect(hover).toHaveClass(/symbol-actions-above/);
  await page.screenshot({ path: join(evidence, 'actions-below-symbol.png') });
  await page.keyboard.press('Escape');
  await showSymbol(4, 8);
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async text => { document.documentElement.dataset.copiedReference = text; }
  } })`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+E');
  await page.keyboard.press('Meta+Shift+ArrowLeft');
  const copyPoint = await symbolPoint();
  await page.mouse.click(copyPoint.x, copyPoint.y, { button: 'right' });
  await activateMenuAction('Copy reference');
  await expect(page.locator('html')).toHaveAttribute('data-copied-reference', 'models.Store.count');
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });
  await showSymbol(4, 8);
  await action('Search').click();
  const search = page.getByRole('dialog', { name: 'Search', exact: true });
  await expect(search.getByRole('textbox')).toHaveValue('count');
  await expect(search.getByRole('option').filter({ hasText: 'models.py' }).first()).toBeVisible();
  await expect(
    search
      .locator('[role="option"][data-type="text"][data-path="main.py"]')
      .filter({ hasText: 'store.count()' }),
  ).toBeVisible();
  await page.screenshot({ path: join(evidence, 'search-symbol-action.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+F');
  await expect(search.getByRole('textbox')).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+ArrowDown');
  const contextPoint = await symbolPoint();
  await page.mouse.click(contextPoint.x, contextPoint.y, { button: 'right' });
  await expect(contextMenu.locator('[data-symbol-action]')).toHaveCount(3);
  await activateMenuAction('Search');
  await expect(search.getByRole('textbox')).toHaveValue('count');
  await expect(
    search
      .locator('[role="option"][data-type="text"][data-path="main.py"]')
      .filter({ hasText: 'store.count()' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await showSymbol(6, 6);
  await expect(action('Copy name')).toBeVisible();
  await expect(action('Rename')).toHaveCount(0);
  await expect(action('Copy reference')).toHaveCount(0);
  await page.screenshot({ path: join(evidence, 'actions-unresolved.png') });
  await page.keyboard.press('Escape');
  await showSymbol(11, 7);
  await action('Choose definition').click();
  await expect(hover.locator('a[title="Open definition"]').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await activateMenuAction('Choose definition');
  await expect(hover.locator('a[title="Open definition"]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await showSymbol(7, 31);
  await action('Rename alias').click();
  const rename = page.getByRole('textbox', { name: 'New symbol name', exact: true });
  await rename.fill('Stock');
  await rename.press('Enter');
  await expect(page.locator('.main-editor .view-lines')).toContainText('Store as Stock');
  await expect(page.locator('.main-editor .view-lines')).toContainText('alias_store = Stock()');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).toContainText('Store as Inventory');
  await page.locator('[data-path="attributes.py"]').click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('self.attribute_path');
  await page.locator('.main-editor .editor-host').click();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+A');
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Meta+K');
  await page.keyboard.press('Meta+I');
  await expect(action('Rename')).toBeVisible();
  await expect(action('Delete definition')).toHaveCount(0);
  await page.screenshot({ path: join(evidence, 'attribute-declaration.png') });
  await action('Rename').click();
  await expect(rename).toHaveValue('attribute_path');
  await rename.fill('я');
  await page.screenshot({ path: join(evidence, 'inline-rename-short.png') });
  await rename.press('Escape');
  await expect(rename).toHaveCount(0);
  await expect(page.locator('.main-editor .view-lines')).toContainText('self.attribute_path');
  await page.keyboard.press('F2');
  await rename.fill('discarded_on_resize');
  await page.getByRole('separator', { name: 'Resize panel', exact: true }).first().click();
  await expect(rename).toHaveCount(0);
  await page
    .locator('.main-editor')
    .getByRole('textbox', { name: 'Editor content', exact: true })
    .focus();
  await page.keyboard.press('F2');
  await expect(rename).toHaveValue('attribute_path');
  await rename.fill('discarded_draft');
  await page.locator('.main-editor .editor-host').click({ position: { x: 600, y: 400 } });
  await expect(rename).toHaveCount(0);
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('discarded_draft');
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+A');
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F2');
  await expect(rename).toHaveValue('attribute_path');
  await rename.fill('renamed_path');
  await rename.press('Enter');
  await expect(page.locator('.main-editor .view-lines')).toContainText(
    'self.renamed_path = self.get_attribute_path()',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('return self.renamed_path');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).toContainText(
    'return self.attribute_path',
  );
  await page.getByRole('button', { name: 'Close attributes.py', exact: true }).click();
  await page.getByRole('tab', { name: 'main.py', exact: true }).click();
  await showSymbol(4, 8);
  const openDeclaration = async () => {
    await action('Go to definition').click();
    await expect(page.getByRole('tab', { name: 'models.py', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.locator('.main-editor').getByRole('textbox', { name: 'Editor content', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Meta+K');
    await page.keyboard.press('Meta+I');
    await expect(action('Rename')).toBeVisible();
  };
  await openDeclaration();
  await expect(action('Delete definition')).toBeVisible();
  await page.screenshot({ path: join(evidence, 'actions-definition.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu.locator('[data-symbol-action]')).toHaveCount(4);
  await page.screenshot({ path: join(evidence, 'context-menu-definition-light.png') });
  await activateMenuAction('Rename');
  await expect(rename).toBeFocused();
  await expect(rename).toHaveValue('count');
  await rename.fill('total_count_for_inventory');
  await page.screenshot({ path: join(evidence, 'inline-rename.png') });
  await rename.press('Enter');
  await expect(page.locator('.main-editor .view-lines')).toContainText(
    'def total_count_for_inventory',
  );
  await expect(rename).toHaveCount(0);
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).toContainText('def count');
  await visit('main.py');
  await expect(page.locator('.main-editor .view-lines')).toContainText(
    'store.total_count_for_inventory',
  );
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).toContainText('store.count');
  await visit('models.py');
  await expect(page.locator('.main-editor .view-lines')).toContainText('def count');
  await expect(
    page.locator('.main-editor').getByRole('textbox', { name: 'Editor content', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Meta+ArrowUp');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+A');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Meta+K');
  await page.keyboard.press('Meta+I');
  await expect(hover).toContainText('Count the items');
  await page.keyboard.press('Escape');
  await visit('main.py');
  await showSymbol(4, 8);
  await openDeclaration();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await activateMenuAction('Delete definition');
  await expect(page.getByRole('tab', { name: 'models.py', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('def count');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('return 42');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('@staticmethod');
  await expect(page.locator('.main-editor .view-lines')).toContainText('class Store');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).toContainText('def count');
  await visit('main.py');
  await showSymbol(3, 10);
  await openDeclaration();
  await action('Delete definition').click();
  await expect(page.getByRole('tab', { name: 'models.py', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('class Store');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).toContainText('class Store');
  await visit('main.py');
  await showSymbol(4, 8);
  await page.keyboard.press('Escape');
  await page.keyboard.press('F2');
  await expect(rename).toBeFocused();
  await rename.press('Escape');
  await expect(rename).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Freeze hover timers while keeping Monaco's rendering and performance measurements live.
  const rendering = await page.evaluateHandle(() => ({
    request: window.requestAnimationFrame.bind(window),
    cancel: window.cancelAnimationFrame.bind(window),
    performance: {
      mark: performance.mark.bind(performance),
      measure: performance.measure.bind(performance),
      getEntriesByName: performance.getEntriesByName.bind(performance),
      clearMarks: performance.clearMarks.bind(performance),
      clearMeasures: performance.clearMeasures.bind(performance),
    },
  }));
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.evaluate((frames) => {
    window.requestAnimationFrame = frames.request;
    window.cancelAnimationFrame = frames.cancel;
    Object.assign(window.performance, frames.performance);
  }, rendering);
  await rendering.dispose();
  const immediateHover = async (surface = '.main-editor', hour = 0) => {
    const point = await symbolPoint(surface, 'Store', 'store = Store()');
    const method = await symbolPoint(surface);
    await page.locator('.titlebar-search').hover();
    await page.clock.pauseAt(new Date(Date.UTC(2030, 0, 1, hour, 1)));
    try {
      for (const key of ['Meta', 'Control']) {
        await page.mouse.move(point.x, point.y);
        await expect(hover).toHaveCount(0);
        await page.keyboard.down(key);
        await expect(page.locator(`${surface} .symbol-definition-link`)).toHaveText('Store');
        await expect(hover).toContainText('class Store');
        await page.mouse.move(point.x + 6, point.y);
        await expect(hover).toContainText('class Store');
        await page.mouse.move(method.x, method.y);
        await expect(hover).toContainText('Count the items');
        await page.keyboard.up(key);
        await page.locator('.titlebar-search').hover();
        await expect(hover).toHaveCount(0);
        await page.keyboard.down(key);
        await page.mouse.move(point.x, point.y);
        await expect(page.locator(`${surface} .symbol-definition-link`)).toHaveText('Store');
        await expect(hover).toContainText('class Store');
        await page.keyboard.up(key);
        await page.locator('.titlebar-search').hover();
        await expect(hover).toHaveCount(0);
      }
    } finally {
      await page.keyboard.up('Meta');
      await page.keyboard.up('Control');
      await page.clock.resume();
    }
    await page.locator('.titlebar-search').hover();
    await page.mouse.move(point.x, point.y);
    await expect(hover).toContainText('class Store');
    await page.screenshot({
      path: join(evidence, surface === '.main-editor' ? 'class-light.png' : 'class-side-light.png'),
    });
    await page.keyboard.press('Escape');
  };
  await immediateHover();
  const point = await symbolPoint();
  await page.mouse.move(point.x, point.y);
  await page.screenshot({ path: join(evidence, 'symbol-normal.png') });
  for (const key of ['Meta', 'Control']) {
    await page.keyboard.down(key);
    await expect(page.locator('.symbol-definition-link')).toHaveText('count');
    await page.screenshot({ path: join(evidence, `symbol-${key.toLowerCase()}.png`) });
    await page.keyboard.up(key);
    await expect(page.locator('.symbol-definition-link')).toHaveCount(0);
  }
  await page.getByRole('tab', { name: 'main.py', exact: true }).hover();
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)!;
    for (const type of ['mousedown', 'mouseup', 'click'])
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'mousedown' ? 1 : 0,
          detail: 1,
          metaKey: true,
        }),
      );
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', bubbles: true }));
  }, point);
  await expect(page.getByRole('tab', { name: 'models.py', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const lineageCount = await page.locator('.lineage-row').count();
  const chainCount = await page.locator('.chain-trigger > span').textContent();
  const selfDefinition = async () => {
    const before = await page.evaluate(
      () => performance.getEntriesByName('superfluid:editor-bound').length,
    );
    await page.keyboard.press('F12');
    await expect
      .poll(() =>
        page.evaluate(() => performance.getEntriesByName('superfluid:editor-bound').length),
      )
      .toBeGreaterThan(before);
    await expect(page.locator('.lineage-row')).toHaveCount(lineageCount);
    await expect(page.locator('.chain-trigger > span')).toHaveText(chainCount!);
  };
  await page
    .locator('.main-editor')
    .getByRole('textbox', { name: 'Editor content', exact: true })
    .focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await selfDefinition();
  }
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Home');
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await selfDefinition();
  await page.getByRole('button', { name: 'Navigate back (Ctrl −)', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'main.py', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'main.py', exact: true }).hover();
  await page.keyboard.down('Meta');
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.symbol-definition-link')).toHaveText('count');
  await page.getByRole('tab', { name: 'main.py', exact: true }).hover();
  await expect(page.locator('.symbol-definition-link')).toHaveCount(0);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.symbol-definition-link')).toHaveText('count');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Meta');
  await expect(page.getByRole('tab', { name: 'models.py', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('return');
  await page.getByRole('button', { name: 'Navigate back (Ctrl −)', exact: true }).click();
  await showSymbol(4, 8);
  await expect(hover).toContainText('Count the items');
  await page.screenshot({ path: join(evidence, 'card-light.png') });
  await hover.getByRole('link', { name: 'models', exact: true }).hover();
  await page.screenshot({ path: join(evidence, 'link-hover-light.png') });
  await hover.getByRole('link', { name: /click to open definition/ }).hover();
  await page.screenshot({ path: join(evidence, 'footer-hover-light.png') });
  await hover.locator('.monaco-tokenized-source').click({ modifiers: ['Meta'] });
  const dialog = page.getByRole('dialog');
  const selected = (name: string) => page.getByRole('tab', { name, exact: true });
  const moveTab = async (name: string, group: 'main' | 'right') => {
    const tab = selected(name);
    await tab.hover();
    const from = (await tab.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, { steps: 2 });
    await expect(page.locator('.tab-drag-preview')).toBeVisible();
    const target = page.locator(`[data-group="${group}"]`);
    const to = (await target.locator('.surface-panel').boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(target).toHaveAttribute('data-drop-target', 'true');
    await page.mouse.up();
    await expect(page.locator('.tab-drag-preview')).toHaveCount(0);
  };
  const back = () =>
    page.getByRole('button', { name: 'Navigate back (Ctrl −)', exact: true }).click();
  await expect(selected('models.py')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-tab-key^="chain:"]')).toHaveCount(1);
  await expect(page.locator('.main-editor').getByRole('tab')).toHaveCount(1);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.main-editor .view-lines')).toContainText('return');
  await page.getByRole('button', { name: 'Navigation chain from main.py', exact: true }).click();
  await expect(page.locator('[role="menuitem"][aria-current="location"]')).toContainText(
    'models.py:4',
  );
  await expect(
    page.getByRole('menuitem', { name: 'Open current file separately', exact: true }),
  ).toHaveCount(0);
  const rootEntry = page.locator('.chain-menu-row').filter({ hasText: 'main.py' });
  const openSeparately = rootEntry.getByRole('menuitem', {
    name: 'Open main.py:5 in separate tab',
    exact: true,
  });
  await expect(openSeparately).toHaveCSS('opacity', '0');
  await rootEntry.hover();
  await expect(openSeparately).toHaveCSS('opacity', '1');
  await page.screenshot({ path: join(evidence, 'chain-symbols.png') });
  await openSeparately.click();
  await expect(page.locator('[data-tab-key="file:main.py"]').getByRole('tab')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('[data-tab-key^="chain:"]').getByRole('tab')).toHaveAttribute(
    'aria-label',
    'models.py',
  );
  await expect(page.locator('.main-editor').getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close main.py', exact: true }).click();
  await expect(page.locator('.main-editor').getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'First file: main.py', exact: true }).click();
  await expect(selected('main.py')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.chain-last-link')).toHaveText('models.py');
  await page.locator('.chain-last-link').click();
  await expect(selected('models.py')).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.locator('.main-editor').getByRole('textbox', { name: 'Editor content', exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: join(evidence, 'source-light.png') });
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.insertText('# unsaved definition edit\n');
  await back();
  await expect(selected('main.py')).toHaveAttribute('aria-selected', 'true');

  await showSymbol(4, 8);
  await expect(hover).toContainText('Count the items');
  await hover.getByRole('link', { name: 'Store', exact: true }).click();
  await expect(selected('models.py')).toHaveAttribute('aria-selected', 'true');
  await expect(selected('models.py')).toHaveCount(1);
  await expect(page.locator('.main-editor .view-lines')).toContainText('unsaved definition edit');
  await back();
  await expect(selected('main.py')).toHaveAttribute('aria-selected', 'true');

  await moveTab('main.py', 'right');
  await showSymbol(4, 8, '.right-group');
  await expect(hover).toContainText('Count the items');
  await expect(action('Rename')).toHaveCount(0);
  await expect(action('Delete definition')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu.locator('[data-symbol-action]')).toHaveCount(3);
  await page.screenshot({ path: join(evidence, 'context-menu-side-light.png') });
  await activateMenuAction('Search');
  await expect(search.getByRole('textbox')).toHaveValue('count');
  await expect(
    search
      .locator('[role="option"][data-type="text"][data-path="main.py"]')
      .filter({ hasText: 'store.count()' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('F2');
  await expect(page.locator('.right-group .symbol-rename input')).toBeFocused();
  await rename.fill('canceled_side_rename');
  await rename.press('Escape');
  await expect(page.locator('.right-group .view-lines')).toContainText('store.count');
  await showSymbol(4, 8, '.right-group');
  await expect(hover).toContainText('Count the items');
  await page.keyboard.press('Escape');
  await immediateHover('.right-group', 1);
  const sidePoint = await symbolPoint('.right-group');
  await page.keyboard.down('Meta');
  await page.mouse.move(sidePoint.x, sidePoint.y);
  await expect(page.locator('.right-group .symbol-definition-link')).toHaveText('count');
  await page.keyboard.up('Meta');
  await expect(page.locator('.symbol-definition-link')).toHaveCount(0);
  await showSymbol(4, 8, '.right-group');
  await expect(hover).toContainText('Count the items');
  await hover.locator('.monaco-tokenized-source').click({ modifiers: ['Meta'] });
  await expect(
    page
      .getByRole('tablist', { name: 'Surfaces', exact: true })
      .getByRole('tab', { name: 'models.py', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('.right-group').getByRole('textbox', { name: 'Editor content', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.right-group .view-lines')).toContainText('return');
  await page.locator('.titlebar-search').hover();
  await expect(page.locator('.right-group .chain-last-link .tab-label')).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Toggle right panel' }).click();
  await back();
  await expect(selected('main.py')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.right-group .view-lines')).toContainText('store.count');
  await moveTab('main.py', 'main');
  await page.getByRole('button', { name: 'Toggle right panel' }).click();

  await page.keyboard.press('Meta+,');
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Dark', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await showSymbol(4, 8);
  await expect(hover).toContainText('Count the items');
  await page.screenshot({ path: join(evidence, 'card-dark.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu.locator('[data-symbol-action]')).toHaveCount(3);
  await page.screenshot({ path: join(evidence, 'context-menu-usage-dark.png') });
  await page.keyboard.press('Escape');
  await showSymbol(4, 8);
  await hover.getByRole('link', { name: 'models', exact: true }).hover();
  await page.screenshot({ path: join(evidence, 'link-hover-dark.png') });
  await hover.getByRole('link', { name: /click to open definition/ }).hover();
  await page.screenshot({ path: join(evidence, 'footer-hover-dark.png') });
  await hover.locator('.monaco-tokenized-source').hover();
  await hover.getByRole('link', { name: 'models', exact: true }).focus();
  await page.screenshot({ path: join(evidence, 'link-focus-dark.png') });
  await page.keyboard.press('Enter');
  await expect(selected('models.py')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.main-editor .view-line').first()).toContainText('class Store');
  await back();
  await expect(selected('main.py')).toHaveAttribute('aria-selected', 'true');
  await expect(dialog).toHaveCount(0);

  await showSymbol(5, 10);
  await expect(hover).toContainText('Decode a bytestring');
  await expect(action('Delete definition')).toHaveCount(0);
  await expect(action('Rename')).toHaveCount(0);
  await hover.locator('.monaco-tokenized-source').click({ modifiers: ['Meta'] });
  await expect(selected('base64.pyi')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.main-editor .view-lines')).toContainText('decodebytes');
  await expect(
    page
      .locator('.main-editor')
      .getByRole('textbox', { name: 'Read-only editor content', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Navigation chain from main.py', exact: true }).click();
  await expect(page.getByRole('menuitem').filter({ hasText: 'decodebytes' })).toContainText(
    'base64.pyi:',
  );
  await page.screenshot({ path: join(evidence, 'chain-external-symbols.png') });
  await page.keyboard.press('Escape');
  await page
    .locator('.main-editor')
    .getByRole('textbox', { name: 'Read-only editor content', exact: true })
    .focus();
  await page.keyboard.insertText('READONLY_PROBE');
  await page.keyboard.press('Meta+S');
  await visit('main.py');
  await expect(
    page.locator('.main-editor').getByRole('textbox', { name: 'Editor content', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.insertText('# local file remains editable\n');
  await expect(page.locator('.main-editor .view-lines')).toContainText(
    'local file remains editable',
  );
  await visit('base64.pyi');
  await expect(
    page
      .locator('.main-editor')
      .getByRole('textbox', { name: 'Read-only editor content', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('READONLY_PROBE');
  await page.screenshot({ path: join(evidence, 'dependency-dark.png') });
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  await expect(contextMenu.locator('[data-symbol-action]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('F2');
  await expect(dialog).toHaveCount(0);
  await back();
  await expect(selected('main.py')).toHaveAttribute('aria-selected', 'true');
  await showSymbol(5, 10);
  await expect(hover).toContainText('Decode a bytestring');
  await hover.locator('.monaco-tokenized-source').click({ modifiers: ['Meta'] });
  await expect(selected('base64.pyi')).toHaveAttribute('aria-selected', 'true');
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  const restored = await app.firstWindow();
  await restored
    .getByRole('button', { name: new RegExp(basename(project)) })
    .first()
    .click();
  await expect(restored.getByRole('tab', { name: 'base64.pyi', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(restored.locator('.main-editor .view-lines')).toContainText('decodebytes');
  await visit('models.py', restored);
  await expect(restored.locator('.main-editor .view-lines')).toContainText(
    'unsaved definition edit',
  );
  console.log(
    'Immediate Cmd/Ctrl hover in both editors, definition tabs, unsaved edits, history, external read-only sources and restoration passed. Evidence:',
    evidence,
  );
} catch (error) {
  failed = true;
  await (
    await app.firstWindow()
  )
    .screenshot({ path: join(evidence, 'failure.png') })
    .catch(() => {});
  console.error('Hover fixture:', project, data);
  throw error;
} finally {
  if (failed) app.process().kill();
  else await app.close();
}
