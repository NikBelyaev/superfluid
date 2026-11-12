import assert from 'node:assert/strict';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'playwright/test';
import { createElectronFixture } from './electronFixture';
import { git } from '../apps/server/src/vcs/gitCommand';

function savedFile(directory: string, expected: string) {
  const watcher = watch(directory);
  const done = new Promise<void>((resolve, reject) => {
    const check = () =>
      void readFile(join(directory, 'main.py'), 'utf8').then((text) => {
        if (text === expected) resolve();
      }, reject);
    watcher.on('change', check);
    watcher.on('error', reject);
    check();
  });
  return { done, [Symbol.dispose]: () => watcher.close() };
}

const fixture = await createElectronFixture();
const evidence = process.env.SF_GIT_DIFF_EVIDENCE || join(fixture.temp, 'git-diff');
const before = !!process.env.SF_GIT_DIFF_BEFORE;
let failed = false;
try {
  await mkdir(evidence, { recursive: true });
  const original = Array.from({ length: 35 }, (_, i) => `value_${i} = ${i}`).join('\n') + '\n';
  const current =
    original.replace('value_1 = 1\n', 'value_1 = 100\n').replace('value_18 = 18\n', '') +
    'added_value = 42\n';
  const parameters =
    'def GraphQLFetch(query, parameters, result_path):\n    return parameters\n\ndef fetch(query, result_path):\n    return GraphQLFetch(query, parameters={}, result_path=result_path)\n';
  const manyPrefix = Array.from({ length: 30 }, (_, i) => `before_${i} = ${i}`).join('\n') + '\n';
  const manySuffix = Array.from({ length: 80 }, (_, i) => `keep_${i} = ${i}`).join('\n') + '\n';
  const many =
    manyPrefix +
    Array.from({ length: 200 }, (_, i) => `old_value_${i} = ${i}`).join('\n') +
    '\n' +
    manySuffix;
  await writeFile(join(fixture.project, 'many.py'), many);
  const long = `message = "${'old '.repeat(100)}" # old_end\n`;
  await writeFile(join(fixture.project, 'long.py'), long);
  await writeFile(join(fixture.project, 'main.py'), original);
  await writeFile(join(fixture.project, 'parameters.py'), parameters);
  await git(fixture.project, ['add', 'main.py', 'parameters.py', 'long.py', 'many.py']);
  await git(fixture.project, ['commit', '-m', 'Prepare diff fixture']);
  await writeFile(join(fixture.project, 'main.py'), current);
  await writeFile(join(fixture.project, 'many.py'), manyPrefix + 'new_value = 1\n' + manySuffix);
  await writeFile(join(fixture.project, 'long.py'), 'message = \"new\"\n');
  await writeFile(join(fixture.project, 'bom.py'), '\ufeffvalue = 2\r\n');
  await writeFile(join(fixture.project, 'untracked.py'), 'new_value = 42\n');
  await writeFile(
    join(fixture.project, 'parameters.py'),
    parameters.replace('parameters={}', "parameters='test'"),
  );
  const page = await fixture.firstWindow();
  const session = await page.evaluate(async () => {
    const data = await window.superfluid.call('bootstrap', {});
    const [session] = await window.superfluid.call('session.list', {
      projectId: data.projects[0].id,
    });
    const file = { kind: 'file' as const, path: 'main.py' };
    const diff = { kind: 'diff' as const, path: 'main.py' };
    await window.superfluid.call('session.state', {
      sessionId: session.id,
      state: {
        layoutVersion: 1,
        tabs: [
          file,
          ...['models.py', 'parameters.py', 'long.py', 'bom.py', 'untracked.py', 'many.py'].map(
            (path) => ({
              kind: 'file' as const,
              path,
            }),
          ),
        ],
        active: file,
        rightTabs: [file, diff],
        surface: diff,
        rightPanelOpen: true,
        bottomTabs: [file],
        bottomSurface: file,
        expanded: [],
        changes: false,
        history: [],
        historyIndex: -1,
        editorViews: {},
      },
    });
    return session;
  });
  await page
    .getByRole('button', { name: /fluid-lab/ })
    .first()
    .click();
  await page.locator('.workspace-shell').waitFor();
  const main = page.locator('[data-group="main"]');
  const right = page.locator('[data-group="right"]');
  const bottom = page.locator('[data-group="bottom"]');
  await expect(main.locator('.git-line-modified')).toHaveCount(1);
  await expect(page.locator('.diff-files')).toContainText('value_1 = 100');
  const choose = (name: string) =>
    page
      .locator('label')
      .filter({ has: page.getByRole('radio', { name, exact: true }) })
      .click();
  for (const scheme of ['light', 'dark']) {
    for (const theme of ['Monaco', 'Darcula']) {
      await page.keyboard.press('Meta+,');
      await choose(scheme === 'light' ? 'Light' : 'Dark');
      await choose(`${theme} ${scheme}`);
      await page.getByRole('button', { name: 'Close settings' }).click();
      await page.screenshot({
        path: join(evidence, `${before ? 'before' : 'after'}-${theme.toLowerCase()}-${scheme}.png`),
      });
      if (!before) {
        await main.locator('.git-line-modified').click();
        await expect(main.getByRole('region', { name: 'Inline Git diff' })).toBeVisible();
        await page.screenshot({
          path: join(evidence, `inline-${theme.toLowerCase()}-${scheme}.png`),
        });
        await main.getByRole('button', { name: 'Close inline diff' }).click();
      }
    }
  }
  if (!before) {
    await right.getByRole('tab', { name: 'main.py', exact: true }).click();
    for (const surface of [main, right, bottom]) {
      await surface.locator('.git-line-modified').click();
      const inline = surface.getByRole('region', { name: 'Inline Git diff' });
      await expect(inline).toBeVisible();
      await expect(inline.locator('.view-line')).toHaveCount(1);
      await expect(inline).toContainText('value_1 = 1');
      await expect(inline).not.toContainText('value_1 = 100');
      await expect(surface.locator('.git-inline-word-added')).not.toHaveCount(0);
      assert.equal(await inline.getByText('Commit this change').count(), 0);
      await page.screenshot({
        path: join(evidence, `inline-${await surface.getAttribute('data-group')}.png`),
      });
      await inline.getByRole('button', { name: 'Rollback change', exact: true }).click();
      await expect(inline).toHaveCount(0);
      await expect(surface.locator('.git-line-modified')).toHaveCount(0);
      await expect(surface.locator('.view-lines').first()).toContainText('value_1 = 1');
      await page.keyboard.press('Meta+z');
      await expect(surface.locator('.git-line-modified')).toHaveCount(1);
      await expect(surface.locator('.view-lines').first()).toContainText('value_1 = 100');
    }
    await main.locator('.git-line-modified').click();
    await page.screenshot({ path: join(evidence, 'inline-modified.png') });
    await page.keyboard.press('Escape');
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toHaveCount(0);
    await main.locator('.git-line-deleted').click();
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toContainText('value_18');
    await main.getByRole('button', { name: 'Rollback change', exact: true }).click();
    await expect(main.locator('.git-line-deleted')).toHaveCount(0);
    await expect(main.locator('.view-lines').first()).toContainText('value_18 = 18');
    await page.keyboard.press('Meta+z');
    await expect(main.locator('.git-line-deleted')).toHaveCount(1);
    await main.getByRole('textbox', { name: 'Editor content', exact: true }).focus();
    await page.keyboard.press('Meta+ArrowDown');
    await main.locator('.git-line-added').click();
    await expect(
      main.getByRole('region', { name: 'Inline Git diff' }).locator('.monaco-editor'),
    ).toHaveCount(0);
    await expect(main.locator('.view-lines').first()).toContainText('added_value');
    await main.getByRole('button', { name: 'Rollback change', exact: true }).click();
    await expect(main.locator('.git-line-added')).toHaveCount(0);
    await page.keyboard.press('Meta+z');
    await expect(main.locator('.git-line-added')).toHaveCount(1);
    await page.keyboard.press('Meta+ArrowUp');
    await main.locator('.git-line-modified').click();
    await main.getByRole('textbox', { name: 'Editor content', exact: true }).focus();
    await page.keyboard.press('Meta+A');
    await page.keyboard.insertText(current.replace('100', '101'));
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toHaveCount(0);
    await page.keyboard.press('Meta+ArrowUp');
    await expect(main.locator('.view-lines').first()).toContainText('value_1 = 101');
    using saved = savedFile(fixture.project, current.replace('100', '101'));
    await page.keyboard.press('Meta+S');
    await saved.done;
    await main.locator('.git-line-modified').click();
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toBeVisible();
    await git(fixture.project, ['add', 'main.py']);
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toHaveCount(0);
    await expect(main.locator('.git-line-modified')).toHaveCount(0);
    await right.getByRole('tab', { name: 'Diff', exact: true }).click();
    await right.getByLabel('Diff comparison').selectOption('staged');
    await expect(right.locator('.diff-files')).toContainText('value_1 = 101');
    await writeFile(join(fixture.project, 'main.py'), current.replace('100', '102'));
    await expect(main.locator('.view-lines').first()).toContainText('value_1 = 102');
    await main.locator('.git-line-modified').click();
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toBeVisible();
    await main.getByRole('tab', { name: 'models.py', exact: true }).click();
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toHaveCount(0);
    await main.getByRole('tab', { name: 'main.py', exact: true }).click();
    await main.locator('.git-line-modified').click();
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toContainText('101');
    await page.getByRole('button', { name: 'New worktree', exact: true }).click();
    await page.getByLabel('Branch name').fill('inline-other');
    await page.getByLabel('Start from').fill('HEAD');
    await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
    await expect(page.locator('.worktree-chip.active')).toContainText('inline-other');
    await expect(page.getByRole('region', { name: 'Inline Git diff' })).toHaveCount(0);
    await page
      .locator('.worktree-chip')
      .filter({ hasText: /^main$/ })
      .click();
    await expect(main.locator('.view-lines').first()).toContainText('value_1 = 102');
    await main.locator('.git-line-modified').click();
    await expect(main.getByRole('region', { name: 'Inline Git diff' })).toContainText('101');
    await main.getByRole('button', { name: 'Close inline diff' }).click();
    await main.getByRole('tab', { name: 'parameters.py', exact: true }).click();
    await main.locator('.git-line-modified').click();
    const parametersPreview = main.getByRole('region', { name: 'Inline Git diff' });
    await expect(parametersPreview.locator('.view-line')).toHaveCount(1);
    await expect
      .poll(async () =>
        (await parametersPreview.locator('.git-inline-word-deleted').allTextContents()).join(''),
      )
      .toBe('{}');
    await expect
      .poll(async () => (await main.locator('.git-inline-word-added').allTextContents()).join(''))
      .toBe("'test'");
    await page.screenshot({ path: join(evidence, 'inline-parameters.png') });
    await main.getByRole('button', { name: 'Close inline diff' }).click();
    await unlink(join(fixture.project, 'parameters.py'));
    await main.locator('.git-line-deleted').click();
    await expect(main.getByRole('button', { name: 'Rollback change', exact: true })).toBeDisabled();
    await expect(main.locator('.view-lines').first()).toContainText("parameters='test'");
    await main.getByRole('button', { name: 'Close inline diff' }).click();
    await main.getByRole('tab', { name: 'long.py', exact: true }).click();
    await main.locator('.git-line-modified').click();
    await expect(main.locator('.git-inline-word-deleted')).not.toHaveCount(0);
    await expect
      .poll(async () => (await main.locator('.git-inline-diff').boundingBox())!.width)
      .toBeGreaterThan((await main.boundingBox())!.width * 0.8);
    const oldEnd = main
      .getByRole('region', { name: 'Inline Git diff' })
      .getByText('# old_end', { exact: true });
    await main.getByRole('button', { name: 'Toggle island', exact: true }).click();
    await expect(oldEnd).not.toBeInViewport();
    const originalEnd = (await oldEnd.boundingBox())!.x;
    await main.locator('.git-inline-content').hover();
    await page.mouse.wheel(10000, 0);
    await expect.poll(async () => (await oldEnd.boundingBox())!.x).toBeLessThan(originalEnd);
    const horizontal = main
      .locator('.monaco-scrollable-element')
      .first()
      .locator('.scrollbar.horizontal');
    const track = (await horizontal.boundingBox())!;
    const thumb = (await horizontal.locator('.slider').boundingBox())!;
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width - 1, thumb.y + thumb.height / 2);
    await page.mouse.up();
    await expect(oldEnd).toBeInViewport();
    await expect
      .poll(() =>
        oldEnd.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: join(evidence, 'inline-long.png') });
    await main.getByRole('button', { name: 'Close inline diff' }).click();
    await main.getByRole('button', { name: 'Toggle island', exact: true }).click();
    for (const [path, kind, expected] of [
      ['bom.py', 'modified', '\ufeffvalue = 1\r\n'],
      ['untracked.py', 'added', ''],
    ] as const) {
      await main.getByRole('tab', { name: path, exact: true }).click();
      await main.locator(`.git-line-${kind}`).click();
      await main.getByRole('button', { name: 'Rollback change', exact: true }).click();
      await expect(main.locator(`[class*="git-line-"]`)).toHaveCount(0);
      await page.keyboard.press('Meta+S');
      await expect.poll(() => readFile(join(fixture.project, path), 'utf8')).toBe(expected);
      await page.keyboard.press('Meta+z');
      await expect(main.locator(`.git-line-${kind}`)).toHaveCount(1);
    }
    await main.getByRole('tab', { name: 'many.py', exact: true }).click();
    await expect(main.locator('.view-lines').first()).toContainText('before_0');
    await main.getByRole('textbox', { name: 'Editor content', exact: true }).focus();
    for (let line = 0; line < 30; line++) await page.keyboard.press('ArrowDown');
    await main.locator('.git-line-modified').click();
    const manyPreview = main.getByRole('region', { name: 'Inline Git diff' });
    await expect(manyPreview).toContainText('old_value_0');
    await expect.poll(() => manyPreview.locator('.view-line').count()).toBeLessThan(50);
    const actions = manyPreview.locator('.git-inline-toolbar');
    await expect(actions).toHaveCSS('opacity', '1');
    await page.screenshot({ path: join(evidence, 'inline-actions-above.png') });
    const vertical = main
      .locator('.monaco-scrollable-element')
      .first()
      .locator('.scrollbar.vertical .slider');
    const originalTop = (await vertical.boundingBox())!.y;
    await main.locator('.git-inline-content').hover();
    await page.mouse.wheel(0, 10000);
    await expect.poll(async () => (await vertical.boundingBox())!.y).toBeGreaterThan(originalTop);
    await main.getByRole('textbox', { name: 'Editor content', exact: true }).focus();
    await page.keyboard.press('Meta+ArrowUp');
    await expect(actions).toBeVisible();
    await expect(manyPreview.locator('.git-inline-content')).not.toBeVisible();
    await expect(actions).toHaveCSS('opacity', '1');
    const editorBox = (await main.locator('.monaco-editor').first().boundingBox())!;
    const actionHeight = (await actions.boundingBox())!.height;
    await expect
      .poll(async () => Math.round((await actions.boundingBox())!.y))
      .toBe(Math.round(editorBox.y + editorBox.height - actionHeight));
    await page.screenshot({ path: join(evidence, 'inline-actions-bottom.png') });
    for (let line = 0; line < 30; line++) await page.keyboard.press('ArrowDown');
    await expect(manyPreview).toContainText('old_value_199');
    await expect(main.locator('.view-lines').first()).toContainText('new_value = 1');
    await expect.poll(() => manyPreview.locator('.view-line').count()).toBeLessThan(50);
    await expect(actions).toBeVisible();
    const editorTop = (await main.locator('.monaco-editor').first().boundingBox())!.y;
    await expect
      .poll(async () => Math.round((await actions.boundingBox())!.y))
      .toBe(Math.round(editorTop));
    await page.mouse.move(0, 0);
    await expect(actions).toHaveCSS('opacity', '0.6');
    await page.screenshot({ path: join(evidence, 'inline-many.png') });
    await actions.hover();
    await expect(actions).toHaveCSS('opacity', '1');
    await page.screenshot({ path: join(evidence, 'inline-actions-hover.png') });
    const hoverTop = (await vertical.boundingBox())!.y;
    await page.mouse.wheel(0, 10000);
    await expect.poll(async () => (await vertical.boundingBox())!.y).toBeGreaterThan(hoverTop);
    await main.getByRole('textbox', { name: 'Editor content', exact: true }).focus();
    await page.keyboard.press('Meta+ArrowDown');
    await expect(manyPreview.locator('.git-inline-content')).not.toBeVisible();
    await expect(actions).toBeVisible();
    await expect(actions).toHaveCSS('opacity', '1');
    await actions.getByRole('button', { name: 'Open file diff', exact: true }).focus();
    await page.mouse.move(0, 0);
    await expect(actions).toHaveCSS('opacity', '1');
    await main.getByRole('textbox', { name: 'Editor content', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(manyPreview).toHaveCount(0);
    console.log(
      'Inline hunks: main/right/bottom, deletion/addition, edits, staging, file/worktree switching and staged diff passed.',
      session.id,
    );
  }
  assert.deepEqual(fixture.errors, []);
  console.log('Git diff evidence:', evidence);
} catch (error) {
  failed = true;
  await fixture.captureFailure();
  throw error;
} finally {
  await fixture.dispose(failed);
}
