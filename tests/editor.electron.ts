import { expect } from 'playwright/test';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createElectronFixture } from './electronFixture';
import { git } from '../apps/server/src/vcs/gitCommand';

function savedText(directory: string, file: string, marker: string) {
  const watcher = watch(directory);
  const done = new Promise<string>((resolve, reject) => {
    watcher.on('error', reject);
    watcher.on('change', (_event, name) => {
      if (name !== file) return;
      void readFile(join(directory, file), 'utf8')
        .then((text) => {
          if (text.includes(marker)) {
            watcher.close();
            resolve(text);
          }
        })
        .catch(reject);
    });
  });
  return { done, [Symbol.dispose]: () => watcher.close() };
}

console.time('Electron editor');
const fixture = await createElectronFixture();
const { project, prFixture, errors } = fixture;
let failed = false;

try {
  await git(project, ['branch', 'autosave-check']);
  await writeFile(
    join(project, 'hover_docs.py'),
    `def scrollable_help(value: str) -> str:\n    """${Array.from({ length: 40 }, (_, i) => `Inventory documentation ${i + 1}.`).join('\n\n    ')}"""\n    return value\n`,
  );
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
  using bomSave = savedText(project, 'bom.py', '# saved through Monaco');
  await page.keyboard.insertText('# saved through Monaco\r\n');
  const bom = await bomSave.done;
  assert.ok(bom.includes('# saved through Monaco'));
  assert.ok(bom.startsWith('\ufeff'));
  assert.ok(bom.includes('\r\n'));
  await page.keyboard.insertText('# kept after a save conflict\r\n');
  await writeFile(join(project, 'bom.py'), '# external edit\r\n');
  const saveConflict = page.getByRole('alert').filter({ hasText: 'changed on disk' });
  await saveConflict.waitFor();
  assert.equal(await readFile(join(project, 'bom.py'), 'utf8'), '# external edit\r\n');
  await writeFile(join(project, 'bom.py'), bom);
  using conflictSave = savedText(project, 'bom.py', '# kept after a save conflict');
  await page.keyboard.press('Meta+S');
  assert.match(await conflictSave.done, /kept after a save conflict/);
  await saveConflict.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(saveConflict).toBeHidden();
  const rootSession = await page.evaluate(
    async (path) => {
      const { projects } = await window.superfluid.call('bootstrap', {});
      const project = projects.find((p) => p.path === path)!;
      return (await window.superfluid.call('session.list', { projectId: project.id })).find(
        (s) => s.path === path,
      )!;
    },
    await realpath(project),
  );
  await page.evaluate(async (sessionId) => {
    const doc = await window.superfluid.call('files.read', { sessionId, path: 'README.md' });
    await window.superfluid.call('draft.put', {
      sessionId,
      path: doc.path,
      hash: doc.hash,
      text: doc.text + '\nRecovered from a closed tab.\n',
      version: 1,
    });
  }, rootSession.id);
  await page.getByRole('button', { name: 'Project repositories', exact: true }).click();
  const branchMenu = page.getByRole('dialog', { name: 'Branches and repositories', exact: true });
  await page.getByRole('combobox', { name: 'Switch branch', exact: true }).fill('autosave-check');
  await page.getByRole('option', { name: 'autosave-check', exact: true }).click();
  await page.getByRole('button', { name: 'Switch · 1', exact: true }).click();
  await expect(branchMenu).toBeHidden();
  assert.equal((await git(project, ['branch', '--show-current'])).trim(), 'autosave-check');
  assert.match(await readFile(join(project, 'README.md'), 'utf8'), /Recovered from a closed tab/);
  assert.deepEqual(
    await page.evaluate(
      (sessionId) => window.superfluid.call('draft.list', { sessionId }),
      rootSession.id,
    ),
    [],
  );
  await page.getByRole('button', { name: 'Project repositories', exact: true }).click();
  await page.getByRole('combobox', { name: 'Switch branch', exact: true }).fill('main');
  await page.getByRole('option', { name: 'main', exact: true }).click();
  await page.getByRole('button', { name: 'Switch · 1', exact: true }).click();
  await expect(branchMenu).toBeHidden();
  assert.equal((await git(project, ['branch', '--show-current'])).trim(), 'main');
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
  await page.keyboard.insertText('from models import Store\nstore = Store()\nstore.');
  const completions = page.locator('.suggest-widget.visible');
  const countCompletion = completions.getByRole('option', { name: /^count(?: |$)/ });
  const secondCompletion = completions.getByRole('option').nth(1);
  await expect(secondCompletion).toBeVisible();
  const optionBox = (await secondCompletion.boundingBox())!;
  await page.keyboard.press('Escape');
  await page.mouse.move(optionBox.x + 20, optionBox.y + optionBox.height / 2);
  await page.keyboard.press('Control+Space');
  await expect(secondCompletion).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.mouse.move(optionBox.x + 24, optionBox.y + optionBox.height / 2);
  await expect(secondCompletion).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(secondCompletion).toHaveClass(/focused/);
  await page.keyboard.press('ArrowDown');
  await expect(secondCompletion).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Space');
  await expect(secondCompletion).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await countCompletion.click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('store.count');
  await expect(completions).toHaveCount(0);
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Meta+ArrowRight');
  await page.keyboard.press('Shift+F12');
  await expect(page.getByRole('textbox', { name: 'Search worktree', exact: true })).toHaveValue(
    'Store',
  );
  await page.keyboard.press('Escape');
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { document.documentElement.dataset.copiedReference = text; } },
    })`);
  await page.keyboard.press('Meta+Alt+Shift+C');
  await expect(page.locator('html')).toHaveAttribute('data-copied-reference', 'models.Store');
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    delete document.documentElement.dataset.copiedReference;
  });
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('store.count');
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('from hover_docs import scrollable_help\n\nscrollable_help');
  await page.keyboard.press('Escape');
  await page
    .locator('.view-line')
    .filter({ hasText: /^scrollable_help$/ })
    .click({ position: { x: 30, y: 10 } });
  await page.keyboard.press('Meta+K');
  await page.keyboard.press('Meta+I');
  const longHover = page.getByRole('tooltip');
  const hoverSearch = longHover.getByRole('link', { name: 'Search', exact: true });
  await expect(hoverSearch).toBeVisible();
  const searchTop = (await hoverSearch.boundingBox())!.y;
  const hoverBody = longHover.locator('.editor-hover-body');
  await hoverBody.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => hoverBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  assert.equal((await hoverSearch.boundingBox())!.y, searchTop);
  await longHover.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => hoverBody.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press('PageDown');
  await expect.poll(() => hoverBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Meta+ArrowUp');
  await expect.poll(() => hoverBody.evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => hoverBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await hoverSearch.click();
  await expect(page.getByRole('textbox', { name: 'Search worktree', exact: true })).toHaveValue(
    'scrollable_help',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('value = Sto');
  const storeCompletion = completions
    .getByRole('option', { name: /^Store(?: |,|$)/ })
    .filter({ hasText: 'models' });
  await storeCompletion.click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('from models import Store');
  await expect(page.locator('.main-editor .view-lines')).toContainText('value = Store');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText(
    'from models import Store',
  );
  await expect(page.locator('.main-editor .view-lines')).toContainText('value = Sto');
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('value = Store');
  await expect(completions).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  const importHint = page.getByRole('button', { name: 'Import Store' });
  const importChoice = page
    .locator('.editor-choice-menu')
    .getByText('from models import Store', { exact: true });
  await expect(importHint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(importHint).toBeHidden();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Meta+ArrowRight');
  await expect(importHint).toBeVisible();
  await page.getByRole('tab', { name: 'bom.py', exact: true }).click();
  await page.getByRole('tab', { name: 'main.py', exact: true }).click();
  await expect(importHint).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Editor content', exact: true })).toBeFocused();
  await page.locator('.main-editor .squiggly-error').hover({ force: true });
  const hoverImport = page.getByRole('tooltip').getByRole('link', {
    name: /^from models import Store/,
  });
  await expect(hoverImport).toBeVisible();
  await expect(page.getByRole('button', { name: /^View Problem/ })).toBeHidden();
  await page.keyboard.press('Escape');
  for (const shortcut of ['F8', 'Shift+F8', 'Alt+F8', 'Alt+Shift+F8'])
    await page.keyboard.press(shortcut);
  await expect(page.locator('.marker-widget')).toHaveCount(0);
  await page.mouse.move(1, 1);
  await page.locator('.main-editor .squiggly-error').hover({ force: true });
  await expect(hoverImport).toBeVisible();
  await expect(page.getByRole('tooltip').getByText('Quick fix', { exact: true })).toBeVisible();
  await expect(hoverImport.locator('kbd')).toHaveText('⌘1');
  await expect(
    page
      .getByRole('tooltip')
      .getByRole('link', {
        name: /^from ast import Store/,
      })
      .locator('kbd'),
  ).toHaveText('⌘2');
  await expect(page.getByRole('button', { name: /^Quick Fix/ })).toBeHidden();
  await expect(page.getByText('No quick fixes available', { exact: true })).toHaveCount(0);
  await expect(page.locator('.lightBulbWidget')).toBeHidden();
  await page.screenshot({ path: 'test-results/import-hover.png' });
  await hoverImport.click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('from models import Store');
  await expect(page.locator('.action-widget:visible')).toHaveCount(0);
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText(
    'from models import Store',
  );
  await page.mouse.move(1, 1);
  await page.locator('.main-editor .squiggly-error').hover({ force: true });
  await expect(hoverImport).toBeVisible();
  await page.keyboard.press('Meta+9');
  await page.keyboard.press('Meta+2');
  await expect(page.locator('.main-editor .view-lines')).toContainText('from ast import Store');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText('from ast import Store');
  await page.mouse.move(1, 1);
  await page.locator('.main-editor .squiggly-error').hover({ force: true });
  await expect(hoverImport).toBeVisible();
  await page.keyboard.press('Meta+1');
  await expect(page.locator('.main-editor .view-lines')).toContainText('from models import Store');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText(
    'from models import Store',
  );
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  await page.keyboard.press('Meta+1');
  await page.keyboard.press('Alt+Enter');
  await expect(importChoice).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.main-editor .view-lines')).toContainText('from ast import Store');
  await expect(page.locator('.editor-choice-menu')).toHaveCount(0);
  await page.keyboard.press('Meta+Z');
  await page.keyboard.press('Meta+.');
  await expect(importChoice).toBeVisible();
  await importChoice.click();
  await expect(page.locator('.main-editor .view-lines')).toContainText('from models import Store');
  await page.keyboard.press('Meta+Z');
  await expect(page.locator('.main-editor .view-lines')).not.toContainText(
    'from models import Store',
  );
  await page.keyboard.press('Escape');
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon'])
    await writeFile(join(project, `${name}.py`), 'class HoverFixCandidate: pass\n');
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText('HoverFixCandidate');
  await expect(completions).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.move(1, 1);
  await page.locator('.main-editor .squiggly-error').hover({ force: true });
  const fixes = page.getByRole('tooltip').locator('.quick-fix-options');
  await expect(fixes.getByRole('link')).toHaveCount(5);
  await fixes.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => fixes.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const lastFix = fixes.getByRole('link').last();
  const selectedImport = (await lastFix.innerText()).replace(/⌘\d$/, '').trim();
  await lastFix.click();
  await expect(page.locator('.main-editor .view-lines')).toContainText(selectedImport);
  await page.keyboard.press('Meta+Z');
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menu').waitFor();
  await expect(page.getByRole('menuitem', { name: /Import symbol/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
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
  const featureSession = await page.evaluate(async (projectId) => {
    const sessions = await window.superfluid.call('session.list', { projectId });
    return sessions.find((s) => s.branch === 'feature/parallel')!;
  }, rootSession.projectId);
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
  assert.match(await readFile(join(featureSession.path, 'main.py'), 'utf8'), /feature unsaved/);
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
  await page.getByLabel('Keybinding', { exact: true }).press('Control+Alt+R');
  await page.screenshot({ path: 'test-results/action-dialog.png' });
  await page.getByRole('button', { name: 'Create action', exact: true }).click();
  await page.locator('.main-editor .editor-host').click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.insertText("\nprint('SAVED_BEFORE_ACTION')\n");
  await page.keyboard.press('Control+Alt+R');
  await expect(page.getByLabel('Terminal output', { exact: true })).toContainText(
    'SAVED_BEFORE_ACTION',
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
