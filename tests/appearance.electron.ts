import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { repository, temp } from './fixtures';

const require = createRequire(import.meta.url);
const project = await repository();
const data = await temp();
await writeFile(join(project, 'main.py'), 'def greet():\n    return "hello"\n');
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.SF_DATA_DIR = join(data, 'data');
env.SF_TEST = '1';
delete env.ELECTRON_RUN_AS_NODE;
delete env.SF_DEV_URL;
const app = await electron.launch({
  executablePath: process.env.SF_EXECUTABLE || require('electron'),
  args: [...(process.env.SF_EXECUTABLE ? [] : [resolve('.')]), '--project=' + project],
  env,
});

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
  const keyword = page.locator('.view-line').first().locator('span[class^="mtk"]').first();
  const choose = (name: string) =>
    page
      .locator('label')
      .filter({ has: page.getByRole('radio', { name, exact: true }) })
      .click();
  const palette = () =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        background: root.backgroundColor,
        foreground: root.color,
        sidebar: root.getPropertyValue('--sidebar'),
        primary: root.getPropertyValue('--primary'),
        border: root.getPropertyValue('--border'),
        editorBackground: getComputedStyle(document.querySelector('.monaco-editor')!)
          .backgroundColor,
      };
    });
  for (const scheme of ['light', 'dark'] as const) {
    await page.keyboard.press('Meta+,');
    await choose(scheme === 'light' ? 'Light' : 'Dark');
    await choose(`Monaco ${scheme}`);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(keyword).toHaveCSS(
      'color',
      scheme === 'light' ? 'rgb(0, 0, 255)' : 'rgb(86, 156, 214)',
    );
    const before = await palette();
    await page.screenshot({ path: join(data, `${scheme}-monaco.png`) });
    await page.keyboard.press('Meta+,');
    await choose(`Darcula ${scheme}`);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(keyword).toHaveCSS(
      'color',
      scheme === 'light' ? 'rgb(0, 0, 128)' : 'rgb(204, 120, 50)',
    );
    await page.screenshot({ path: join(data, `${scheme}-darcula.png`) });
    assert.deepEqual(
      await palette(),
      before,
      'syntax themes must not change application or editor chrome',
    );
  }
  assert.deepEqual(errors, []);
  console.log('Syntax themes leave the interface unchanged. Evidence:', data);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: join(data, 'failure.png') }).catch(() => {});
  console.error('Appearance fixture:', data);
  throw error;
} finally {
  await app.close();
}
