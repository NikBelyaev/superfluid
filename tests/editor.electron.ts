import { expect } from 'playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createElectronFixture } from './electronFixture';

console.time('Electron editor');
const fixture = await createElectronFixture();
const { project, prFixture, errors } = fixture;
let failed = false;

try {
  const page = await fixture.firstWindow();
  if (process.env.SF_EXECUTABLE) assert.ok(page.url().startsWith('superfluid://app/'));
  assert.deepEqual(
    await page.evaluate(() => ({
      node: typeof (window as any).process,
      require: typeof (window as any).require,
    })),
    { node: 'undefined', require: 'undefined' },
  );
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .waitFor();
  await page.screenshot({ path: 'test-results/welcome.png' });
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click({ timeout: 30000 });
  await page.locator('.workspace-shell').waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('.tree-row').filter({ hasText: 'bom.py' }).waitFor();
  await page.screenshot({ path: 'test-results/editor-empty.png' });
  console.timeLog('Electron editor', 'workspace opened');
  const firstRequest = page.getByRole('button', { name: 'Open PR #15 in Root', exact: true });
  await firstRequest.waitFor();
  const requestSkeletons = await page.evaluateHandle<{ stop: () => boolean }>(`(() => {
    let appeared = false;
    const inspect = (records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (
            node instanceof Element &&
            (node.matches('[role="status"][aria-label="Loading request"]') ||
              node.querySelector('[role="status"][aria-label="Loading request"]'))
          )
            appeared = true;
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return {
      stop: () => {
        inspect(observer.takeRecords());
        observer.disconnect();
        return appeared;
      },
    };
  })()`);
  try {
    await firstRequest.click();
    await page
      .getByRole('heading', { name: prFixture.title, exact: true })
      .or(page.getByRole('status', { name: 'Loading request', exact: true }))
      .waitFor();
    assert.equal(await requestSkeletons.evaluate((value) => value.stop()), false);
    await page.screenshot({ path: 'test-results/pr-cold-island-open.png' });
  } finally {
    await requestSkeletons.evaluate((value) => value.stop());
    await requestSkeletons.dispose();
  }
  await page.getByRole('button', { name: 'Close #15', exact: true }).click();
  await firstRequest.click();
  await page.getByRole('heading', { name: prFixture.title, exact: true }).waitFor();
  assert.equal(await page.getByRole('status', { name: 'Loading request', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Close #15', exact: true }).click();
  const gitMenu = page.getByRole('button', { name: 'Individual Git actions', exact: true });
  await page.locator('.repository-operation:not(:disabled)').waitFor();
  await gitMenu.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('menu').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  await page.keyboard.press('End');
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Apply stash', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.screenshot({ path: 'test-results/git-menu.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Individual Git actions',
  );
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.tree-row').filter({ hasText: 'bom.py' }).click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('value = 1');
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.insertText('# saved through Monaco\r\n');
  await page.keyboard.press('Meta+S');
  await page.waitForTimeout(150);
  const bom = await readFile(join(project, 'bom.py'), 'utf8');
  assert.ok(bom.startsWith('\ufeff'));
  assert.ok(bom.includes('\r\n'));
  await page.locator('.tree-row').filter({ hasText: 'main.py' }).click();
  await page.getByRole('tab', { name: 'main.py', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page
      .getByRole('tab', { name: 'bom.py', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press('Enter');
  await page.locator('.editor-tab.active').filter({ hasText: 'bom.py' }).waitFor();
  await page.getByRole('tab', { name: 'main.py', exact: true }).click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('store = Store()');
  await page.locator('.editor-host').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(
    'from models import Store\n\n# main unsaved\nprint(Store().count())\n',
  );
  await page.getByRole('button', { name: 'New worktree', exact: true }).first().click();
  await page.getByLabel('Branch name').fill('feature/parallel');
  await page.getByLabel('Start from').fill('main');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await page.locator('.worktree-chip.active').filter({ hasText: 'feature/parallel' }).waitFor();
  await page.keyboard.press('Meta+Shift+P');
  await page.getByRole('button', { name: 'Open project files', exact: true }).click();
  await page.locator('.tree-row').filter({ hasText: 'main.py' }).click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('store = Store()');
  await page.locator('.editor-host').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(
    'from models import Store\n\n# feature unsaved\nprint(Store().count())\n',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('feature unsaved');
  await page
    .locator('.worktree-chip')
    .filter({ hasText: /^main$/ })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector('.view-lines')
      ?.textContent?.replaceAll('\u00a0', ' ')
      .includes('main unsaved'),
  );
  assert.equal(
    await page
      .locator('.main-editor')
      .innerText()
      .then((t) => t.includes('feature unsaved')),
    false,
  );
  await page.keyboard.press('Meta+S');
  await page.waitForTimeout(300);
  assert.match(await readFile(join(project, 'main.py'), 'utf8'), /main unsaved/);
  await page.locator('.editor-host').first().click();
  await page.keyboard.press('Meta+ArrowUp');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F12');
  await page.getByRole('tab', { name: 'models.py', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Navigate back (Ctrl −)', exact: true }).click();
  await page.getByRole('tab', { name: 'main.py', exact: true }).waitFor();
  await page.keyboard.press('F2');
  const renameInput = page.getByRole('textbox', { name: 'New symbol name', exact: true });
  await renameInput.fill('Inventory');
  await renameInput.press('Enter');
  await expect(renameInput).toHaveCount(0);
  await expect(page.locator('.main-editor .view-lines')).toContainText('Inventory');
  await page.keyboard.press('Meta+S');
  await page.getByRole('button', { name: 'Navigation chain from main.py', exact: true }).click();
  await page
    .getByRole('menuitem', { name: /models\.py\s*:/ })
    .first()
    .click();
  await page.locator('.breadcrumb').getByText('models.py', { exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.view-lines')?.textContent?.includes('Inventory'),
  );
  await page.keyboard.press('Meta+S');
  for (let i = 0; i < 100; i++) {
    if ((await readFile(join(project, 'models.py'), 'utf8')).includes('class Inventory')) break;
    await page.waitForTimeout(25);
  }
  assert.match(await readFile(join(project, 'models.py'), 'utf8'), /class Inventory/);
  await page.getByRole('button', { name: 'Navigation chain from main.py', exact: true }).click();
  await page
    .getByRole('menuitem', { name: /main\.py\s*:/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  await page.getByRole('textbox', { name: 'Terminal input' }).focus();
  await page.keyboard.insertText(
    "printf '\\123\\125\\120\\105\\122\\106\\114\\125\\111\\104\\137\\101\\114\\111\\126\\105\\n'",
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Terminal output"]')
        ?.textContent?.includes('SUPERFLUID_ALIVE'),
    {},
    { timeout: 15000 },
  );
  await page.getByRole('button', { name: 'Add project action', exact: true }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('Python smoke');
  await page.getByLabel('Action type').selectOption('python');
  await page.getByLabel('Python file', { exact: true }).fill('main.py');
  await page.screenshot({ path: 'test-results/action-dialog.png' });
  await page.getByRole('button', { name: 'Create action', exact: true }).click();
  await page.getByRole('button', { name: 'Python smoke', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Terminal output"]')?.textContent?.includes('42'),
  );
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="Terminal output"]')
      ?.textContent?.includes('SUPERFLUID_ALIVE'),
  );
  await page.screenshot({ path: 'test-results/workspace.png' });
  await page
    .getByRole('button', { name: /^Changes/ })
    .last()
    .click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/changes.png' });
  const measures: number[] = [];
  for (let i = 0; i < 30; i++) {
    const target = i % 2 === 0 ? 'feature/parallel' : 'main';
    await page
      .locator('.worktree-chip')
      .filter({ hasText: target === 'main' ? /^main$/ : /^feature\/parallel$/ })
      .click();
    await expect(page.locator('.main-editor .view-lines')).toContainText(
      target === 'main' ? 'main unsaved' : 'feature unsaved',
    );
    const time = await page.evaluate(() => {
      const starts = performance.getEntriesByName('superfluid:switch-start'),
        ends = performance.getEntriesByName('superfluid:editor-bound');
      return ends.at(-1)!.startTime - starts.at(-1)!.startTime;
    });
    measures.push(time);
  }
  const sorted = [...measures].sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        sampleCount: sorted.length,
        switchP50: sorted[Math.floor(sorted.length * 0.5)],
        switchP95: sorted[Math.floor(sorted.length * 0.95)],
        errors,
      },
      null,
      2,
    ),
  );
  await writeFile(
    'test-results/smoke-metrics.json',
    JSON.stringify(
      { sampleCount: sorted.length, switchP50: sorted[15], switchP95: sorted[28], errors },
      null,
      2,
    ),
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  console.timeLog('Electron editor', 'editor and worktree switching checked');
  await page.keyboard.press('Meta+P');
  await page.getByRole('dialog', { name: 'Search', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/file-palette.png' });
  await page.keyboard.press('Escape');
  console.log('Electron editor passed:', project);
} catch (error) {
  failed = true;
  await fixture.captureFailure();
  throw error;
} finally {
  await fixture.dispose(failed);
  console.timeEnd('Electron editor');
}
