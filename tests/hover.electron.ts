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
  'class Store(dict[str, int]):\n    def __init__(self, get_response: object | None = None): pass\n    def count(self) -> int:\n        """Count the items in this store."""\n        return 42\n',
);
await writeFile(
  join(project, 'main.py'),
  'from models import Store\nimport base64\n\nstore = Store()\nstore.count()\nbase64.decodebytes(b"")\n',
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
  await page.locator('[data-path="main.py"]').click();
  const hover = page.locator('.monaco-hover:visible');
  const showSymbol = async (line: number, column: number, surface = '.main-editor') => {
    await expect(page.locator(`${surface} .view-lines`)).toContainText('store.count');
    await page.locator(`${surface} .editor-host`).click();
    await page.keyboard.press('Meta+ArrowUp');
    for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Meta+K');
    await page.keyboard.press('Meta+I');
  };
  await showSymbol(4, 8);
  await expect(hover).toContainText('Count the items');
  await page.keyboard.press('Escape');
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
    await page.getByRole('tab', { name: 'main.py', exact: true }).first().hover();
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
        await page.getByRole('tab', { name: 'main.py', exact: true }).first().hover();
        await expect(hover).toHaveCount(0);
        await page.keyboard.down(key);
        await page.mouse.move(point.x, point.y);
        await expect(page.locator(`${surface} .symbol-definition-link`)).toHaveText('Store');
        await expect(hover).toContainText('class Store');
        await page.keyboard.up(key);
        await page.getByRole('tab', { name: 'main.py', exact: true }).first().hover();
        await expect(hover).toHaveCount(0);
      }
    } finally {
      await page.keyboard.up('Meta');
      await page.keyboard.up('Control');
      await page.clock.resume();
    }
    await page.getByRole('tab', { name: 'main.py', exact: true }).first().hover();
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
  const back = () =>
    page.getByRole('button', { name: 'Navigate back (Ctrl −)', exact: true }).click();
  await expect(selected('models.py')).toHaveAttribute('aria-selected', 'true');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.main-editor .view-lines')).toContainText('return');
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

  await page.getByRole('button', { name: 'Open current file to the side' }).click();
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
      .getByRole('tablist', { name: 'Files', exact: true })
      .getByRole('tab', { name: 'models.py', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('.main-editor').getByRole('textbox', { name: 'Editor content', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.right-group .view-lines')).toContainText('store.count');
  await page.getByRole('button', { name: 'Hide secondary surface' }).click();
  await back();
  await expect(selected('main.py')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Meta+,');
  await page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Dark', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await showSymbol(4, 8);
  await expect(hover).toContainText('Count the items');
  await page.screenshot({ path: join(evidence, 'card-dark.png') });
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
  await hover.locator('.monaco-tokenized-source').click({ modifiers: ['Meta'] });
  await expect(selected('base64.pyi')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.main-editor .view-lines')).toContainText('decodebytes');
  await expect(
    page
      .locator('.main-editor')
      .getByRole('textbox', { name: 'Read-only editor content', exact: true }),
  ).toBeFocused();
  await page.keyboard.insertText('READONLY_PROBE');
  await page.keyboard.press('Meta+S');
  await selected('main.py').click();
  await expect(
    page.locator('.main-editor').getByRole('textbox', { name: 'Editor content', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.insertText('# local file remains editable\n');
  await expect(page.locator('.main-editor .view-lines')).toContainText(
    'local file remains editable',
  );
  await selected('base64.pyi').click();
  await expect(
    page
      .locator('.main-editor')
      .getByRole('textbox', { name: 'Read-only editor content', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('READONLY_PROBE');
  await page.screenshot({ path: join(evidence, 'dependency-dark.png') });
  await page.keyboard.press('F2');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Close base64.pyi', exact: true }).click();
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
  await restored.getByRole('tab', { name: 'models.py', exact: true }).click();
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
